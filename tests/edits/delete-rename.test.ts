import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {applyEditProposal} from '../../src/edits/apply.js';
import {prepareEditProposal} from '../../src/edits/proposal.js';
import {undoEditProposal} from '../../src/edits/undo.js';

let tempDirs: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'gps-code-test-'));
  tempDirs.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

describe('delete action', () => {
  it('removes an existing file', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'obsolete.ts'), 'export const OLD = true;\n', 'utf8');

    const proposal = await prepareEditProposal(root, {
      summary: '删除过时文件',
      files: [{
        path: 'obsolete.ts',
        reason: '已废弃',
        action: 'delete'
      }]
    });

    expect(proposal.files[0]).toMatchObject({
      action: 'delete',
      path: 'obsolete.ts',
      originalContent: 'export const OLD = true;\n',
      proposedContent: ''
    });
    expect(proposal.files[0].expectedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(proposal.files[0].proposedHash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );

    await applyEditProposal(root, proposal);
    await expect(readFile(join(root, 'obsolete.ts'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'});
  });

  it('undoes a delete by recreating the file from memory', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'data.json'), '{"key": "value"}\n', 'utf8');

    const proposal = await prepareEditProposal(root, {
      summary: '删除数据文件',
      files: [{path: 'data.json', reason: '测试撤销', action: 'delete'}]
    });

    await applyEditProposal(root, proposal);
    await expect(readFile(join(root, 'data.json'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'});

    await undoEditProposal(root, proposal);
    expect(await readFile(join(root, 'data.json'), 'utf8')).toBe('{"key": "value"}\n');
  });

  it('rejects delete when the file changed', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'stale.ts'), 'v1\n', 'utf8');

    const proposal = await prepareEditProposal(root, {
      summary: '删除',
      files: [{path: 'stale.ts', reason: '过时检测', action: 'delete'}]
    });

    await writeFile(join(root, 'stale.ts'), 'v2\n', 'utf8');
    await expect(applyEditProposal(root, proposal)).rejects.toThrow(/stale/i);
  });

  it('rejects delete with operations', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'file.ts'), 'content\n', 'utf8');

    await expect(prepareEditProposal(root, {
      summary: '无效删除',
      files: [{
        path: 'file.ts',
        reason: 'delete 不应接受 operations',
        action: 'delete',
        operations: [{oldText: 'content', newText: 'other'}]
      }]
    })).rejects.toThrow(/does not accept operations/i);
  });
});

describe('rename action', () => {
  it('moves a file without changing content', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'old.ts'), 'export const FOO = 1;\n', 'utf8');

    const proposal = await prepareEditProposal(root, {
      summary: '重命名文件',
      files: [{
        path: 'old.ts',
        reason: '改名为 new.ts',
        action: 'rename',
        newPath: 'new.ts'
      }]
    });

    expect(proposal.files[0]).toMatchObject({
      action: 'rename',
      path: 'old.ts',
      newPath: 'new.ts',
      originalContent: 'export const FOO = 1;\n',
      proposedContent: 'export const FOO = 1;\n'
    });
    expect(proposal.files[0].expectedHash).toBe(proposal.files[0].proposedHash);

    await applyEditProposal(root, proposal);
    await expect(readFile(join(root, 'old.ts'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'});
    expect(await readFile(join(root, 'new.ts'), 'utf8')).toBe('export const FOO = 1;\n');
  });

  it('undoes a rename by reversing the move', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'alpha.ts'), 'alpha\n', 'utf8');

    const proposal = await prepareEditProposal(root, {
      summary: '重命名为 beta',
      files: [{path: 'alpha.ts', reason: '测试撤销', action: 'rename', newPath: 'beta.ts'}]
    });

    await applyEditProposal(root, proposal);
    await expect(readFile(join(root, 'alpha.ts'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'});
    expect(await readFile(join(root, 'beta.ts'), 'utf8')).toBe('alpha\n');

    await undoEditProposal(root, proposal);
    expect(await readFile(join(root, 'alpha.ts'), 'utf8')).toBe('alpha\n');
    await expect(readFile(join(root, 'beta.ts'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'});
  });

  it('rejects rename when the source changed', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'source.ts'), 'v1\n', 'utf8');

    const proposal = await prepareEditProposal(root, {
      summary: '重命名',
      files: [{path: 'source.ts', reason: '过时检测', action: 'rename', newPath: 'dest.ts'}]
    });

    await writeFile(join(root, 'source.ts'), 'v2\n', 'utf8');
    await expect(applyEditProposal(root, proposal)).rejects.toThrow(/stale/i);
  });

  it('rejects rename when the target already exists', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'a.ts'), 'a\n', 'utf8');
    await writeFile(join(root, 'b.ts'), 'b\n', 'utf8');

    await expect(prepareEditProposal(root, {
      summary: '重命名冲突',
      files: [{path: 'a.ts', reason: 'b.ts 已存在', action: 'rename', newPath: 'b.ts'}]
    })).rejects.toThrow(/already exists/i);
  });

  it('rejects rename without newPath', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'file.ts'), 'content\n', 'utf8');

    await expect(prepareEditProposal(root, {
      summary: '无效重命名',
      files: [{path: 'file.ts', reason: '缺少 newPath', action: 'rename'}]
    })).rejects.toThrow(/requires newPath/i);
  });

  it('rejects rename with operations', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'file.ts'), 'content\n', 'utf8');

    await expect(prepareEditProposal(root, {
      summary: '无效重命名',
      files: [{
        path: 'file.ts',
        reason: 'rename 不应接受 operations',
        action: 'rename',
        newPath: 'other.ts',
        operations: [{oldText: 'content', newText: 'changed'}]
      }]
    })).rejects.toThrow(/does not accept operations/i);
  });

  it('rejects rename when source and target are the same', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'file.ts'), 'content\n', 'utf8');

    await expect(prepareEditProposal(root, {
      summary: '重命名为自身',
      files: [{path: 'file.ts', reason: '源和目标相同', action: 'rename', newPath: 'file.ts'}]
    })).rejects.toThrow(/same path/i);
  });
});

describe('action composition', () => {
  it('applies delete and create in one proposal', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'old-impl.ts'), 'old\n', 'utf8');

    const proposal = await prepareEditProposal(root, {
      summary: '替换实现',
      files: [
        {path: 'old-impl.ts', reason: '删除旧实现', action: 'delete'},
        {path: 'new-impl.ts', reason: '新实现', action: 'create', operations: [{oldText: '', newText: 'new\n'}]}
      ]
    });

    await applyEditProposal(root, proposal);
    await expect(readFile(join(root, 'old-impl.ts'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'});
    expect(await readFile(join(root, 'new-impl.ts'), 'utf8')).toBe('new\n');
  });

  it('rejects a proposal where two files rename to the same target', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'a.ts'), 'a\n', 'utf8');
    await writeFile(join(root, 'b.ts'), 'b\n', 'utf8');

    await expect(prepareEditProposal(root, {
      summary: '重命名冲突',
      files: [
        {path: 'a.ts', reason: '重命名为 c', action: 'rename', newPath: 'c.ts'},
        {path: 'b.ts', reason: '重命名为 c', action: 'rename', newPath: 'c.ts'}
      ]
    })).rejects.toThrow(/duplicate file paths/i);
  });
});
