import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {LanguageDetectorResult, RepoScript} from '../types.js';

export async function detectJavaScript(root: string, files: Set<string>): Promise<LanguageDetectorResult> {
  if (!files.has('package.json') && !files.has('tsconfig.json')) {
    return {};
  }

  const keyFiles = ['package.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js', 'next.config.js', 'next.config.mjs']
    .filter((file) => files.has(file));
  const packageManagers = [
    files.has('pnpm-lock.yaml') ? 'pnpm' : null,
    files.has('yarn.lock') ? 'yarn' : null,
    files.has('package-lock.json') ? 'npm' : null
  ].filter((value): value is string => Boolean(value));
  const scripts: RepoScript[] = [];
  const frameworks: string[] = [];

  if (files.has('package.json')) {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      scripts.push({name, command, source: 'package.json'});
    }
    const deps = {...pkg.dependencies, ...pkg.devDependencies};
    if ('vite' in deps) frameworks.push('vite');
    if ('next' in deps) frameworks.push('nextjs');
    if ('vue' in deps) frameworks.push('vue');
    if ('react' in deps) frameworks.push('react');
  }

  return {
    languages: ['javascript-typescript'],
    packageManagers: packageManagers.length > 0 ? packageManagers : ['npm'],
    frameworks,
    scripts,
    keyFiles
  };
}
