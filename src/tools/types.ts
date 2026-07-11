import type {z} from 'zod';
import type {CommandRequest} from '../commands/types.js';

export type ToolContext = {
  root: string;
};

export type ToolResult = {
  content: string;
  metadata?: Record<string, unknown>;
};

export type ToolDefinition<Input> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<Input>;
  execute(input: Input, context: ToolContext): Promise<ToolResult>;
};

export type ToolActivity = {
  toolName: string;
  input: unknown;
  status: 'started' | 'completed' | 'failed' | 'proposed';
  summary: string;
  command?: CommandRequest;
};
