import type {ModelConfig} from '../config/schema.js';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type ToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

export type ChatMessage =
  | {
    role: 'system' | 'user';
    content: string;
  }
  | {
    role: 'assistant';
    content?: string | null;
    toolCalls?: ToolCall[];
  }
  | {
    role: 'tool';
    toolCallId: string;
    content: string;
  };

export type ModelToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, Record<string, unknown>>;
      required?: string[];
      additionalProperties: false;
    };
  };
};

export type ModelRequest = {
  messages: ChatMessage[];
  tools?: ModelToolDefinition[];
  signal?: AbortSignal;
};

/** Thrown when a model request is aborted through its AbortSignal. */
export class ModelRequestAbortedError extends Error {
  constructor(message = 'Model request was cancelled.') {
    super(message);
    this.name = 'ModelRequestAbortedError';
  }
}

export type ModelResponse = {
  content: string;
  toolCalls: ToolCall[];
};

export type ModelClient = {
  chat(messages: ChatMessage[]): Promise<string>;
  complete(request: ModelRequest): Promise<ModelResponse>;
};

export type ModelClientConfig = ModelConfig;
