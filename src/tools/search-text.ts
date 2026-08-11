import {readFile} from 'node:fs/promises';
import {join, relative, sep} from 'node:path';
import {execa} from 'execa';
import fg from 'fast-glob';
import {z} from 'zod';
import {resolveWorkspacePath} from './path-safety.js';
import type {ToolDefinition} from './types.js';

const ignoredDirectoryNames = ['.git', 'node_modules', 'dist', 'coverage'];
const ignoredGlobs = ignoredDirectoryNames.map((directory) => `!${directory}/**`);

export const searchTextInputSchema = z.object({
  query: z.string().min(1),
  path: z.string().optional(),
  limit: z.number().int().positive().max(1000).default(50)
});

export type SearchTextInput = z.input<typeof searchTextInputSchema>;

type SearchMatch = {
  path: string;
  line: number;
  text: string;
};

function toPosixPath(path: string) {
  return sep === '/' ? path : path.split(sep).join('/');
}

function normalizeMatchPath(path: string) {
  // rg echoes the platform separator and prefixes matches with `./` (or `.\`
  // on Windows) when the search path is the workspace root. Every other tool
  // emits POSIX-style workspace-relative paths, and searchWithFallback below
  // already does, so normalize here to keep the two search backends agreeing.
  const posixPath = toPosixPath(path);
  return posixPath.startsWith('./') ? posixPath.slice(2) : posixPath;
}

function isIgnoredRelativePath(path: string) {
  return path.split('/').some((segment) => ignoredDirectoryNames.includes(segment));
}

function emptyResult(query: string, path: string) {
  return {
    content: 'Found 0 match(es).',
    metadata: {
      query,
      path,
      count: 0,
      total: 0,
      matches: [],
      truncated: false
    }
  };
}

function formatContent(matches: SearchMatch[], total: number) {
  if (total === 0) {
    return 'Found 0 match(es).';
  }

  const heading = matches.length < total
    ? `Showing ${matches.length} of ${total} match(es):`
    : `Found ${total} match(es):`;

  return `${heading}\n${matches.map((match) => `${match.path}:${match.line}:${match.text}`).join('\n')}`;
}

function parseRgOutput(stdout: string): SearchMatch[] {
  if (!stdout.trim()) {
    return [];
  }

  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const firstColon = line.indexOf(':');
      const secondColon = line.indexOf(':', firstColon + 1);
      if (firstColon === -1 || secondColon === -1) {
        return null;
      }

      const path = normalizeMatchPath(line.slice(0, firstColon));
      const lineNumber = Number(line.slice(firstColon + 1, secondColon));
      const text = line.slice(secondColon + 1);
      if (!Number.isInteger(lineNumber)) {
        return null;
      }

      return {path, line: lineNumber, text};
    })
    .filter((match): match is SearchMatch => Boolean(match))
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.text.localeCompare(b.text));
}

async function searchWithRg(root: string, targetPath: string, query: string) {
  const targetRelativePath = toPosixPath(relative(root, targetPath));
  const searchPath = targetRelativePath || '.';
  const globArgs = ignoredGlobs.flatMap((glob) => ['-g', glob]);
  const result = await execa(
    'rg',
    ['--line-number', '--no-heading', '--color', 'never', ...globArgs, query, searchPath],
    {cwd: root, reject: false}
  );

  if (result.exitCode === 0 || result.exitCode === 1) {
    return parseRgOutput(result.stdout);
  }

  throw new Error(result.stderr || `rg failed with exit code ${result.exitCode}`);
}

async function searchWithFallback(root: string, targetPath: string, query: string): Promise<SearchMatch[]> {
  const entries = await fg(['**/*'], {
    cwd: targetPath,
    dot: true,
    onlyFiles: true,
    ignore: ignoredDirectoryNames.map((directory) => `${directory}/**`)
  });
  const matches: SearchMatch[] = [];

  for (const entry of entries) {
    const absolutePath = join(targetPath, entry);
    const buffer = await readFile(absolutePath);
    if (buffer.includes(0)) {
      continue;
    }

    const lines = buffer.toString('utf8').split('\n');
    const path = toPosixPath(relative(root, absolutePath));
    lines.forEach((line, index) => {
      if (line.includes(query)) {
        matches.push({path, line: index + 1, text: line});
      }
    });
  }

  return matches.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.text.localeCompare(b.text));
}

async function searchText(root: string, targetPath: string, query: string) {
  try {
    return await searchWithRg(root, targetPath, query);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as {code?: string}).code === 'ENOENT'
    ) {
      return searchWithFallback(root, targetPath, query);
    }
    throw error;
  }
}

export const searchTextTool: ToolDefinition<SearchTextInput> = {
  name: 'search_text',
  description: 'Search text in the current workspace and return matching lines with file paths and line numbers.',
  inputSchema: searchTextInputSchema,
  async execute(input, context) {
    const parsed = searchTextInputSchema.parse(input);
    const targetPath = resolveWorkspacePath(context.root, parsed.path ?? '', {allowRoot: true});
    const targetRelativePath = toPosixPath(relative(context.root, targetPath));
    const path = parsed.path ?? '';

    if (targetRelativePath && isIgnoredRelativePath(targetRelativePath)) {
      return emptyResult(parsed.query, path);
    }

    const allMatches = await searchText(context.root, targetPath, parsed.query);
    const matches = allMatches.slice(0, parsed.limit);

    return {
      content: formatContent(matches, allMatches.length),
      metadata: {
        query: parsed.query,
        path,
        count: matches.length,
        total: allMatches.length,
        matches,
        truncated: matches.length < allMatches.length
      }
    };
  }
};
