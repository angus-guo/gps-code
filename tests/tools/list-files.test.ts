import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {listFilesTool} from '../../src/tools/list-files.js';

let tempDirs: string[] = [];

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'gps-code-list-files-'));
  tempDirs.push(dir);
  return dir;
}

async function writeProjectFile(root: string, path: string, content = '') {
  const fullPath = join(root, path);
  await mkdir(join(fullPath, '..'), {recursive: true});
  await writeFile(fullPath, content, 'utf8');
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

describe('listFilesTool', () => {
  it('lists workspace files relative to root', async () => {
    const root = await makeProject();
    await writeProjectFile(root, 'package.json', '{}');
    await writeProjectFile(root, 'src/index.ts', 'console.log("hi");');

    const result = await listFilesTool.execute({}, {root});

    expect(result.content).toContain('Found 2 file(s)');
    expect(result.content).toContain('- package.json');
    expect(result.content).toContain('- src/index.ts');
    expect(result.metadata).toMatchObject({
      count: 2,
      total: 2,
      files: ['package.json', 'src/index.ts'],
      truncated: false
    });
  });

  it('ignores generated and dependency directories', async () => {
    const root = await makeProject();
    await writeProjectFile(root, 'src/index.ts');
    await writeProjectFile(root, '.git/config');
    await writeProjectFile(root, 'node_modules/pkg/index.js');
    await writeProjectFile(root, 'dist/index.js');
    await writeProjectFile(root, 'coverage/report.txt');

    const result = await listFilesTool.execute({}, {root});

    expect(result.metadata?.files).toEqual(['src/index.ts']);
    expect(result.content).not.toContain('node_modules');
    expect(result.content).not.toContain('.git');
    expect(result.content).not.toContain('dist/index.js');
    expect(result.content).not.toContain('coverage');
  });

  it('respects an optional limit', async () => {
    const root = await makeProject();
    await writeProjectFile(root, 'a.ts');
    await writeProjectFile(root, 'b.ts');
    await writeProjectFile(root, 'c.ts');

    const result = await listFilesTool.execute({limit: 2}, {root});

    expect(result.metadata).toMatchObject({
      count: 2,
      total: 3,
      files: ['a.ts', 'b.ts'],
      truncated: true
    });
    expect(result.content).toContain('Showing 2 of 3 file(s)');
    expect(result.content).not.toContain('- c.ts');
  });

  it('lists files under an optional subdirectory', async () => {
    const root = await makeProject();
    await writeProjectFile(root, 'src/index.ts');
    await writeProjectFile(root, 'tests/index.test.ts');

    const result = await listFilesTool.execute({path: 'src'}, {root});

    expect(result.metadata?.files).toEqual(['src/index.ts']);
  });

  it('does not list files when the requested path is ignored', async () => {
    const root = await makeProject();
    await writeProjectFile(root, 'node_modules/pkg/index.js');

    const result = await listFilesTool.execute({path: 'node_modules'}, {root});

    expect(result.metadata).toMatchObject({
      count: 0,
      total: 0,
      files: []
    });
    expect(result.content).toBe('Found 0 file(s).');
  });
});
