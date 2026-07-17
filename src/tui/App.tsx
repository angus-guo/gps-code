import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text} from 'ink';
import {createAgent} from '../agent/agent.js';
import {runCommand} from '../commands/runner.js';
import type {CommandRequest} from '../commands/types.js';
import {loadConfig} from '../config/store.js';
import {applyEditProposal} from '../edits/apply.js';
import type {ProposedFileEdits} from '../edits/types.js';
import {undoEditProposal} from '../edits/undo.js';
import {prepareWorkspaceDiff} from '../git/diff.js';
import {createOpenAICompatibleClient} from '../model/openai-compatible.js';
import type {ToolActivity} from '../tools/types.js';
import {buildRepoMap} from '../workspace/indexer.js';
import type {RepoMap} from '../workspace/types.js';
import {
  formatCommandCancelled,
  formatCommandResultWithSummary,
  formatCommandStarted,
  formatPendingCommand,
  getConfirmationDecision,
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
  const [messages, setMessages] = useState<ChatMessageView[]>([
    {role: 'system', content: '欢迎使用 GPS Code。正在分析当前项目...'}
  ]);
  const [repoMap, setRepoMap] = useState<RepoMap | null>(null);
  const [pendingCommand, setPendingCommand] = useState<CommandRequest | null>(null);
  const [pendingEdit, setPendingEdit] = useState<ProposedFileEdits | null>(null);
  const [pendingUndo, setPendingUndo] = useState<ProposedFileEdits | null>(null);
  const [lastAppliedEdit, setLastAppliedEdit] = useState<ProposedFileEdits | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    async function boot() {
      try {
        const map = await buildRepoMap(cwd);
        setRepoMap(map);
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
        const config = await loadConfig();
        if (config) {
          const agent = createAgent({
            model: createOpenAICompatibleClient(config),
            repoMap: map
          });
          summary = await agent.summarizeCommandResult(result);
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

  async function handleCommandConfirmation(input: string, command: CommandRequest, map: RepoMap) {
    setMessages(appendMessage({role: 'user', content: input}));
    const decision = getConfirmationDecision(input);

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
      content: formatPendingCommand(command)
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
      const suggestion = suggestValidationCommand(map);
      if (suggestion) {
        setPendingCommand(suggestion.command);
        setMessages(appendMessage({
          role: 'system',
          kind: 'command',
          content: `${formatValidationSuggestion(suggestion)}\n\n${formatPendingCommand(suggestion.command)}`
        }));
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

    if (input.trim().toLowerCase() === '/undo') {
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
        setPendingCommand(command);
        setMessages((current) => [
          ...current,
          {role: 'user', content: input},
          {role: 'system', kind: 'command', content: formatPendingCommand(command)}
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
    setMessages((current) => [...current, {role: 'user', content: input}]);
    try {
      const config = await loadConfig();
      if (!config) {
        setMessages((current) => [
          ...current,
          {
            role: 'assistant',
            content: '还没有配置模型。请先退出并运行 gps-code config:set --base-url <url> --api-key <key> --model <model>。'
          }
        ]);
        return;
      }
      const agent = createAgent({
        model: createOpenAICompatibleClient(config),
        repoMap,
        onToolActivity(activity) {
          if (activity.status === 'proposed' && activity.command) {
            const {command} = activity;
            setPendingCommand(command);
            setMessages((current) => [
              ...current,
              {
                role: 'system',
                kind: 'command',
                content: `${formatToolActivity(activity)}\n\n${formatPendingCommand(command)}`
              }
            ]);
            return;
          }
          if (activity.status === 'edit-proposed' && activity.editProposal) {
            const {editProposal} = activity;
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
      const answer = await agent.ask(input);
      setMessages((current) => [...current, {role: 'assistant', content: answer}]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {role: 'assistant', content: `请求失败：${error instanceof Error ? error.message : String(error)}`}
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="green">GPS Code</Text>
      <ChatView messages={messages} />
      <InputBox
        disabled={!canChat || busy}
        prompt={pendingCommand
          ? '确认执行？'
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
