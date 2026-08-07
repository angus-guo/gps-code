import {realpath, stat} from 'node:fs/promises';
import {isAbsolute, relative} from 'node:path';
import {execa} from 'execa';
import {z} from 'zod';
import {classifyCommand} from '../permissions/policy.js';
import {resolveWorkspacePath} from '../tools/path-safety.js';
import type {CommandRequest, CommandResult} from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64_000;
const TRUNCATION_MARKER = '\n[output truncated]';

const commandRequestSchema = z.object({
  command: z.string().trim().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(10 * 60_000).default(DEFAULT_TIMEOUT_MS),
  maxOutputBytes: z.number().int().positive().max(10_000_000).default(DEFAULT_MAX_OUTPUT_BYTES)
});

type ParsedCommandRequest = z.output<typeof commandRequestSchema>;

function quoteCommandPart(part: string) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(part)) {
    return part;
  }

  return `'${part.replaceAll('\'', '\'\\\'\'')}'`;
}

export function formatCommandLine(command: string, args: string[] = []) {
  return [command, ...args].map(quoteCommandPart).join(' ');
}

function truncateOutput(output: string, maxBytes: number) {
  if (Buffer.byteLength(output, 'utf8') <= maxBytes) {
    return {output, truncated: false};
  }

  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, 'utf8');
  const keepBytes = Math.max(0, maxBytes - markerBytes);
  return {
    output: `${Buffer.from(output, 'utf8').subarray(0, keepBytes).toString('utf8')}${TRUNCATION_MARKER}`,
    truncated: true
  };
}

function asText(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

async function resolveCommandCwd(root: string, request: ParsedCommandRequest) {
  const canonicalRoot = await realpath(root);
  const requestedCwd = resolveWorkspacePath(canonicalRoot, request.cwd ?? '', {allowRoot: true});
  const stats = await stat(requestedCwd);
  if (!stats.isDirectory()) {
    throw new Error(`Command cwd is not a directory: ${request.cwd ?? '.'}`);
  }

  const cwd = await realpath(requestedCwd);
  const relativeCwd = relative(canonicalRoot, cwd);
  if (relativeCwd.startsWith('..') || isAbsolute(relativeCwd)) {
    throw new Error(`Command cwd is outside workspace: ${request.cwd ?? '.'}`);
  }

  return cwd;
}

function buildResult(
  parsed: ParsedCommandRequest,
  cwd: string,
  startedAt: number,
  raw: {
    exitCode?: number | null;
    timedOut?: boolean;
    stdout?: unknown;
    stderr?: unknown;
    message?: string;
  }
): CommandResult {
  const stdout = truncateOutput(asText(raw.stdout), parsed.maxOutputBytes);
  const stderrText = asText(raw.stderr) || (raw.exitCode === undefined ? asText(raw.message) : '');
  const stderr = truncateOutput(stderrText, parsed.maxOutputBytes);

  return {
    commandLine: formatCommandLine(parsed.command, parsed.args),
    cwd,
    exitCode: raw.timedOut ? null : raw.exitCode ?? null,
    timedOut: Boolean(raw.timedOut),
    durationMs: Date.now() - startedAt,
    stdout: stdout.output,
    stderr: stderr.output,
    truncated: stdout.truncated || stderr.truncated
  };
}

export async function runCommand(root: string, request: CommandRequest): Promise<CommandResult> {
  const parsed = commandRequestSchema.parse(request);

  // Hard enforcement point: no caller, including the manual /run path, can
  // execute a blocked command. Mode-dependent decisions stay in the TUI layer.
  const policy = classifyCommand(parsed);
  if (policy.classification === 'block') {
    throw new Error(`Command is blocked by policy: ${policy.reason ?? parsed.command}`);
  }

  const cwd = await resolveCommandCwd(root, parsed);
  const startedAt = Date.now();

  try {
    const result = await execa(parsed.command, parsed.args, {
      cwd,
      reject: false,
      shell: false,
      timeout: parsed.timeoutMs
    });

    return buildResult(parsed, cwd, startedAt, {
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stdout: result.stdout,
      stderr: result.stderr
    });
  } catch (error) {
    if (error && typeof error === 'object') {
      const commandError = error as {
        exitCode?: number | null;
        timedOut?: boolean;
        stdout?: unknown;
        stderr?: unknown;
        message?: string;
      };

      return buildResult(parsed, cwd, startedAt, commandError);
    }

    return buildResult(parsed, cwd, startedAt, {message: String(error)});
  }
}
