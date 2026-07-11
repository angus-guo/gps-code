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
};

export type ModelResponse = {
  content: string;
  toolCalls: ToolCall[];
};

export type ModelClient = {
  chat(messages: ChatMessage[]): Promise<string>;
  complete(request: ModelRequest): Promise<ModelResponse>;
};

export type ModelClientConfig = ModelConfig;
