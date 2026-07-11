import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {searchTextTool} from '../../src/tools/search-text.js';

let tempDirs: string[] = [];

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'gps-code-search-text-'));
  tempDirs.push(dir);
  return dir;
}

async function writeProjectFile(root: string, path: string, content: string) {
  const fullPath = join(root, path);
  await mkdir(join(fullPath, '..'), {recursive: true});
  await writeFile(fullPath, content, 'utf8');
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

describe('searchTextTool', () => {
  it('finds matching lines with file path and line number', async () => {
    const root = await makeProject();
    await writeProjectFile(root, 'src/auth.ts', 'export function login() {}\nexport function logout() {}\n');
    await writeProjectFile(root, 'README.md', 'Call login before requesting data.\n');

    const result = await searchTextTool.execute({query: 'login'}, {root});

    expect(result.content).toContain('Found 2 match(es)');
    expect(result.content).toContain('README.md:1:Call login before requesting data.');
    expect(result.content).toContain('src/auth.ts:1:export function login() {}');
    expect(result.metadata).toMatchObject({
      query: 'login',
      count: 2,
      total: 2,
      truncated: false
    });
    expect(result.metadata?.matches).toEqual([
      {path: 'README.md', line: 1, text: 'Call login before requesting data.'},
      {path: 'src/auth.ts', line: 1, text: 'export function login() {}'}
    ]);
  });

  it('limits result count', async () => {
    const root = await makeProject();
    await writeProjectFile(root, 'a.txt', 'needle one\n');
    await writeProjectFile(root, 'b.txt', 'needle two\n');
    await writeProjectFile(root, 'c.txt', 'needle three\n');

    const result = await searchTextTool.execute({query: 'needle', limit: 2}, {root});

    expect(result.metadata).toMatchObject({
      count: 2,
      total: 3,
      truncated: true
    });
    expect(result.content).toContain('Showing 2 of 3 match(es)');
    expect(result.content).not.toContain('c.txt:1:needle three');
  });

  it('returns empty result text when no matches exist', async () => {
    const root = await makeProject();
    await writeProjectFile(root, 'src/index.ts', 'console.log("hello");\n');

    const result = await searchTextTool.execute({query: 'missing'}, {root});

    expect(result.content).toBe('Found 0 match(es).');
    expect(result.metadata).toMatchObject({
      count: 0,
      total: 0,
      matches: [],
      truncated: false
    });
  });

  it('does not search ignored directories', async () => {
    const root = await makeProject();
    await writeProjectFile(root, 'src/index.ts', 'needle visible\n');
    await writeProjectFile(root, '.git/config', 'needle hidden\n');
    await writeProjectFile(root, 'node_modules/pkg/index.js', 'needle hidden\n');
    await writeProjectFile(root, 'dist/index.js', 'needle hidden\n');
    await writeProjectFile(root, 'coverage/report.txt', 'needle hidden\n');

    const result = await searchTextTool.execute({query: 'needle'}, {root});

    expect(result.metadata?.matches).toEqual([
      {path: 'src/index.ts', line: 1, text: 'needle visible'}
    ]);
    expect(result.content).not.toContain('node_modules');
    expect(result.content).not.toContain('.git');
    expect(result.content).not.toContain('dist/index.js');
    expect(result.content).not.toContain('coverage');
  });

  it('does not search when the requested path is ignored', async () => {
    const root = await makeProject();
    await writeProjectFile(root, 'node_modules/pkg/index.js', 'needle hidden\n');

    const result = await searchTextTool.execute({query: 'needle', path: 'node_modules'}, {root});

    expect(result.content).toBe('Found 0 match(es).');
    expect(result.metadata).toMatchObject({
      count: 0,
      total: 0,
      matches: []
    });
  });
});
