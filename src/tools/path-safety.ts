import {isAbsolute, relative, resolve} from 'node:path';

export type ResolveWorkspacePathOptions = {
  allowRoot?: boolean;
};

export function resolveWorkspacePath(
  root: string,
  inputPath: string,
  options: ResolveWorkspacePathOptions = {}
) {
  const normalizedRoot = resolve(root);
  if (!inputPath) {
    if (options.allowRoot) {
      return normalizedRoot;
    }
    throw new Error('Empty path is not allowed.');
  }

  const resolvedPath = isAbsolute(inputPath)
    ? resolve(inputPath)
    : resolve(normalizedRoot, inputPath);
  const relativePath = relative(normalizedRoot, resolvedPath);

  if (relativePath === '') {
    if (options.allowRoot) {
      return normalizedRoot;
    }
    throw new Error('Workspace root path is not allowed.');
  }

  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Path is outside workspace: ${inputPath}`);
  }

  return resolvedPath;
}
