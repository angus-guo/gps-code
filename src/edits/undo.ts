import {randomUUID} from 'node:crypto';
import {chmod, open, rename, unlink} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {
  getCanonicalWorkspaceRoot,
  hashContent,
  inspectExistingTextFile
} from './file-safety.js';
import type {
  EditProposal,
  PreparedFileEdit,
  UndoEditResult
} from './types.js';
import {MAX_EDIT_FILES} from './types.js';

type UndoCandidate = {
  edit: PreparedFileEdit;
  targetPath: string;
  mode: number;
};

type UndoneCandidate = UndoCandidate & {
  backupPath?: string;
};

export type EditUndoDependencies = {
  rename: typeof rename;
};

const defaultDependencies: EditUndoDependencies = {rename};

function changedAfterApplyError(path: string) {
  return new Error(`Cannot undo because the file changed after GPS Code applied it: ${path}`);
}

function assertUndoSnapshot(edit: PreparedFileEdit) {
  if (hashContent(edit.proposedContent) !== edit.proposedHash) {
    throw new Error(`Proposed content hash does not match the undo snapshot: ${edit.path}`);
  }

  switch (edit.action) {
    case 'create':
      if (edit.expectedHash !== null || edit.originalContent !== '') {
        throw new Error(`Create edit has an invalid undo snapshot: ${edit.path}`);
      }
      break;
    case 'update':
    case 'delete':
      if (!edit.expectedHash || hashContent(edit.originalContent) !== edit.expectedHash) {
        throw new Error(`Original content hash does not match the undo snapshot: ${edit.path}`);
      }
      break;
    case 'rename':
      // A rename moves bytes without changing them, so the two hashes match.
      if (edit.expectedHash !== edit.proposedHash) {
        throw new Error(`Rename undo snapshot expected and proposed hashes must match: ${edit.path}`);
      }
      if (hashContent(edit.originalContent) !== edit.expectedHash) {
        throw new Error(`Original content hash does not match the undo snapshot: ${edit.path}`);
      }
      break;
  }
}

async function inspectForUndo(root: string, edit: PreparedFileEdit): Promise<UndoCandidate> {
  assertUndoSnapshot(edit);

  const canonicalRoot = await getCanonicalWorkspaceRoot(root);

  // Delete removed the file, so it can't be inspected. The proposal carries
  // originalContent and originalMode; those snapshots will be validated during
  // the undo commit.
  if (edit.action === 'delete') {
    if (!edit.originalMode) {
      throw new Error(`Delete undo snapshot is missing originalMode: ${edit.path}`);
    }
    return {
      edit,
      targetPath: join(canonicalRoot, edit.path),
      mode: edit.originalMode
    };
  }

  // Rename moved the file; inspect at the new location to confirm it still
  // matches proposedHash, but targetPath must be the *original* path because
  // that's where the undo will move it back to.
  if (edit.action === 'rename' && edit.newPath) {
    const current = await inspectExistingTextFile(root, edit.newPath);
    if (current.hash !== edit.proposedHash) {
      throw changedAfterApplyError(edit.newPath);
    }
    return {
      edit,
      targetPath: join(canonicalRoot, edit.path),
      mode: current.mode
    };
  }

  // create and update: the file is at its declared path.
  const current = await inspectExistingTextFile(root, edit.path);
  if (current.hash !== edit.proposedHash) {
    throw changedAfterApplyError(edit.path);
  }
  return {edit, targetPath: current.targetPath, mode: current.mode};
}

async function stageContent(targetPath: string, content: string, mode: number) {
  const tempPath = join(
    dirname(targetPath),
    `.gps-code-${basename(targetPath)}-${randomUUID()}.tmp`
  );
  const handle = await open(tempPath, 'wx', mode);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(tempPath, mode);
  return tempPath;
}

function createBackupPath(targetPath: string) {
  return join(
    dirname(targetPath),
    `.gps-code-${basename(targetPath)}-${randomUUID()}.undo`
  );
}

async function recheckBeforeUndo(root: string, item: UndoCandidate) {
  // Delete removed the file; recheck would fail. The commit validates the
  // written hash instead.
  if (item.edit.action === 'delete') {
    return;
  }

  const inspectPath = item.edit.action === 'rename' && item.edit.newPath
    ? item.edit.newPath
    : item.edit.path;

  const current = await inspectExistingTextFile(root, inspectPath);
  if (current.hash !== item.edit.proposedHash) {
    throw changedAfterApplyError(inspectPath);
  }
}

