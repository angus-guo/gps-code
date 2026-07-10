import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {readFileTool} from '../../src/tools/read-file.js';

let tempDirs: string[] = [];

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'gps-code-read-file-'));
  tempDirs.push(dir);
  return dir;
}

async function writeProjectFile(root: string, path: string, content: string | Buffer) {
  const fullPath = join(root, path);
  await mkdir(join(fullPath, '..'), {recursive: true});
  await writeFile(fullPath, content);
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

describe('readFileTool', () => {
  it('reads a UTF-8 text file under the workspace', async () => {
    const root = await makeProject();
    await writeProjectFile(root, 'src/index.ts', 'const answer = 42;\nconsole.log(answer);\n');

    const result = await readFileTool.execute({path: 'src/index.ts'}, {root});

    expect(result.content).toContain('const answer = 42;');
    expect(result.content).toContain('console.log(answer);');
    expect(result.metadata).toMatchObject({
      path: 'src/index.ts',
      bytes: 40,
      lineCount: 2
    });
  });

  it('rejects parent traversal outside the workspace', async () => {
    const root = await makeProject();

    await expect(readFileTool.execute({path: '../outside.txt'}, {root})).rejects.toThrow(/outside workspace/i);
  });

  it('rejects directories', async () => {
    const root = await makeProject();
    await mkdir(join(root, 'src'), {recursive: true});

    await expect(readFileTool.execute({path: 'src'}, {root})).rejects.toThrow(/not a file/i);
  });

  it('rejects files larger than the configured max bytes', async () => {
    const root = await makeProject();
    await writeProjectFile(root, 'large.txt', '1234567890');

    await expect(readFileTool.execute({path: 'large.txt', maxBytes: 5}, {root})).rejects.toThrow(/too large/i);
  });

  it('rejects binary files', async () => {
    const root = await makeProject();
    await writeProjectFile(root, 'image.bin', Buffer.from([0x47, 0x50, 0x53, 0x00, 0x01]));

    await expect(readFileTool.execute({path: 'image.bin'}, {root})).rejects.toThrow(/binary/i);
  });
});
