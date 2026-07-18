import {describe, expect, it} from 'vitest';
import {
  CORRUPT_SESSION_NOTICE,
  createSessionTranscript,
  RESUMED_SESSION_NOTICE,
  sessionEventsToChatMessages
} from '../../src/tui/session-transcript.js';
import type {SessionEvent, SessionEventInput} from '../../src/session/types.js';

function event(
  sequence: number,
  role: SessionEvent['role'],
  kind: SessionEvent['kind'],
  content: string
): SessionEvent {
  return {
    recordType: 'event',
    schemaVersion: 1,
    id: `00000000-0000-4000-8000-${String(sequence + 1).padStart(12, '0')}`,
    sessionId: '00000000-0000-4000-8000-000000000099',
    sequence,
    timestamp: `2026-07-18T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    role,
    kind,
    content
  };
}

describe('TUI session transcript', () => {
  it('restores user-visible roles, kinds, and content', () => {
    expect(sessionEventsToChatMessages([
      event(0, 'user', 'default', '问题'),
      event(1, 'system', 'tool', '工具完成'),
      event(2, 'assistant', 'default', '回答')
    ])).toEqual([
      {role: 'user', content: '问题'},
      {role: 'system', kind: 'tool', content: '工具完成'},
      {role: 'assistant', content: '回答'}
    ]);
  });

  it('marks process-local confirmations as expired after resume', () => {
    expect(RESUMED_SESSION_NOTICE).toContain('待确认命令');
    expect(RESUMED_SESSION_NOTICE).toContain('编辑提案');
    expect(RESUMED_SESSION_NOTICE).toContain('撤销请求');
    expect(RESUMED_SESSION_NOTICE).toContain('均已失效');
    expect(CORRUPT_SESSION_NOTICE).toContain('只读展示');
  });

  it('serializes concurrent message appends in display order', async () => {
    const appended: SessionEventInput[] = [];
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const transcript = createSessionTranscript({
      workspaceRoot: '/repo',
      sessionId: '00000000-0000-4000-8000-000000000099',
      store: {
        async appendEvent(_root, _sessionId, input) {
          activeWrites += 1;
          maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
          await new Promise((resolve) => setTimeout(resolve, input.content === 'first' ? 10 : 1));
          appended.push(input);
          activeWrites -= 1;
          return {} as never;
        }
      }
    });

    transcript.append({role: 'user', content: 'first'});
    transcript.append({role: 'system', kind: 'tool', content: 'second'});
    await transcript.flush();

    expect(maxActiveWrites).toBe(1);
    expect(appended.map(({content}) => content)).toEqual(['first', 'second']);
  });

  it('reports a write failure and continues the queue', async () => {
    const attempts: string[] = [];
    const errors: string[] = [];
    const transcript = createSessionTranscript({
      workspaceRoot: '/repo',
      sessionId: '00000000-0000-4000-8000-000000000099',
      store: {
        async appendEvent(_root, _sessionId, input) {
          attempts.push(input.content);
          if (input.content === 'fails') throw new Error('disk full');
          return {} as never;
        }
      },
      onError(error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    });

    transcript.appendMany([
      {role: 'user', content: 'fails'},
      {role: 'assistant', content: 'still attempted'}
    ]);
    await transcript.flush();

    expect(attempts).toEqual(['fails', 'still attempted']);
    expect(errors).toEqual(['disk full']);
  });
});
