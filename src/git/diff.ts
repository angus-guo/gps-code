import {realpath, stat} from 'node:fs/promises';
import {execa} from 'execa';
import {z} from 'zod';

const DEFAULT_MAX_STATUS_BYTES = 16_000;
const DEFAULT_MAX_STAT_BYTES = 16_000;
const DEFAULT_MAX_PATCH_BYTES = 32_000;
const TRUNCATION_MARKER = '\n[diff output truncated]';

const diffOptionsSchema = z.object({
  includePatch: z.boolean().default(true),
  maxStatusBytes: z.number().int().positive().max(1_000_000).default(DEFAULT_MAX_STATUS_BYTES),
  maxStatBytes: z.number().int().positive().max(1_000_000).default(DEFAULT_MAX_STAT_BYTES),
  maxPatchBytes: z.number().int().positive().max(5_000_000).default(DEFAULT_MAX_PATCH_BYTES)
});

export type WorkspaceDiffOptions = z.input<typeof diffOptionsSchema>;

export type WorkspaceDiff = {
  isGitRepository: boolean;
  hasChanges: boolean;
  status: string;
  stat: string;
  patch: string;
  truncated: boolean;
};

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

async function runGit(root: string, args: string[]) {
  return execa('git', args, {
    cwd: root,
    reject: false,
    shell: false
  });
}

export async function prepareWorkspaceDiff(
  root: string,
  options: WorkspaceDiffOptions = {}
): Promise<WorkspaceDiff> {
  const parsed = diffOptionsSchema.parse(options);
  const canonicalRoot = await realpath(root);
  const rootStats = await stat(canonicalRoot);
  if (!rootStats.isDirectory()) {
    throw new Error(`Workspace root is not a directory: ${root}`);
  }

  const repositoryCheck = await runGit(canonicalRoot, ['rev-parse', '--is-inside-work-tree']);
  if (repositoryCheck.exitCode !== 0 || repositoryCheck.stdout.trim() !== 'true') {
    return {
      isGitRepository: false,
      hasChanges: false,
      status: '',
      stat: '',
      patch: '',
      truncated: false
    };
  }

  const statusResult = await runGit(canonicalRoot, [
    'status',
    '--short',
    '--untracked-files=normal',
    '--',
    '.'
  ]);
  if (statusResult.exitCode !== 0) {
    throw new Error(`Unable to inspect git status: ${statusResult.stderr || 'unknown git error'}`);
  }

  const rawStatus = statusResult.stdout.trimEnd();
  if (!rawStatus) {
    return {
      isGitRepository: true,
      hasChanges: false,
      status: '',
      stat: '',
      patch: '',
      truncated: false
    };
  }

  const headCheck = await runGit(canonicalRoot, ['rev-parse', '--verify', 'HEAD']);
  const diffBaseArgs = headCheck.exitCode === 0 ? ['HEAD'] : ['--cached'];
  const [statResult, patchResult] = await Promise.all([
    runGit(canonicalRoot, ['diff', '--stat', ...diffBaseArgs, '--', '.']),
    parsed.includePatch
      ? runGit(canonicalRoot, [
        'diff',
        '--no-ext-diff',
        '--unified=3',
        ...diffBaseArgs,
        '--',
        '.'
      ])
      : Promise.resolve(null)
  ]);
  const rawStat = statResult.exitCode === 0 ? statResult.stdout.trimEnd() : '';
  const rawPatch = patchResult?.exitCode === 0 ? patchResult.stdout.trimEnd() : '';
  const status = truncateOutput(rawStatus, parsed.maxStatusBytes);
  const diffStat = truncateOutput(rawStat, parsed.maxStatBytes);
  const patch = truncateOutput(rawPatch, parsed.maxPatchBytes);

  return {
    isGitRepository: true,
    hasChanges: true,
    status: status.output,
    stat: diffStat.output,
    patch: patch.output,
    truncated: status.truncated || diffStat.truncated || patch.truncated
  };
}
