import type {LanguageDetectorResult} from '../types.js';

export function detectPython(files: Set<string>): LanguageDetectorResult {
  const keyFiles = ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile', 'poetry.lock', 'uv.lock']
    .filter((file) => files.has(file));

  if (keyFiles.length === 0) {
    return {};
  }

  const packageManagers = [
    files.has('poetry.lock') ? 'poetry' : null,
    files.has('uv.lock') ? 'uv' : null,
    files.has('requirements.txt') ? 'pip' : null
  ].filter((value): value is string => Boolean(value));

  return {
    languages: ['python'],
    packageManagers,
    keyFiles
  };
}
