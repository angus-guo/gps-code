import {chmod, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {applyEditProposal} from '../../src/edits/apply.js';
import {prepareEditProposal} from '../../src/edits/proposal.js';
import {createEditUndoer, undoEditProposal} from '../../src/edits/undo.js';

let tempDirs: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'gps-code-undo-'));
  tempDirs.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

describe('undoEditProposal', () => {
  it('restores updates, removes creates, and preserves file mode', async () => {
    const root = await makeRoot();
    const scriptPath = join(root, 'script.sh');
    await writeFile(scriptPath, '#!/bin/sh\necho before\n', 'utf8');
    await chmod(scriptPath, 0o755);
    const proposal = await prepareEditProposal(root, {
      summary: '更新脚本和文档',
      files: [
        {
          path: 'script.sh',
          reason: '更新输出',
          action: 'update',
          operations: [{oldText: 'before', newText: 'after'}]
        },
        {
          path: 'README.md',
          reason: '增加文档',
          action: 'create',
          operations: [{oldText: '', newText: '# Demo\n'}]
        }
      ]
    });
    await applyEditProposal(root, proposal);

    const result = await undoEditProposal(root, proposal);

    expect(await readFile(scriptPath, 'utf8')).toContain('echo before');
    expect((await stat(scriptPath)).mode & 0o777).toBe(0o755);
    await expect(readFile(join(root, 'README.md'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'});
    expect(result.files).toEqual([
      {path: 'script.sh', action: 'update'},
      {path: 'README.md', action: 'create'}
    ]);
    expect((await readdir(root)).some((name) => name.startsWith('.gps-code-'))).toBe(false);
  });

  it('refuses the entire undo when an updated file changed after apply', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'first.ts'), 'first before\n', 'utf8');
    await writeFile(join(root, 'second.ts'), 'second before\n', 'utf8');
    const proposal = await prepareEditProposal(root, {
      summary: '更新两个文件',
      files: [
        {path: 'first.ts', reason: '更新', action: 'update', operations: [{oldText: 'before', newText: 'after'}]},
        {path: 'second.ts', reason: '更新', action: 'update', operations: [{oldText: 'before', newText: 'after'}]}
      ]
    });
    await applyEditProposal(root, proposal);
    await writeFile(join(root, 'second.ts'), 'user changed\n', 'utf8');

    await expect(undoEditProposal(root, proposal)).rejects.toThrow(/changed after GPS Code applied/i);
    expect(await readFile(join(root, 'first.ts'), 'utf8')).toBe('first after\n');
    expect(await readFile(join(root, 'second.ts'), 'utf8')).toBe('user changed\n');
  });

  it('does not delete a created file that changed after apply', async () => {
    const root = await makeRoot();
    const proposal = await prepareEditProposal(root, {
      summary: '创建文件',
      files: [{path: 'new.ts', reason: '创建', action: 'create', operations: [{oldText: '', newText: 'generated\n'}]}]
    });
    await applyEditProposal(root, proposal);
    await writeFile(join(root, 'new.ts'), 'user changed\n', 'utf8');

    await expect(undoEditProposal(root, proposal)).rejects.toThrow(/changed after GPS Code applied/i);
    expect(await readFile(join(root, 'new.ts'), 'utf8')).toBe('user changed\n');
  });

  it('rolls back already undone files when a later restore fails', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'first.ts'), 'first before\n', 'utf8');
    await writeFile(join(root, 'second.ts'), 'second before\n', 'utf8');
    const proposal = await prepareEditProposal(root, {
      summary: '更新两个文件',
      files: [
        {path: 'first.ts', reason: '更新', action: 'update', operations: [{oldText: 'before', newText: 'after'}]},
        {path: 'second.ts', reason: '更新', action: 'update', operations: [{oldText: 'before', newText: 'after'}]}
      ]
    });
    await applyEditProposal(root, proposal);
    let renameCalls = 0;
    const {rename: realRename} = await import('node:fs/promises');
    const undoWithFailure = createEditUndoer({
      async rename(oldPath, newPath) {
        renameCalls += 1;
        if (renameCalls === 2) {
          throw new Error('injected second-file failure');
        }
        await realRename(oldPath, newPath);
      }
    });

    await expect(undoWithFailure(root, proposal)).rejects.toThrow(/injected second-file failure/i);
    expect(await readFile(join(root, 'first.ts'), 'utf8')).toBe('first after\n');
    expect(await readFile(join(root, 'second.ts'), 'utf8')).toBe('second after\n');
    expect((await readdir(root)).some((name) => name.startsWith('.gps-code-'))).toBe(false);
  });

  it('preserves a created-file backup when undo rollback also fails', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'existing.ts'), 'before\n', 'utf8');
    const proposal = await prepareEditProposal(root, {
      summary: '创建并更新文件',
      files: [
        {
          path: 'created.ts',
          reason: '创建文件',
          action: 'create',
          operations: [{oldText: '', newText: 'created content\n'}]
        },
        {
          path: 'existing.ts',
          reason: '更新文件',
          action: 'update',
          operations: [{oldText: 'before', newText: 'after'}]
        }
      ]
    });
    await applyEditProposal(root, proposal);
    let renameCalls = 0;
    const {rename: realRename} = await import('node:fs/promises');
    const undoWithRollbackFailure = createEditUndoer({
      async rename(oldPath, newPath) {
        renameCalls += 1;
        if (renameCalls === 2) {
          throw new Error('injected later undo failure');
        }
        if (renameCalls === 3) {
          throw new Error('injected rollback failure');
        }
        await realRename(oldPath, newPath);
      }
    });

    await expect(undoWithRollbackFailure(root, proposal)).rejects.toThrow(/rollback also failed/i);
    const backupName = (await readdir(root)).find((name) => name.endsWith('.undo'));
    expect(backupName).toBeDefined();
    expect(await readFile(join(root, backupName!), 'utf8')).toBe('created content\n');
    expect(await readFile(join(root, 'existing.ts'), 'utf8')).toBe('after\n');
  });
});
