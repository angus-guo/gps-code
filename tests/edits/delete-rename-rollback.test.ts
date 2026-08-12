import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {createEditApplier} from '../../src/edits/apply.js';
import {prepareEditProposal} from '../../src/edits/proposal.js';
import {createEditUndoer} from '../../src/edits/undo.js';

let tempDirs: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'gps-code-rollback-'));
  tempDirs.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

/**
 * Fails the Nth call to the named syscall. Used to interrupt a multi-file apply
 * partway through so the rollback path runs.
 */
function failOnCall(name: 'rename' | 'unlink' | 'link', failAt: number) {
  let calls = 0;
  return async (..._args: unknown[]) => {
    calls += 1;
    if (calls === failAt) {
      throw new Error(`injected ${name} failure on call ${failAt}`);
    }
    const real = await import('node:fs/promises');
    // @ts-expect-error dynamic dispatch to the real syscall
    return real[name](..._args);
  };
}

describe('delete rollback', () => {
  it('restores a deleted file when a later file in the batch fails', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'first.ts'), 'first content\n', 'utf8');
    await writeFile(join(root, 'second.ts'), 'second content\n', 'utf8');

    const proposal = await prepareEditProposal(root, {
      summary: '删除两个文件',
      files: [
        {path: 'first.ts', reason: '先删除', action: 'delete'},
        {path: 'second.ts', reason: '后删除但会失败', action: 'delete'}
      ]
    });

    // first.ts is unlinked on call 1; fail the second unlink so rollback must
    // recreate first.ts from the in-memory snapshot.
    const apply = createEditApplier({unlink: failOnCall('unlink', 2) as never});

    await expect(apply(root, proposal)).rejects.toThrow(/Unable to apply edit proposal/i);

    // Both files must be back to their original state.
    expect(await readFile(join(root, 'first.ts'), 'utf8')).toBe('first content\n');
    expect(await readFile(join(root, 'second.ts'), 'utf8')).toBe('second content\n');
  });

  it('restores a deleted file when a later create fails', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'doomed.ts'), 'doomed\n', 'utf8');

    const proposal = await prepareEditProposal(root, {
      summary: '删除后创建',
      files: [
        {path: 'doomed.ts', reason: '删除', action: 'delete'},
        {
          path: 'replacement.ts',
          reason: '创建替代文件',
          action: 'create',
          operations: [{oldText: '', newText: 'replacement\n'}]
        }
      ]
    });

    const apply = createEditApplier({link: failOnCall('link', 1) as never});

    await expect(apply(root, proposal)).rejects.toThrow(/Unable to apply edit proposal/i);

    expect(await readFile(join(root, 'doomed.ts'), 'utf8')).toBe('doomed\n');
    await expect(readFile(join(root, 'replacement.ts'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });
});

describe('rename rollback', () => {
  it('moves a renamed file back when a later file in the batch fails', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'alpha.ts'), 'alpha\n', 'utf8');
    await writeFile(join(root, 'target.ts'), 'target\n', 'utf8');

    const proposal = await prepareEditProposal(root, {
      summary: '重命名并更新',
      files: [
        {path: 'alpha.ts', reason: '重命名', action: 'rename', newPath: 'renamed.ts'},
        {
          path: 'target.ts',
          reason: '更新但会失败',
          action: 'update',
          operations: [{oldText: 'target', newText: 'updated'}]
        }
      ]
    });

    // Call 1 is the rename commit; fail call 2, which is the update's commit.
    const apply = createEditApplier({rename: failOnCall('rename', 2) as never});

    await expect(apply(root, proposal)).rejects.toThrow(/Unable to apply edit proposal/i);

    // alpha.ts must be back at its original path with its original content.
    expect(await readFile(join(root, 'alpha.ts'), 'utf8')).toBe('alpha\n');
    await expect(readFile(join(root, 'renamed.ts'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'});
    expect(await readFile(join(root, 'target.ts'), 'utf8')).toBe('target\n');
  });

  it('refuses to roll back a renamed file that changed at its new path', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'source.ts'), 'source\n', 'utf8');
    await writeFile(join(root, 'other.ts'), 'other\n', 'utf8');

    const proposal = await prepareEditProposal(root, {
      summary: '重命名并删除',
      files: [
        {path: 'source.ts', reason: '重命名', action: 'rename', newPath: 'moved.ts'},
        {path: 'other.ts', reason: '删除但会失败', action: 'delete'}
      ]
    });

    let renameCalls = 0;
    const apply = createEditApplier({
      async rename(...args: Parameters<typeof import('node:fs/promises').rename>) {
        renameCalls += 1;
        const real = await import('node:fs/promises');
        const result = await real.rename(...args);
        if (renameCalls === 1) {
          // Simulate an external process editing the file after it moved,
          // which must make the rollback refuse rather than clobber it.
          await writeFile(join(root, 'moved.ts'), 'externally changed\n', 'utf8');
        }
        return result;
      },
      unlink: failOnCall('unlink', 1) as never
    });

    await expect(apply(root, proposal)).rejects.toThrow(/Rollback also failed/i);

    // The externally modified file is preserved rather than silently reverted.
    expect(await readFile(join(root, 'moved.ts'), 'utf8')).toBe('externally changed\n');
  });
});

describe('undo rollback', () => {
  it('re-deletes a recreated file when a later undo step fails', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'one.ts'), 'one\n', 'utf8');
    await writeFile(join(root, 'two.ts'), 'two\n', 'utf8');

    const proposal = await prepareEditProposal(root, {
      summary: '删除两个文件',
      files: [
        {path: 'one.ts', reason: '删除', action: 'delete'},
        {path: 'two.ts', reason: '删除', action: 'delete'}
      ]
    });

    const {applyEditProposal} = await import('../../src/edits/apply.js');
    await applyEditProposal(root, proposal);

    // Both are gone; now fail the second restore during undo.
    const undo = createEditUndoer({rename: failOnCall('rename', 2) as never});

    await expect(undo(root, proposal)).rejects.toThrow(/Unable to undo edit proposal/i);

    // Rollback must return the workspace to the post-apply state: both deleted.
    await expect(readFile(join(root, 'one.ts'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'});
    await expect(readFile(join(root, 'two.ts'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'});
  });
});