async function rollbackUndoneCandidate(
  root: string,
  item: UndoneCandidate,
  dependencies: EditUndoDependencies,
  tempPaths: Set<string>
) {
  switch (item.edit.action) {
    case 'create':
      // Undo moved the created file to backup; rollback moves it back.
      if (!item.backupPath) {
        throw new Error(`Missing undo backup for created file: ${item.edit.path}`);
      }
      await dependencies.rename(item.backupPath, item.targetPath);
      break;

    case 'delete': {
      // Undo recreated the file; rollback deletes it again.
      const current = await inspectExistingTextFile(root, item.edit.path);
      if (current.hash !== item.edit.expectedHash) {
        throw new Error(`Cannot roll back undo because the recreated file changed: ${item.edit.path}`);
      }
      await unlink(item.targetPath);
      break;
    }

    case 'rename': {
      // Undo reversed the rename; rollback reverses it again.
      const current = await inspectExistingTextFile(root, item.edit.path);
      if (current.hash !== item.edit.proposedHash) {
        throw new Error(`Cannot roll back undo because the restored file changed: ${item.edit.path}`);
      }
      const renameTo = join(await getCanonicalWorkspaceRoot(root), item.edit.newPath as string);
      await dependencies.rename(item.targetPath, renameTo);
      break;
    }

    case 'update': {
      // Undo restored the original content; rollback rewrites the applied content.
      const current = await inspectExistingTextFile(root, item.edit.path);
      if (current.hash !== item.edit.expectedHash) {
        throw new Error(`Cannot roll back undo because the restored file changed: ${item.edit.path}`);
      }
      const tempPath = await stageContent(item.targetPath, item.edit.proposedContent, item.mode);
      tempPaths.add(tempPath);
      await dependencies.rename(tempPath, item.targetPath);
      tempPaths.delete(tempPath);
      break;
    }
  }
}

export function createEditUndoer(
  overrides: Partial<EditUndoDependencies> = {}
) {
  const dependencies = {...defaultDependencies, ...overrides};

  return async function undoEditProposal(root: string, proposal: EditProposal): Promise<UndoEditResult> {
    if (proposal.files.length === 0 || proposal.files.length > MAX_EDIT_FILES) {
      throw new Error(`Undo snapshot must contain between 1 and ${MAX_EDIT_FILES} files.`);
    }
    const canonicalRoot = await getCanonicalWorkspaceRoot(root);
    const candidates = await Promise.all(
      proposal.files.map((edit) => inspectForUndo(canonicalRoot, edit))
    );
    const targetPaths = candidates.map((item) => item.targetPath);
    if (new Set(targetPaths).size !== targetPaths.length) {
      throw new Error('Undo snapshot contains duplicate file paths.');
    }

    const tempPaths = new Set<string>();
    const backupPaths = new Set<string>();
    const staged = new Map<string, string>();
    const undone: UndoneCandidate[] = [];

    try {
      // Stage: write restored content to temp for update. Delete recreates
      // directly; rename and create-undo operate in place (backup / reverse move).
      for (const item of candidates) {
        if (item.edit.action === 'update') {
          const mode = item.edit.originalMode ?? 0o644;
          const tempPath = await stageContent(item.targetPath, item.edit.originalContent, mode);
          tempPaths.add(tempPath);
          staged.set(item.targetPath, tempPath);
        }
        if (item.edit.action === 'delete') {
          const mode = item.edit.originalMode ?? 0o644;
          const tempPath = await stageContent(item.targetPath, item.edit.originalContent, mode);
          tempPaths.add(tempPath);
          staged.set(item.targetPath, tempPath);
        }
      }

      // Commit: reverse each action.
      for (const item of candidates) {
        await recheckBeforeUndo(canonicalRoot, item);

        switch (item.edit.action) {
          case 'create': {
            // Move the created file to backup, then delete it after all commits succeed.
            const backupPath = createBackupPath(item.targetPath);
            await dependencies.rename(item.targetPath, backupPath);
            backupPaths.add(backupPath);
            undone.push({...item, backupPath});
            break;
          }

          case 'update': {
            const tempPath = staged.get(item.targetPath);
            if (!tempPath) {
              throw new Error(`Missing staged undo content: ${item.edit.path}`);
            }
            await dependencies.rename(tempPath, item.targetPath);
            tempPaths.delete(tempPath);
            undone.push(item);
            break;
          }

          case 'delete': {
            // Recreate the file from originalContent.
            const tempPath = staged.get(item.targetPath);
            if (!tempPath) {
              throw new Error(`Missing staged undo content for deleted file: ${item.edit.path}`);
            }
            await dependencies.rename(tempPath, item.targetPath);
            tempPaths.delete(tempPath);
            undone.push(item);
            break;
          }

          case 'rename': {
            // Reverse the rename: move from newPath back to path.
            if (!item.edit.newPath) {
              throw new Error(`Rename undo is missing newPath: ${item.edit.path}`);
            }
            const renameTo = join(canonicalRoot, item.edit.newPath);
            await dependencies.rename(renameTo, item.targetPath);
            undone.push(item);
            break;
          }
        }
      }

      await Promise.all([...backupPaths].map(async (backupPath) => {
        try {
          await unlink(backupPath);
          backupPaths.delete(backupPath);
        } catch {
          // A successful undo remains valid if an obsolete backup cannot be removed.
        }
      }));
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const item of [...undone].reverse()) {
        try {
          await rollbackUndoneCandidate(canonicalRoot, item, dependencies, tempPaths);
          if (item.backupPath) {
            backupPaths.delete(item.backupPath);
          }
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      const rollbackMessage = rollbackErrors.length
        ? ` Rollback also failed: ${rollbackErrors.join('; ')}`
        : '';
      throw new Error(`Unable to undo edit proposal: ${message}.${rollbackMessage}`);
    } finally {
      await Promise.all([...tempPaths].map(async (path) => {
        try {
          await unlink(path);
        } catch {
          // A staged temporary file may already have been moved or removed.
        }
      }));
    }

    return {
      summary: proposal.summary,
      files: proposal.files.map(({path, action, newPath}) => ({path, action, newPath}))
    };
  };
}

export const undoEditProposal = createEditUndoer();
