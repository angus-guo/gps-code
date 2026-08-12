import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {AgentSession} from '../agent/agent.js';
import type {Agent} from '../agent/agent.js';
import {runCommand} from '../commands/runner.js';
import type {CommandRequest} from '../commands/types.js';
import {loadConfig} from '../config/store.js';
import {applyEditProposal} from '../edits/apply.js';
import type {ProposedFileEdits} from '../edits/types.js';
import {undoEditProposal} from '../edits/undo.js';
import {prepareWorkspaceDiff} from '../git/diff.js';
import {createOpenAICompatibleClient} from '../model/openai-compatible.js';
import {ModelRequestAbortedError} from '../model/types.js';
import {decideCommandProposal, decideEditProposal} from '../permissions/decide.js';
import type {CommandPolicyOptions} from '../permissions/types.js';
import {
  PERMISSION_MODES,
  PERMISSION_MODE_DESCRIPTIONS,
  PERMISSION_MODE_LABELS,
  isPermissionMode,
  type PermissionMode
} from '../permissions/types.js';
import type {ToolActivity} from '../tools/types.js';
import {buildRepoMap} from '../workspace/indexer.js';
import type {RepoMap} from '../workspace/types.js';
import {
  formatCommandCancelled,
  formatCommandResultWithSummary,
  formatCommandStarted,
  formatPendingCommand,
  formatPendingStrongCommand,
  getConfirmationDecision,
  getStrongConfirmationDecision,
  parseManualCommandProposal
} from './command-confirmation.js';
import {ChatView, type ChatMessageView} from './components/ChatView.js';
import {formatWorkspaceDiff} from './diff-summary.js';
import {
  formatEditCancelled,
  formatEditError,
  formatEditResult,
  formatEditStarted,
  formatPendingEdit,
  formatPendingUndo,
  formatUndoCancelled,
  formatUndoError,
  formatUndoResult,
  formatUndoStarted,
  getEditConfirmationDecision,
  getUndoConfirmationDecision
} from './edit-confirmation.js';
import {
  formatValidationSuggestion,
  suggestValidationCommand
} from './edit-verification.js';
import {formatAgentCancelled, getInterruptAction} from './interrupt.js';
import {InputBox} from './components/InputBox.js';

function formatToolActivity(activity: ToolActivity) {
  const statusLabel = {
    started: '工具开始',
    completed: '工具完成',
    failed: '工具失败',
    proposed: '命令建议',
    'edit-proposed': '编辑建议'
  }[activity.status];

  return `${statusLabel} ${activity.toolName}: ${activity.summary}`;
}

function appendMessage(message: ChatMessageView) {
  return (current: ChatMessageView[]) => [...current, message];
}

