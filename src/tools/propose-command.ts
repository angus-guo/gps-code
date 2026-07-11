import {relative, sep} from 'node:path';
import {z} from 'zod';
import {formatCommandLine} from '../commands/runner.js';
import type {CommandRequest} from '../commands/types.js';
import {resolveWorkspacePath} from './path-safety.js';
import type {ToolDefinition} from './types.js';

export const proposeCommandInputSchema = z.object({
  command: z.string().trim().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(10 * 60_000).optional(),
  maxOutputBytes: z.number().int().positive().max(10_000_000).optional(),
  reason: z.string().trim().min(1).optional()
});

export type ProposeCommandInput = z.input<typeof proposeCommandInputSchema>;

function toPosixPath(path: string) {
  return sep === '/' ? path : path.split(sep).join('/');
}

export function getProposedCommand(metadata: Record<string, unknown> | undefined): CommandRequest | null {
  const parsed = proposeCommandInputSchema.safeParse(metadata?.command);
  if (!parsed.success) {
    return null;
  }

  return {
    command: parsed.data.command,
    args: parsed.data.args,
    cwd: parsed.data.cwd,
    timeoutMs: parsed.data.timeoutMs,
    maxOutputBytes: parsed.data.maxOutputBytes
  };
}

function normalizeCommand(input: z.output<typeof proposeCommandInputSchema>, root: string): CommandRequest {
  const cwd = input.cwd === undefined
    ? undefined
    : toPosixPath(relative(root, resolveWorkspacePath(root, input.cwd, {allowRoot: true})));

  return {
    command: input.command,
    args: input.args,
    cwd,
    timeoutMs: input.timeoutMs,
    maxOutputBytes: input.maxOutputBytes
  };
}

export const proposeCommandTool: ToolDefinition<ProposeCommandInput> = {
  name: 'propose_command',
  description: 'Propose a workspace command for the user to confirm. This tool never executes the command.',
  inputSchema: proposeCommandInputSchema,
  async execute(input, context) {
    const parsed = proposeCommandInputSchema.parse(input);
    const command = normalizeCommand(parsed, context.root);
    const commandLine = formatCommandLine(command.command, command.args ?? []);
    const reason = parsed.reason ?? '建议用户确认后执行该命令。';

    return {
      content: [
        `Proposed command: ${commandLine}`,
        `Reason: ${reason}`,
        'This command has not been executed. The user must confirm it before GPS Code can run it.'
      ].join('\n'),
      metadata: {
        command,
        reason
      }
    };
  }
};
