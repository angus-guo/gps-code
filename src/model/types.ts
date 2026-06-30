import type {ModelConfig} from '../config/schema.js';

export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ModelClient = {
  chat(messages: ChatMessage[]): Promise<string>;
};

export type ModelClientConfig = ModelConfig;