export function App({cwd}: {cwd: string}) {
  const {exit} = useApp();
  const [messages, setMessages] = useState<ChatMessageView[]>([
    {role: 'system', content: '欢迎使用 GPS Code。正在分析当前项目...'}
  ]);
  const [repoMap, setRepoMap] = useState<RepoMap | null>(null);
  // The decision travels with the command so the confirmation check can never
  // disagree with the classification that produced the prompt.
  const [pendingCommand, setPendingCommand] = useState<{
    command: CommandRequest;
    strong: boolean;
  } | null>(null);
  const [pendingEdit, setPendingEdit] = useState<ProposedFileEdits | null>(null);
  const [pendingUndo, setPendingUndo] = useState<ProposedFileEdits | null>(null);
  const [lastAppliedEdit, setLastAppliedEdit] = useState<ProposedFileEdits | null>(null);
  const [busy, setBusy] = useState(true);
  // Distinct from `busy`, which is also true while a command runs or an edit
  // applies. Ctrl-C can only cancel the agent, so it must not claim to have
  // cancelled anything during those other operations.
  const [agentBusy, setAgentBusy] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default-confirm');
  const agentRef = useRef<Agent | null>(null);
  // onToolActivity is registered once at boot, so it must read the mode through
  // a ref rather than closing over the state value from that first render.
  const permissionModeRef = useRef<PermissionMode>('default-confirm');
  // Read from config at boot. A ref for the same reason as the mode: the
  // onToolActivity callback is registered once and would otherwise capture the
  // value from that first render.
  const policyOptionsRef = useRef<CommandPolicyOptions>({});

  function changePermissionMode(mode: PermissionMode) {
    permissionModeRef.current = mode;
    setPermissionMode(mode);
  }

  // Ctrl-C cancels an in-flight agent turn rather than killing the app; when
  // there is nothing to cancel it exits, keeping the usual terminal
  // expectation. Ink's own exitOnCtrlC is disabled in cli/commands.ts so this
  // is the only handler. InputBox also calls useInput, but Ink broadcasts keys
  // to every handler and InputBox ignores Ctrl-C, so the two do not conflict.
  useInput((input, key) => {
    const action = getInterruptAction(input, key, {
      agentBusy,
      hasAgent: Boolean(agentRef.current)
    });

    if (action === 'cancel-agent') {
      agentRef.current?.cancel();
      setMessages(appendMessage({
        role: 'system',
        kind: 'tool',
        content: formatAgentCancelled()
      }));
      return;
    }

    if (action === 'exit') {
      exit();
    }
  });

  useEffect(() => {
    async function boot() {
      try {
        const map = await buildRepoMap(cwd);
        setRepoMap(map);

        const config = await loadConfig();
        if (config) {
          policyOptionsRef.current = {
            allowlist: config.allowlist,
            denylist: config.denylist
          };
          agentRef.current = new AgentSession({
            model: createOpenAICompatibleClient(config),
            repoMap: map,
            onToolActivity(activity) {
              if (activity.status === 'proposed' && activity.command) {
                const {command} = activity;
                const decision = decideCommandProposal(
                  command,
                  permissionModeRef.current,
                  policyOptionsRef.current
                );

                if (decision.action === 'reject') {
                  setMessages((current) => [
                    ...current,
                    {
                      role: 'system',
                      kind: 'command',
                      content: `${formatToolActivity(activity)}\n\n已拒绝该命令：${decision.reason ?? '不符合当前权限策略。'}`
                    }
                  ]);
                  return;
                }

                const strong = decision.action === 'strong-confirm';
                setPendingCommand({command, strong});
                setMessages((current) => [
                  ...current,
                  {
                    role: 'system',
                    kind: 'command',
                    content: `${formatToolActivity(activity)}\n\n${strong
                      ? formatPendingStrongCommand(command, decision.reason)
                      : formatPendingCommand(command)}`
                  }
                ]);
                return;
              }
              if (activity.status === 'edit-proposed' && activity.editProposal) {
                const {editProposal} = activity;
                const decision = decideEditProposal(permissionModeRef.current);

                if (decision.action === 'reject') {
                  setMessages((current) => [
                    ...current,
                    {
                      role: 'system',
                      kind: 'edit-proposal',
                      content: `${formatToolActivity(activity)}\n\n已拒绝该编辑：${decision.reason ?? '不符合当前权限策略。'}`
                    }
                  ]);
                  return;
                }

                if (decision.action === 'auto-apply') {
                  setMessages((current) => [
                    ...current,
                    {
                      role: 'system',
                      kind: 'edit-proposal',
                      content: `${formatToolActivity(activity)}\n\n${decision.reason ?? ''}`
                    }
                  ]);
                  void autoApplyEdit(editProposal, map);
                  return;
                }

                setPendingEdit(editProposal);
                setMessages((current) => [
                  ...current,
                  {
                    role: 'system',
                    kind: 'edit-proposal',
                    content: `${formatToolActivity(activity)}\n\n${formatPendingEdit(editProposal)}`
                  }
                ]);
                return;
              }

              setMessages((current) => [
                ...current,
                {role: 'system', kind: 'tool', content: formatToolActivity(activity)}
              ]);
            }
          });
        }

        setMessages((current) => [
          ...current,
          {
            role: 'system',
            content: `项目分析完成：语言=${map.languages.join(', ') || '未知'}；关键文件=${map.keyFiles.join(', ') || '暂无'}`
          }
        ]);
      } catch (error) {
        setMessages((current) => [
          ...current,
          {role: 'system', content: `项目分析失败：${error instanceof Error ? error.message : String(error)}`}
        ]);
      } finally {
        setBusy(false);
      }
    }
    void boot();
  }, [cwd]);

  const canChat = useMemo(() => Boolean(repoMap) && !busy, [busy, repoMap]);

  async function executePendingCommand(command: CommandRequest, map: RepoMap) {
    setBusy(true);
    setMessages(appendMessage({
      role: 'system',
      kind: 'command',
      content: formatCommandStarted(command)
    }));
    try {
      const result = await runCommand(map.root, command);
      let summary: string | undefined;
      try {
        if (agentRef.current) {
          summary = await agentRef.current.summarizeCommandResult(result);
        }
      } catch {
        // The deterministic result below remains available when model summarization fails.
      }
      setMessages(appendMessage({
        role: 'system',
        kind: 'command-result',
        content: formatCommandResultWithSummary(result, summary)
      }));
      try {
        const diffMessage = formatWorkspaceDiff(await prepareWorkspaceDiff(map.root));
        if (diffMessage) {
          setMessages(appendMessage({
            role: 'system',
            kind: 'tool',
            content: diffMessage
          }));
        }
      } catch (error) {
        setMessages(appendMessage({
          role: 'system',
          kind: 'tool',
          content: `工作区变更检查失败：${error instanceof Error ? error.message : String(error)}`
        }));
      }
    } catch (error) {
      setMessages(appendMessage({
        role: 'system',
        kind: 'command-result',
        content: `命令执行失败：${error instanceof Error ? error.message : String(error)}`
      }));
    } finally {
      setBusy(false);
    }
  }

  async function handleCommandConfirmation(
    input: string,
    pending: {command: CommandRequest; strong: boolean},
    map: RepoMap
  ) {
    const {command, strong} = pending;
    setMessages(appendMessage({role: 'user', content: input}));
    const decision = strong
      ? getStrongConfirmationDecision(input, command)
      : getConfirmationDecision(input);

    if (decision === 'reject') {
      setPendingCommand(null);
      setMessages(appendMessage({
        role: 'system',
        kind: 'command',
        content: formatCommandCancelled(command)
      }));
      return;
    }

    if (decision === 'confirm') {
      setPendingCommand(null);
      await executePendingCommand(command, map);
      return;
    }

    setMessages(appendMessage({
      role: 'system',
      kind: 'command',
      content: strong
        ? formatPendingStrongCommand(command)
        : formatPendingCommand(command)
    }));
  }

  async function executePendingEdit(proposed: ProposedFileEdits, map: RepoMap) {
    setBusy(true);
    setMessages(appendMessage({
      role: 'system',
      kind: 'edit-proposal',
      content: formatEditStarted(proposed)
    }));
    try {
      const result = await applyEditProposal(map.root, proposed.proposal);
      setMessages(appendMessage({
        role: 'system',
        kind: 'edit-result',
        content: formatEditResult(result)
      }));
      setLastAppliedEdit(proposed);
      try {
        const diffMessage = formatWorkspaceDiff(await prepareWorkspaceDiff(map.root));
        if (diffMessage) {
          setMessages(appendMessage({
            role: 'system',
            kind: 'tool',
            content: diffMessage
          }));
        }
      } catch (error) {
        setMessages(appendMessage({
          role: 'system',
          kind: 'tool',
          content: `工作区变更检查失败：${error instanceof Error ? error.message : String(error)}`
        }));
      }
      // The suggestion is generated locally rather than by the model, but it
      // still goes through policy so there is exactly one path to a pending
      // command and no route that skips the denylist.
      const suggestion = suggestValidationCommand(map);
      if (suggestion) {
        const decision = decideCommandProposal(
          suggestion.command,
          permissionModeRef.current,
          policyOptionsRef.current
        );
        if (decision.action !== 'reject') {
          const strong = decision.action === 'strong-confirm';
          setPendingCommand({command: suggestion.command, strong});
          setMessages(appendMessage({
            role: 'system',
            kind: 'command',
            content: `${formatValidationSuggestion(suggestion)}\n\n${strong
              ? formatPendingStrongCommand(suggestion.command, decision.reason)
              : formatPendingCommand(suggestion.command)}`
          }));
        }
      }
    } catch (error) {
      setMessages(appendMessage({
        role: 'system',
        kind: 'edit-result',
        content: formatEditError(error)
      }));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Applies an edit without confirmation for `auto-accept-edits`. This runs
   * while the agent loop is still active, so it must not own the busy flag and
   * must not stage a pending validation command that would collide with it.
   */
  async function autoApplyEdit(proposed: ProposedFileEdits, map: RepoMap) {
    try {
      const result = await applyEditProposal(map.root, proposed.proposal);
      setLastAppliedEdit(proposed);
      setMessages(appendMessage({
        role: 'system',
        kind: 'edit-result',
        content: formatEditResult(result)
      }));
    } catch (error) {
      setMessages(appendMessage({
        role: 'system',
        kind: 'edit-result',
        content: formatEditError(error)
      }));
    }
  }

  async function executePendingUndo(proposed: ProposedFileEdits, map: RepoMap) {
    setBusy(true);
    setMessages(appendMessage({
      role: 'system',
      kind: 'edit-proposal',
      content: formatUndoStarted(proposed)
    }));
    try {
      const result = await undoEditProposal(map.root, proposed.proposal);
      setLastAppliedEdit(null);
      setMessages(appendMessage({
        role: 'system',
        kind: 'edit-result',
        content: formatUndoResult(result)
      }));
      try {
        const diffMessage = formatWorkspaceDiff(await prepareWorkspaceDiff(map.root));
        if (diffMessage) {
          setMessages(appendMessage({
            role: 'system',
            kind: 'tool',
            content: diffMessage
          }));
        }
      } catch (error) {
        setMessages(appendMessage({
          role: 'system',
          kind: 'tool',
          content: `工作区变更检查失败：${error instanceof Error ? error.message : String(error)}`
        }));
      }
    } catch (error) {
      setMessages(appendMessage({
        role: 'system',
        kind: 'edit-result',
        content: formatUndoError(error)
      }));
    } finally {
      setBusy(false);
    }
  }

  async function handleUndoConfirmation(input: string, proposed: ProposedFileEdits, map: RepoMap) {
    setMessages(appendMessage({role: 'user', content: input}));
    const decision = getUndoConfirmationDecision(input);

    if (decision === 'reject') {
      setPendingUndo(null);
      setMessages(appendMessage({
        role: 'system',
        kind: 'edit-proposal',
        content: formatUndoCancelled(proposed)
      }));
      return;
    }

    if (decision === 'confirm') {
      setPendingUndo(null);
      await executePendingUndo(proposed, map);
      return;
    }

    setMessages(appendMessage({
      role: 'system',
      kind: 'edit-proposal',
      content: formatPendingUndo(proposed)
    }));
  }

  async function handleEditConfirmation(input: string, proposed: ProposedFileEdits, map: RepoMap) {
    setMessages(appendMessage({role: 'user', content: input}));
    const decision = getEditConfirmationDecision(input);

    if (decision === 'reject') {
      setPendingEdit(null);
      setMessages(appendMessage({
        role: 'system',
        kind: 'edit-proposal',
        content: formatEditCancelled(proposed)
      }));
      return;
    }

    if (decision === 'confirm') {
      setPendingEdit(null);
      await executePendingEdit(proposed, map);
      return;
    }

    setMessages(appendMessage({
      role: 'system',
      kind: 'edit-proposal',
      content: formatPendingEdit(proposed)
    }));
  }

  async function handleSubmit(input: string) {
    if (!repoMap) return;
    if (pendingCommand) {
      await handleCommandConfirmation(input, pendingCommand, repoMap);
      return;
    }
    if (pendingEdit) {
      await handleEditConfirmation(input, pendingEdit, repoMap);
      return;
    }
    if (pendingUndo) {
      await handleUndoConfirmation(input, pendingUndo, repoMap);
      return;
    }

    const trimmedInput = input.trim().toLowerCase();

    if (trimmedInput === '/mode' || trimmedInput.startsWith('/mode ')) {
      setMessages(appendMessage({role: 'user', content: input}));
      const parts = input.trim().split(/\s+/);
      const modeList = PERMISSION_MODES
        .map((mode) => `- ${mode}：${PERMISSION_MODE_DESCRIPTIONS[mode]}`)
        .join('\n');

      if (parts.length === 1) {
        setMessages(appendMessage({
          role: 'system',
          kind: 'command',
          content: [
            `当前权限模式：${PERMISSION_MODE_LABELS[permissionMode]}（${PERMISSION_MODE_DESCRIPTIONS[permissionMode]}）`,
            '',
            '可用模式：',
            modeList,
            '',
            '用法：/mode <模式名>'
          ].join('\n')
        }));
        return;
      }

      const requested = parts[1];
      if (!isPermissionMode(requested)) {
        setMessages(appendMessage({
          role: 'system',
          kind: 'command',
          content: `无效的模式：${requested}\n\n可用模式：\n${modeList}`
        }));
        return;
      }

      changePermissionMode(requested);
      setMessages(appendMessage({
        role: 'system',
        kind: 'command',
        content: `已切换到${PERMISSION_MODE_LABELS[requested]}：${PERMISSION_MODE_DESCRIPTIONS[requested]}`
      }));
      return;
    }

    if (trimmedInput === '/undo') {
      setMessages(appendMessage({role: 'user', content: input}));
      if (!lastAppliedEdit) {
        setMessages(appendMessage({
          role: 'system',
          kind: 'edit-result',
          content: '没有可撤销的 GPS Code 编辑。当前版本只保留最近一次成功应用的编辑。'
        }));
        return;
      }
      setPendingUndo(lastAppliedEdit);
      setMessages(appendMessage({
        role: 'system',
        kind: 'edit-proposal',
        content: formatPendingUndo(lastAppliedEdit)
      }));
      return;
    }

    try {
      const command = parseManualCommandProposal(input);
      if (command) {
        // The manual /run path goes through the same policy as model proposals.
        const decision = decideCommandProposal(command, permissionMode, policyOptionsRef.current);
        if (decision.action === 'reject') {
          setMessages((current) => [
            ...current,
            {role: 'user', content: input},
            {
              role: 'system',
              kind: 'command',
              content: `已拒绝该命令：${decision.reason ?? '不符合当前权限策略。'}`
            }
          ]);
          return;
        }

        const strong = decision.action === 'strong-confirm';
        setPendingCommand({command, strong});
        setMessages((current) => [
          ...current,
          {role: 'user', content: input},
          {
            role: 'system',
            kind: 'command',
            content: strong
              ? formatPendingStrongCommand(command, decision.reason)
              : formatPendingCommand(command)
          }
        ]);
        return;
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {role: 'user', content: input},
        {role: 'system', kind: 'command', content: `命令解析失败：${error instanceof Error ? error.message : String(error)}`}
      ]);
      return;
    }

    setBusy(true);
    setAgentBusy(true);
    setMessages((current) => [...current, {role: 'user', content: input}]);
    try {
      if (!agentRef.current) {
        setMessages((current) => [
          ...current,
          {
            role: 'assistant',
            content: '还没有配置模型。请先退出并运行 gps-code config:set --base-url <url> --api-key <key> --model <model>。'
          }
        ]);
        return;
      }
      const answer = await agentRef.current.ask(input);
      setMessages((current) => [...current, {role: 'assistant', content: answer}]);
    } catch (error) {
      // A cancellation already reported itself when Ctrl-C was pressed, so it
      // should not also surface as a request failure.
      if (error instanceof ModelRequestAbortedError) {
        return;
      }
      setMessages((current) => [
        ...current,
        {role: 'assistant', content: `请求失败：${error instanceof Error ? error.message : String(error)}`}
      ]);
    } finally {
      setAgentBusy(false);
      setBusy(false);
    }
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text bold color="green">GPS Code</Text>
        <Text color="gray">{'  '}模式：</Text>
        <Text color={permissionMode === 'default-confirm' ? 'gray' : 'yellow'}>
          {PERMISSION_MODE_LABELS[permissionMode]}
        </Text>
      </Box>
      <ChatView messages={messages} />
      <InputBox
        disabled={!canChat || busy}
        prompt={pendingCommand
          ? (pendingCommand.strong ? '请输入完整命令确认：' : '确认执行？')
          : pendingEdit
            ? '确认应用？'
            : pendingUndo
              ? '确认撤销？'
              : '输入问题，回车发送：'}
        onSubmit={handleSubmit}
      />
    </Box>
  );
}
