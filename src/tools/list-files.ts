import fg from 'fast-glob';
import {join, relative, sep} from 'node:path';
import {z} from 'zod';
import {resolveWorkspacePath} from './path-safety.js';
import type {ToolDefinition} from './types.js';

const ignoredDirectoryNames = ['.git', 'node_modules', 'dist', 'coverage'];
const ignoredDirectories = ignoredDirectoryNames.map((directory) => `${directory}/**`);

export const listFilesInputSchema = z.object({
  path: z.string().optional(),
  limit: z.number().int().positive().max(1000).default(200)
});

export type ListFilesInput = z.input<typeof listFilesInputSchema>;

function toPosixPath(path: string) {
  return sep === '/' ? path : path.split(sep).join('/');
}

function formatContent(files: string[], total: number) {
  if (total === 0) {
    return 'Found 0 file(s).';
  }

  const heading = files.length < total
    ? `Showing ${files.length} of ${total} file(s):`
    : `Found ${total} file(s):`;

  return `${heading}\n${files.map((file) => `- ${file}`).join('\n')}`;
}

function isIgnoredRelativePath(path: string) {
  return path.split('/').some((segment) => ignoredDirectoryNames.includes(segment));
}

export const listFilesTool: ToolDefinition<ListFilesInput> = {
  name: 'list_files',
  description: 'List files in the current workspace, returning paths relative to the workspace root.',
  inputSchema: listFilesInputSchema,
  async execute(input, context) {
    const parsed = listFilesInputSchema.parse(input);
    const targetPath = resolveWorkspacePath(context.root, parsed.path ?? '', {allowRoot: true});
    const targetRelativePath = toPosixPath(relative(context.root, targetPath));
    if (targetRelativePath && isIgnoredRelativePath(targetRelativePath)) {
      return {
        content: formatContent([], 0),
        metadata: {
          path: parsed.path ?? '',
          count: 0,
          total: 0,
          files: [],
          truncated: false
        }
      };
    }

    const entries = await fg(['**/*'], {
      cwd: targetPath,
      dot: true,
      onlyFiles: true,
      ignore: ignoredDirectories
    });
    const allFiles = entries
      .map((entry) => toPosixPath(relative(context.root, join(targetPath, entry))))
      .sort();
    const files = allFiles.slice(0, parsed.limit);

    return {
      content: formatContent(files, allFiles.length),
      metadata: {
        path: parsed.path ?? '',
        count: files.length,
        total: allFiles.length,
        files,
        truncated: files.length < allFiles.length
      }
    };
  }
};
