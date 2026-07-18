import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text} from 'ink';
import {createAgent, type Agent} from '../agent/agent.js';
import {sessionEventsToConversationMessages} from '../agent/history.js';
import {runCommand} from '../commands/runner.js';
import type {CommandRequest} from '../commands/types.js';
import {loadConfig} from '../config/store.js';
import {applyEditProposal} from '../edits/apply.js';
import type {ProposedFileEdits} from '../edits/types.js';
import {undoEditProposal} from '../edits/undo.js';
import {prepareWorkspaceDiff} from '../git/diff.js';
import {createOpenAICompatibleClient} from '../model/openai-compatible.js';
import {createSessionStore, type SessionStore} from '../session/store.js';
import type {LoadedSession} from '../session/types.js';
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
import {
  CORRUPT_SESSION_NOTICE,
  createSessionTranscript,
  RESUMED_SESSION_NOTICE,
  sessionEventsToChatMessages,
  type SessionTranscript
} from './session-transcript.js';

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

function formatPersistenceError(error: unknown) {
  return `会话保存失败，当前聊天仍可继续，但部分新消息可能无法写入历史：${error instanceof Error ? error.message : String(error)}`;
}

export type AppProps = {
  cwd: string;
  sessionStore?: SessionStore;
  resumedSession?: LoadedSession;
  persistSession?: boolean;
};

