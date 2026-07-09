import fg from 'fast-glob';
import {detectJavaScript} from './languages/javascript.js';
import {detectPython} from './languages/python.js';
import {detectJava} from './languages/java.js';
import {detectCpp} from './languages/cpp.js';
import type {LanguageDetectorResult, RepoMap} from './types.js';

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function mergeResults(root: string, results: LanguageDetectorResult[]): RepoMap {
  return {
    root,
    languages: unique(results.flatMap((result) => result.languages ?? [])),
    frameworks: unique(results.flatMap((result) => result.frameworks ?? [])),
    packageManagers: unique(results.flatMap((result) => result.packageManagers ?? [])),
    buildTools: unique(results.flatMap((result) => result.buildTools ?? [])),
    scripts: results.flatMap((result) => result.scripts ?? []),
    keyFiles: unique(results.flatMap((result) => result.keyFiles ?? [])),
    keyDirectories: unique(results.flatMap((result) => result.keyDirectories ?? []))
  };
}

export async function buildRepoMap(root = process.cwd()): Promise<RepoMap> {
  const entries = await fg(['**/*'], {
    cwd: root,
    dot: true,
    onlyFiles: true,
    ignore: ['node_modules/**', '.git/**', 'dist/**', 'coverage/**']
  });
  const files = new Set(entries);
  const results = await Promise.all([
    detectJavaScript(root, files),
    Promise.resolve(detectPython(files)),
    Promise.resolve(detectJava(files)),
    Promise.resolve(detectCpp(files))
  ]);

  return mergeResults(root, results);
}
