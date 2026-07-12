import {chmod, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {applyEditProposal, createEditApplier} from '../../src/edits/apply.js';
import {prepareEditProposal} from '../../src/edits/proposal.js';

let tempDirs: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'gps-code-apply-'));
  tempDirs.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

describe('applyEditProposal', () => {
  it('atomically applies updates and creates while preserving file mode', async () => {
    const root = await makeRoot();
    const scriptPath = join(root, 'script.sh');
    await writeFile(scriptPath, '#!/bin/sh\necho before\n', 'utf8');
    await chmod(scriptPath, 0o755);
    const proposal = await prepareEditProposal(root, {
      summary: '更新脚本并增加说明',
      files: [
        {
          path: 'script.sh',
          reason: '更新输出',
          action: 'update',
          operations: [{oldText: 'echo before', newText: 'echo after'}]
        },
        {
          path: 'README.md',
          reason: '增加说明',
          action: 'create',
          operations: [{oldText: '', newText: '# Demo\n'}]
        }
      ]
    });

    const result = await applyEditProposal(root, proposal);

    expect(await readFile(scriptPath, 'utf8')).toContain('echo after');
    expect((await stat(scriptPath)).mode & 0o777).toBe(0o755);
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('# Demo\n');
    expect(result.files).toEqual([
      expect.objectContaining({path: 'script.sh', action: 'update'}),
      expect.objectContaining({path: 'README.md', action: 'create', previousHash: null})
    ]);
    expect((await readdir(root)).some((name) => name.startsWith('.gps-code-'))).toBe(false);
  });

  it('rejects stale updates before writing any proposal files', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'first.ts'), 'first before\n', 'utf8');
    await writeFile(join(root, 'second.ts'), 'second before\n', 'utf8');
    const proposal = await prepareEditProposal(root, {
      summary: '更新两个文件',
      files: [
        {
          path: 'first.ts',
          reason: '第一个修改',
          action: 'update',
          operations: [{oldText: 'before', newText: 'after'}]
        },
        {
          path: 'second.ts',
          reason: '第二个修改',
          action: 'update',
          operations: [{oldText: 'before', newText: 'after'}]
        }
      ]
    });
    await writeFile(join(root, 'second.ts'), 'user changed this\n', 'utf8');

    await expect(applyEditProposal(root, proposal)).rejects.toThrow(/stale/i);
    expect(await readFile(join(root, 'first.ts'), 'utf8')).toBe('first before\n');
    expect(await readFile(join(root, 'second.ts'), 'utf8')).toBe('user changed this\n');
  });

  it('rejects a create proposal when the target appeared after preview', async () => {
    const root = await makeRoot();
    const proposal = await prepareEditProposal(root, {
      summary: '创建文件',
      files: [{
        path: 'new.ts',
        reason: '增加文件',
        action: 'create',
        operations: [{oldText: '', newText: 'proposed\n'}]
      }]
    });
    await writeFile(join(root, 'new.ts'), 'user content\n', 'utf8');

    await expect(applyEditProposal(root, proposal)).rejects.toThrow(/already exists/i);
    expect(await readFile(join(root, 'new.ts'), 'utf8')).toBe('user content\n');
  });

  it('rejects tampered proposed content before writing', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'app.ts'), 'before\n', 'utf8');
    const proposal = await prepareEditProposal(root, {
      summary: '更新文件',
      files: [{
        path: 'app.ts',
        reason: '修改内容',
        action: 'update',
        operations: [{oldText: 'before', newText: 'after'}]
      }]
    });
    proposal.files[0].proposedContent = 'tampered\n';

    await expect(applyEditProposal(root, proposal)).rejects.toThrow(/hash does not match/i);
    expect(await readFile(join(root, 'app.ts'), 'utf8')).toBe('before\n');
  });

  it('rejects a tampered original snapshot and duplicate targets', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'app.ts'), 'before\n', 'utf8');
    const proposal = await prepareEditProposal(root, {
      summary: '更新文件',
      files: [{
        path: 'app.ts',
        reason: '修改内容',
        action: 'update',
        operations: [{oldText: 'before', newText: 'after'}]
      }]
    });
    proposal.files[0].originalContent = 'wrong snapshot\n';

    await expect(applyEditProposal(root, proposal)).rejects.toThrow(/original content hash/i);
    proposal.files[0].originalContent = 'before\n';
    proposal.files.push({...proposal.files[0], path: './app.ts'});
    await expect(applyEditProposal(root, proposal)).rejects.toThrow(/duplicate/i);
    expect(await readFile(join(root, 'app.ts'), 'utf8')).toBe('before\n');
  });

  it('rolls back already applied files when a later commit fails', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'first.ts'), 'first before\n', 'utf8');
    await writeFile(join(root, 'second.ts'), 'second before\n', 'utf8');
    const proposal = await prepareEditProposal(root, {
      summary: '更新两个文件',
      files: [
        {
          path: 'first.ts',
          reason: '第一个修改',
          action: 'update',
          operations: [{oldText: 'before', newText: 'after'}]
        },
        {
          path: 'second.ts',
          reason: '第二个修改',
          action: 'update',
          operations: [{oldText: 'before', newText: 'after'}]
        }
      ]
    });
    let renameCalls = 0;
    const {rename: realRename} = await import('node:fs/promises');
    const applyWithFailure = createEditApplier({
      async rename(oldPath, newPath) {
        renameCalls += 1;
        if (renameCalls === 2) {
          throw new Error('injected second-file failure');
        }
        await realRename(oldPath, newPath);
      }
    });

    await expect(applyWithFailure(root, proposal)).rejects.toThrow(/injected second-file failure/i);
    expect(await readFile(join(root, 'first.ts'), 'utf8')).toBe('first before\n');
    expect(await readFile(join(root, 'second.ts'), 'utf8')).toBe('second before\n');
    expect((await readdir(root)).some((name) => name.startsWith('.gps-code-'))).toBe(false);
  });

  it('rolls back a created file when temp cleanup fails after linking', async () => {
    const root = await makeRoot();
    const proposal = await prepareEditProposal(root, {
      summary: '创建文件',
      files: [{
        path: 'created.ts',
        reason: '测试创建回滚',
        action: 'create',
        operations: [{oldText: '', newText: 'created\n'}]
      }]
    });
    let unlinkCalls = 0;
    const {unlink: realUnlink} = await import('node:fs/promises');
    const applyWithFailure = createEditApplier({
      async unlink(path) {
        unlinkCalls += 1;
        if (unlinkCalls === 1) {
          throw new Error('injected temp cleanup failure');
        }
        await realUnlink(path);
      }
    });

    await expect(applyWithFailure(root, proposal)).rejects.toThrow(/temp cleanup failure/i);
    await expect(readFile(join(root, 'created.ts'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'});
    expect((await readdir(root)).some((name) => name.startsWith('.gps-code-'))).toBe(false);
  });
});
