import {chmod, mkdtemp, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function probe(run: (dir: string) => Promise<boolean>): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), 'gps-code-probe-'));
  try {
    return await run(dir);
  } catch {
    return false;
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

/**
 * Windows only permits symlink creation for administrators or with Developer
 * Mode enabled. Probed at runtime instead of keyed off process.platform, so
 * these tests still run on a Windows machine that allows it.
 */
export const canCreateSymlinks = await probe(async (dir) => {
  await writeFile(join(dir, 'target'), 'probe', 'utf8');
  await symlink(join(dir, 'target'), join(dir, 'link'));
  return true;
});

/**
 * NTFS does not carry POSIX permission bits: Node reports 0o666 for every file
 * regardless of chmod, so mode-preservation assertions cannot mean anything
 * there. The behavior being asserted is real on POSIX filesystems.
 */
export const canPersistFileModes = await probe(async (dir) => {
  const file = join(dir, 'probe');
  await writeFile(file, 'probe', 'utf8');
  await chmod(file, 0o750);
  return ((await stat(file)).mode & 0o777) === 0o750;
});
