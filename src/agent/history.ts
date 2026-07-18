import type {ChatMessage, ToolCall} from '../model/types.js';
import type {SessionEvent} from '../session/types.js';

export const DEFAULT_MAX_HISTORY_BYTES = 256_000;
export const DEFAULT_MAX_HISTORY_TURNS = 20;
export const DEFAULT_MAX_HISTORY_MESSAGE_BYTES = 64_000;

const TRUNCATION_MARKER = '\n[conversation message truncated]';

export type ConversationSeedMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ConversationHistoryOptions = {
  maxBytes?: number;
  maxTurns?: number;
  maxMessageBytes?: number;
  initialMessages?: readonly ConversationSeedMessage[];
};

function assertPositiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function serializedBytes(messages: readonly ChatMessage[]) {
  return Buffer.byteLength(JSON.stringify(messages), 'utf8');
}

function truncateText(content: string, maxBytes: number) {
  if (Buffer.byteLength(content, 'utf8') <= maxBytes) {
    return content;
  }
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, 'utf8');
  if (maxBytes <= markerBytes) {
    return '';
  }
  const buffer = Buffer.from(content, 'utf8');
  const keepBytes = maxBytes - markerBytes;
  let prefix = '';
  for (let end = keepBytes; end >= Math.max(0, keepBytes - 4); end -= 1) {
    try {
      prefix = new TextDecoder('utf-8', {fatal: true}).decode(buffer.subarray(0, end));
      break;
    } catch {
      // Retry without an incomplete trailing UTF-8 sequence.
    }
  }
  return `${prefix}${TRUNCATION_MARKER}`;
}

function cloneToolCalls(toolCalls: ToolCall[] | undefined) {
  return toolCalls?.map((toolCall) => ({...toolCall}));
}

function truncateMessage(message: ChatMessage, maxBytes: number): ChatMessage {
  if (message.role === 'tool') {
    return {...message, content: truncateText(message.content, maxBytes)};
  }
  if (message.role === 'assistant') {
    return {
      ...message,
      content: message.content == null ? message.content : truncateText(message.content, maxBytes),
      toolCalls: cloneToolCalls(message.toolCalls)
    };
  }
  return {...message, content: truncateText(message.content, maxBytes)};
}

function assertCompleteTurn(messages: readonly ChatMessage[]) {
  if (messages.length < 2 || messages[0].role !== 'user' || messages.at(-1)?.role !== 'assistant') {
    throw new Error('Conversation turns must start with a user message and end with an assistant message.');
  }

  let pendingToolCalls = new Set<string>();
  for (let index = 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === 'system' || message.role === 'user') {
      throw new Error('Conversation turns cannot contain nested user or system messages.');
    }
    if (message.role === 'assistant') {
      if (pendingToolCalls.size > 0) {
        throw new Error('Assistant tool calls must be followed by matching tool results.');
      }
      pendingToolCalls = new Set((message.toolCalls ?? []).map(({id}) => id));
      if (pendingToolCalls.size !== (message.toolCalls ?? []).length) {
        throw new Error('Assistant tool call identifiers must be unique.');
      }
      if (index !== messages.length - 1 && pendingToolCalls.size === 0) {
        throw new Error('Only the final assistant message may omit tool calls.');
      }
      continue;
    }
    if (message.role !== 'tool') {
      throw new Error('Conversation turn contains an unsupported message role.');
    }
    if (!pendingToolCalls.delete(message.toolCallId)) {
      throw new Error(`Tool result has no matching assistant call: ${message.toolCallId}`);
    }
  }
  if (pendingToolCalls.size > 0) {
    throw new Error('Conversation turn ended before all tool calls returned results.');
  }
}

function compactTurn(
  messages: readonly ChatMessage[],
  maxBytes: number,
  maxMessageBytes: number
) {
  assertCompleteTurn(messages);
  const truncated = messages.map((message) => truncateMessage(message, maxMessageBytes));
  if (serializedBytes(truncated) <= maxBytes) {
    return truncated;
  }

  const perMessageBytes = Math.max(64, Math.min(maxMessageBytes, Math.floor(maxBytes / 4)));
  const first = truncateMessage(truncated[0], perMessageBytes);
  const finalMessage = truncated.at(-1);
  if (!finalMessage || finalMessage.role !== 'assistant') {
    throw new Error('Conversation turn is missing its final assistant message.');
  }
  const final = truncateMessage({...finalMessage, toolCalls: undefined}, perMessageBytes);
  return [first, final];
}

export function sessionEventsToConversationMessages(
  events: readonly SessionEvent[]
): ConversationSeedMessage[] {
  const messages: ConversationSeedMessage[] = [];
  let pendingUser: ConversationSeedMessage | null = null;

  for (const event of events) {
    if (event.kind !== 'default') continue;
    if (event.role === 'user') {
      pendingUser = {role: 'user', content: event.content};
      continue;
    }
    if (event.role === 'assistant' && pendingUser) {
      messages.push(pendingUser, {role: 'assistant', content: event.content});
      pendingUser = null;
    }
  }

  return messages;
}

export function createConversationHistory(options: ConversationHistoryOptions = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_HISTORY_BYTES;
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_HISTORY_TURNS;
  const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_HISTORY_MESSAGE_BYTES;
  assertPositiveInteger(maxBytes, 'maxBytes');
  assertPositiveInteger(maxTurns, 'maxTurns');
  assertPositiveInteger(maxMessageBytes, 'maxMessageBytes');
  if (maxBytes < 1024) {
    throw new Error('maxBytes must be at least 1024 bytes.');
  }

  const turns: ChatMessage[][] = [];

  function trimHistory() {
    while (
      turns.length > 1
      && (turns.length > maxTurns || serializedBytes(turns.flat()) > maxBytes)
    ) {
      turns.shift();
    }
  }

  function appendTurn(messages: readonly ChatMessage[]) {
    turns.push(compactTurn(messages, maxBytes, maxMessageBytes));
    trimHistory();
  }

  const initialMessages = options.initialMessages ?? [];
  let pendingUser: ConversationSeedMessage | null = null;
  for (const message of initialMessages) {
    if (message.role === 'user') {
      pendingUser = message;
    } else if (pendingUser) {
      appendTurn([
        {role: 'user', content: pendingUser.content},
        {role: 'assistant', content: message.content}
      ]);
      pendingUser = null;
    }
  }

  return {
    appendTurn,
    getMessages(): ChatMessage[] {
      return turns.flat().map((message) => truncateMessage(message, maxMessageBytes));
    },
    getTurnCount() {
      return turns.length;
    }
  };
}
