import {describe, expect, it} from 'vitest';
import {
  createConversationHistory,
  sessionEventsToConversationMessages
} from '../../src/agent/history.js';
import type {SessionEvent} from '../../src/session/types.js';

function event(
  sequence: number,
  role: SessionEvent['role'],
  content: string,
  kind: SessionEvent['kind'] = 'default'
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

describe('conversation history', () => {
  it('restores only completed user and assistant turns from session events', () => {
    const events = [
      event(0, 'system', '项目分析完成'),
      event(1, 'user', '入口在哪里？'),
      event(2, 'system', '工具完成', 'tool'),
      event(3, 'assistant', '入口在 src/index.ts。'),
      event(4, 'user', '这个未完成的问题不应恢复')
    ];

    expect(sessionEventsToConversationMessages(events)).toEqual([
      {role: 'user', content: '入口在哪里？'},
      {role: 'assistant', content: '入口在 src/index.ts。'}
    ]);
  });

  it('retains complete tool-call and tool-result pairs', () => {
    const history = createConversationHistory();
    history.appendTurn([
      {role: 'user', content: '读取 README'},
      {
        role: 'assistant',
        content: '',
        toolCalls: [{id: 'call_1', name: 'read_file', arguments: {path: 'README.md'}}]
      },
      {role: 'tool', toolCallId: 'call_1', content: 'README content'},
      {role: 'assistant', content: 'README 描述了项目。'}
    ]);

    expect(history.getMessages()).toHaveLength(4);
    expect(history.getMessages()[2]).toMatchObject({role: 'tool', toolCallId: 'call_1'});
  });

  it('rejects orphaned tool results', () => {
    const history = createConversationHistory();

    expect(() => history.appendTurn([
      {role: 'user', content: '问题'},
      {role: 'tool', toolCallId: 'missing', content: 'orphan'},
      {role: 'assistant', content: '回答'}
    ])).toThrow(/no matching assistant call/i);
  });

  it('drops oldest complete turns when turn and byte limits are exceeded', () => {
    const history = createConversationHistory({
      maxTurns: 2,
      maxBytes: 2048,
      maxMessageBytes: 512
    });
    for (let index = 0; index < 3; index += 1) {
      history.appendTurn([
        {role: 'user', content: `question-${index}-${'x'.repeat(500)}`},
        {role: 'assistant', content: `answer-${index}-${'y'.repeat(500)}`}
      ]);
    }

    const serialized = JSON.stringify(history.getMessages());
    expect(history.getTurnCount()).toBeLessThanOrEqual(2);
    expect(serialized).not.toContain('question-0');
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(2048);
    expect(serialized).toContain('question-2');
  });

  it('compacts an oversized tool turn without leaving protocol orphans', () => {
    const history = createConversationHistory({
      maxBytes: 1024,
      maxMessageBytes: 800
    });
    history.appendTurn([
      {role: 'user', content: '解释大文件'},
      {
        role: 'assistant',
        content: '',
        toolCalls: [{id: 'call_large', name: 'read_file', arguments: {path: 'large.txt'}}]
      },
      {role: 'tool', toolCallId: 'call_large', content: 'x'.repeat(5000)},
      {role: 'assistant', content: `结论：${'y'.repeat(5000)}`}
    ]);

    const messages = history.getMessages();
    expect(messages.map(({role}) => role)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(messages)).not.toContain('call_large');
    expect(Buffer.byteLength(JSON.stringify(messages), 'utf8')).toBeLessThanOrEqual(1024);
  });
});