export function App({
  cwd,
  sessionStore,
  resumedSession,
  persistSession = true
}: AppProps) {
  const defaultSessionStore = useMemo(() => createSessionStore(), []);
  const activeSessionStore = sessionStore ?? defaultSessionStore;
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [repoMap, setRepoMap] = useState<RepoMap | null>(null);
  const [pendingCommand, setPendingCommand] = useState<CommandRequest | null>(null);
  const [pendingEdit, setPendingEdit] = useState<ProposedFileEdits | null>(null);
  const [pendingUndo, setPendingUndo] = useState<ProposedFileEdits | null>(null);
  const [lastAppliedEdit, setLastAppliedEdit] = useState<ProposedFileEdits | null>(null);
  const [busy, setBusy] = useState(true);
  const transcriptRef = useRef<SessionTranscript | null>(null);
  const agentRef = useRef<Agent | null>(null);
  const initialHistoryRef = useRef(sessionEventsToConversationMessages(resumedSession?.events ?? []));
  const persistenceWarningShownRef = useRef(false);

  function reportPersistenceFailure(error: unknown) {
    if (persistenceWarningShownRef.current) return;
    persistenceWarningShownRef.current = true;
    setMessages((current) => [
      ...current,
      {role: 'system', content: formatPersistenceError(error)}
    ]);
  }

  function appendMessages(...nextMessages: ChatMessageView[]) {
    setMessages((current) => [...current, ...nextMessages]);
    transcriptRef.current?.appendMany(nextMessages);
  }

  useEffect(() => {
    let active = true;

    async function boot() {
      const welcomeMessage: ChatMessageView = {
        role: 'system',
        content: '欢迎使用 GPS Code。正在分析当前项目...'
      };
      const startupMessages: ChatMessageView[] = resumedSession
        ? [
          ...sessionEventsToChatMessages(resumedSession.events),
          {role: 'system', content: RESUMED_SESSION_NOTICE},
          ...(resumedSession.recoveredFromCorruption
            ? [{role: 'system' as const, content: CORRUPT_SESSION_NOTICE}]
            : [])
        ]
        : [welcomeMessage];
      const newStartupMessages = resumedSession
        ? startupMessages.slice(resumedSession.events.length)
        : [welcomeMessage];

      if (persistSession) {
        try {
          const loaded = resumedSession ?? await activeSessionStore.createSession(cwd);
          if (!active) return;
          if (!loaded.recoveredFromCorruption) {
            transcriptRef.current = createSessionTranscript({
              store: activeSessionStore,
              workspaceRoot: cwd,
              sessionId: loaded.metadata.id,
              onError: reportPersistenceFailure
            });
          }
        } catch (error) {
          persistenceWarningShownRef.current = true;
          startupMessages.push({role: 'system', content: formatPersistenceError(error)});
        }
      }

      if (!active) return;
      initialHistoryRef.current = sessionEventsToConversationMessages(resumedSession?.events ?? []);
      agentRef.current = null;
      setMessages(startupMessages);
      transcriptRef.current?.appendMany(newStartupMessages);

      try {
        const map = await buildRepoMap(cwd);
        if (!active) return;
        setRepoMap(map);
        appendMessages({
          role: 'system',
          content: `项目分析完成：语言=${map.languages.join(', ') || '未知'}；关键文件=${map.keyFiles.join(', ') || '暂无'}`
        });
      } catch (error) {
        if (!active) return;
        appendMessages({
          role: 'system',
          content: `项目分析失败：${error instanceof Error ? error.message : String(error)}`
        });
      } finally {
        if (active) setBusy(false);
      }
    }
    void boot();

    return () => {
      active = false;
      transcriptRef.current = null;
      agentRef.current = null;
    };
  }, [activeSessionStore, cwd, persistSession, resumedSession]);

  const canChat = useMemo(() => Boolean(repoMap) && !busy, [busy, repoMap]);

  async function getOrCreateAgent(map: RepoMap) {
    if (agentRef.current) return agentRef.current;
    const config = await loadConfig();
    if (!config) return null;
    const agent = createAgent({
      model: createOpenAICompatibleClient(config),
      repoMap: map,
      initialHistory: initialHistoryRef.current,
      onToolActivity(activity) {
        if (activity.status === 'proposed' && activity.command) {
          const {command} = activity;
          setPendingCommand(command);
          appendMessages({
            role: 'system',
            kind: 'command',
            content: `${formatToolActivity(activity)}\n\n${formatPendingCommand(command)}`
          });
          return;
        }
        if (activity.status === 'edit-proposed' && activity.editProposal) {
          const {editProposal} = activity;
          setPendingEdit(editProposal);
          appendMessages({
            role: 'system',
            kind: 'edit-proposal',
            content: `${formatToolActivity(activity)}\n\n${formatPendingEdit(editProposal)}`
          });
          return;
        }

        appendMessages({role: 'system', kind: 'tool', content: formatToolActivity(activity)});
      }
    });
    agentRef.current = agent;
    return agent;
  }

  async function executePendingCommand(command: CommandRequest, map: RepoMap) {
    setBusy(true);
    appendMessages({
      role: 'system',
      kind: 'command',
      content: formatCommandStarted(command)
    });
    try {
      const result = await runCommand(map.root, command);
      let summary: string | undefined;
      try {
        const agent = await getOrCreateAgent(map);
        if (agent) {
          summary = await agent.summarizeCommandResult(result);
        }
      } catch {
        // The deterministic result below remains available when model summarization fails.
      }
      appendMessages({
        role: 'system',
        kind: 'command-result',
        content: formatCommandResultWithSummary(result, summary)
      });
      try {
        const diffMessage = formatWorkspaceDiff(await prepareWorkspaceDiff(map.root));
        if (diffMessage) {
          appendMessages({
            role: 'system',
            kind: 'tool',
            content: diffMessage
          });
        }
      } catch (error) {
        appendMessages({
          role: 'system',
          kind: 'tool',
          content: `工作区变更检查失败：${error instanceof Error ? error.message : String(error)}`
        });
      }
    } catch (error) {
      appendMessages({
        role: 'system',
        kind: 'command-result',
        content: `命令执行失败：${error instanceof Error ? error.message : String(error)}`
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleCommandConfirmation(input: string, command: CommandRequest, map: RepoMap) {
    appendMessages({role: 'user', content: input});
    const decision = getConfirmationDecision(input);

    if (decision === 'reject') {
      setPendingCommand(null);
      appendMessages({
        role: 'system',
        kind: 'command',
        content: formatCommandCancelled(command)
      });
      return;
    }

    if (decision === 'confirm') {
      setPendingCommand(null);
      await executePendingCommand(command, map);
      return;
    }

    appendMessages({
      role: 'system',
      kind: 'command',
      content: formatPendingCommand(command)
    });
  }

  async function executePendingEdit(proposed: ProposedFileEdits, map: RepoMap) {
    setBusy(true);
    appendMessages({
      role: 'system',
      kind: 'edit-proposal',
      content: formatEditStarted(proposed)
    });
    try {
      const result = await applyEditProposal(map.root, proposed.proposal);
      appendMessages({
        role: 'system',
        kind: 'edit-result',
        content: formatEditResult(result)
      });
      setLastAppliedEdit(proposed);
      try {
        const diffMessage = formatWorkspaceDiff(await prepareWorkspaceDiff(map.root));
        if (diffMessage) {
          appendMessages({
            role: 'system',
            kind: 'tool',
            content: diffMessage
          });
        }
      } catch (error) {
        appendMessages({
          role: 'system',
          kind: 'tool',
          content: `工作区变更检查失败：${error instanceof Error ? error.message : String(error)}`
        });
      }
      const suggestion = suggestValidationCommand(map);
      if (suggestion) {
        setPendingCommand(suggestion.command);
        appendMessages({
          role: 'system',
          kind: 'command',
          content: `${formatValidationSuggestion(suggestion)}\n\n${formatPendingCommand(suggestion.command)}`
        });
      }
    } catch (error) {
      appendMessages({
        role: 'system',
        kind: 'edit-result',
        content: formatEditError(error)
      });
    } finally {
      setBusy(false);
    }
  }

  async function executePendingUndo(proposed: ProposedFileEdits, map: RepoMap) {
    setBusy(true);
    appendMessages({
      role: 'system',
      kind: 'edit-proposal',
      content: formatUndoStarted(proposed)
    });
    try {
      const result = await undoEditProposal(map.root, proposed.proposal);
      setLastAppliedEdit(null);
      appendMessages({
        role: 'system',
        kind: 'edit-result',
        content: formatUndoResult(result)
      });
      try {
        const diffMessage = formatWorkspaceDiff(await prepareWorkspaceDiff(map.root));
        if (diffMessage) {
          appendMessages({
            role: 'system',
            kind: 'tool',
            content: diffMessage
          });
        }
      } catch (error) {
        appendMessages({
          role: 'system',
          kind: 'tool',
          content: `工作区变更检查失败：${error instanceof Error ? error.message : String(error)}`
        });
      }
    } catch (error) {
      appendMessages({
        role: 'system',
        kind: 'edit-result',
        content: formatUndoError(error)
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleUndoConfirmation(input: string, proposed: ProposedFileEdits, map: RepoMap) {
    appendMessages({role: 'user', content: input});
    const decision = getUndoConfirmationDecision(input);

    if (decision === 'reject') {
      setPendingUndo(null);
      appendMessages({
        role: 'system',
        kind: 'edit-proposal',
        content: formatUndoCancelled(proposed)
      });
      return;
    }

    if (decision === 'confirm') {
      setPendingUndo(null);
      await executePendingUndo(proposed, map);
      return;
    }

    appendMessages({
      role: 'system',
      kind: 'edit-proposal',
      content: formatPendingUndo(proposed)
    });
  }

  async function handleEditConfirmation(input: string, proposed: ProposedFileEdits, map: RepoMap) {
    appendMessages({role: 'user', content: input});
    const decision = getEditConfirmationDecision(input);

    if (decision === 'reject') {
      setPendingEdit(null);
      appendMessages({
        role: 'system',
        kind: 'edit-proposal',
        content: formatEditCancelled(proposed)
      });
      return;
    }

    if (decision === 'confirm') {
      setPendingEdit(null);
      await executePendingEdit(proposed, map);
      return;
    }

    appendMessages({
      role: 'system',
      kind: 'edit-proposal',
      content: formatPendingEdit(proposed)
    });
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
      appendMessages({role: 'user', content: input});
      if (!lastAppliedEdit) {
        appendMessages({
          role: 'system',
          kind: 'edit-result',
          content: '没有可撤销的 GPS Code 编辑。当前版本只保留最近一次成功应用的编辑。'
        });
        return;
      }
      setPendingUndo(lastAppliedEdit);
      appendMessages({
        role: 'system',
        kind: 'edit-proposal',
        content: formatPendingUndo(lastAppliedEdit)
      });
      return;
    }

    try {
      const command = parseManualCommandProposal(input);
      if (command) {
        setPendingCommand(command);
        appendMessages(
          {role: 'user', content: input},
          {role: 'system', kind: 'command', content: formatPendingCommand(command)}
        );
        return;
      }
    } catch (error) {
      appendMessages(
        {role: 'user', content: input},
        {role: 'system', kind: 'command', content: `命令解析失败：${error instanceof Error ? error.message : String(error)}`}
      );
      return;
    }

    setBusy(true);
    appendMessages({role: 'user', content: input});
    try {
      const agent = await getOrCreateAgent(repoMap);
      if (!agent) {
        appendMessages({
          role: 'assistant',
          content: '还没有配置模型。请先退出并运行 gps-code config:set --base-url <url> --api-key <key> --model <model>。'
        });
        return;
      }
      const answer = await agent.ask(input);
      appendMessages({role: 'assistant', content: answer});
    } catch (error) {
      appendMessages({
        role: 'assistant',
        content: `请求失败：${error instanceof Error ? error.message : String(error)}`
      });
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
