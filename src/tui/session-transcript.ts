import type {SessionStore} from '../session/store.js';
import type {SessionEvent} from '../session/types.js';
import type {ChatMessageView} from './components/ChatView.js';

export const RESUMED_SESSION_NOTICE = [
  '已恢复上次会话。',
  '为保证安全，上次进程中的待确认命令、编辑提案和撤销请求均已失效；如仍需要，请重新提出。'
].join('\n');

export const CORRUPT_SESSION_NOTICE = '会话尾部存在损坏记录，已恢复此前完整消息；当前会话将只读展示，请开始新会话后再继续保存。';

export function sessionEventsToChatMessages(
  events: readonly SessionEvent[]
): ChatMessageView[] {
  return events.map((event) => ({
    role: event.role,
    content: event.content,
    ...(event.kind === 'default' ? {} : {kind: event.kind})
  }));
}

export type SessionTranscriptOptions = {
  store: Pick<SessionStore, 'appendEvent'>;
  workspaceRoot: string;
  sessionId: string;
  onError?: (error: unknown) => void;
};

export function createSessionTranscript(options: SessionTranscriptOptions) {
  let queue = Promise.resolve();

  function append(message: ChatMessageView) {
    queue = queue.then(async () => {
      await options.store.appendEvent(options.workspaceRoot, options.sessionId, {
        role: message.role,
        kind: message.kind ?? 'default',
        content: message.content
      });
    }).catch((error) => {
      options.onError?.(error);
    });
    return queue;
  }

  function appendMany(messages: readonly ChatMessageView[]) {
    for (const message of messages) {
      append(message);
    }
    return queue;
  }

  return {
    append,
    appendMany,
    flush() {
      return queue;
    }
  };
}

export type SessionTranscript = ReturnType<typeof createSessionTranscript>;
