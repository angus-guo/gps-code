import {mkdir, writeFile, rm, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {buildRepoMap} from '../../src/workspace/indexer.js';

let tempDirs: string[] = [];

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'gps-code-workspace-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

describe('buildRepoMap', () => {
  it('detects a JS/TS project from package.json', async () => {
    const root = await makeProject();
    await writeFile(join(root, 'package.json'), JSON.stringify({scripts: {dev: 'vite', test: 'vitest'}}));
    await writeFile(join(root, 'tsconfig.json'), '{}');

    const map = await buildRepoMap(root);

    expect(map.root).toBe(root);
    expect(map.languages).toContain('javascript-typescript');
    expect(map.packageManagers).toContain('npm');
    expect(map.scripts).toContainEqual({name: 'dev', command: 'vite', source: 'package.json'});
    expect(map.keyFiles).toContain('package.json');
  });

  it('detects Python, Java, and C/C++ signals', async () => {
    const root = await makeProject();
    await mkdir(join(root, 'src', 'main', 'java'), {recursive: true});
    await writeFile(join(root, 'pyproject.toml'), '[project]\nname = "demo"\n');
    await writeFile(join(root, 'pom.xml'), '<project></project>');
    await writeFile(join(root, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.20)');

    const map = await buildRepoMap(root);

    expect(map.languages).toEqual(
      expect.arrayContaining(['python', 'java', 'c-cpp'])
    );
    expect(map.buildTools).toEqual(expect.arrayContaining(['maven', 'cmake']));
    expect(map.keyFiles).toEqual(expect.arrayContaining(['pyproject.toml', 'pom.xml', 'CMakeLists.txt']));
  });
});
