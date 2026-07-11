import {readFile, stat} from 'node:fs/promises';
import {relative, sep} from 'node:path';
import {z} from 'zod';
import {resolveWorkspacePath} from './path-safety.js';
import type {ToolDefinition} from './types.js';

const defaultMaxBytes = 64_000;

export const readFileInputSchema = z.object({
  path: z.string().min(1),
  maxBytes: z.number().int().positive().max(1_000_000).default(defaultMaxBytes)
});

export type ReadFileInput = z.input<typeof readFileInputSchema>;

function toPosixPath(path: string) {
  return sep === '/' ? path : path.split(sep).join('/');
}

function isLikelyBinary(buffer: Buffer) {
  return buffer.includes(0);
}

function countLines(content: string) {
  if (content.length === 0) {
    return 0;
  }
  return content.endsWith('\n')
    ? content.slice(0, -1).split('\n').length
    : content.split('\n').length;
}

export const readFileTool: ToolDefinition<ReadFileInput> = {
  name: 'read_file',
  description: 'Read a UTF-8 text file from the current workspace.',
  inputSchema: readFileInputSchema,
  async execute(input, context) {
    const parsed = readFileInputSchema.parse(input);
    const filePath = resolveWorkspacePath(context.root, parsed.path);
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      throw new Error(`Path is not a file: ${parsed.path}`);
    }

    if (fileStat.size > parsed.maxBytes) {
      throw new Error(`File is too large: ${parsed.path} (${fileStat.size} bytes > ${parsed.maxBytes} bytes)`);
    }

    const buffer = await readFile(filePath);
    if (isLikelyBinary(buffer)) {
      throw new Error(`File appears to be binary: ${parsed.path}`);
    }

    const content = buffer.toString('utf8');
    const relativePath = toPosixPath(relative(context.root, filePath));

    return {
      content,
      metadata: {
        path: relativePath,
        bytes: fileStat.size,
        lineCount: countLines(content)
      }
    };
  }
};
