import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  getProposedFileEdits,
  proposeFileEditsTool
} from '../../src/tools/propose-file-edits.js';

let tempDirs: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'gps-code-propose-edits-'));
  tempDirs.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

describe('proposeFileEditsTool', () => {
  it('prepares an update proposal without writing the file', async () => {
    const root = await makeRoot();
    const path = join(root, 'app.ts');
    await writeFile(path, 'const answer = 41;\n', 'utf8');

    const result = await proposeFileEditsTool.execute({
      summary: '修正答案',
      files: [{
        path: 'app.ts',
        reason: '修正错误常量',
        action: 'update',
        operations: [{oldText: '41', newText: '42'}]
      }]
    }, {root});
    const proposed = getProposedFileEdits(result.metadata);

    expect(result.content).toContain('No files have been changed');
    expect(result.modelMetadata).toMatchObject({applied: false});
    expect(proposed?.proposal.files[0].proposedContent).toContain('42');
    expect(proposed?.preview.files[0].patch).toContain('+const answer = 42;');
    expect(await readFile(path, 'utf8')).toBe('const answer = 41;\n');
  });

  it('rejects ambiguous update text', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'app.ts'), 'same\nsame\n', 'utf8');

    await expect(proposeFileEditsTool.execute({
      summary: '模糊修改',
      files: [{
        path: 'app.ts',
        reason: '匹配不唯一',
        action: 'update',
        operations: [{oldText: 'same', newText: 'changed'}]
      }]
    }, {root})).rejects.toThrow(/exactly once/i);
  });
});

describe('getProposedFileEdits', () => {
  it('returns null for invalid or missing metadata', () => {
    expect(getProposedFileEdits(undefined)).toBeNull();
    expect(getProposedFileEdits({editProposal: {summary: 'invalid'}})).toBeNull();
  });
});
