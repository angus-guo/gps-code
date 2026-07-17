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
  if (edit.action === 'update') {
    if (!edit.expectedHash || hashContent(edit.originalContent) !== edit.expectedHash) {
      throw new Error(`Original content hash does not match the undo snapshot: ${edit.path}`);
    }
    return;
  }
  if (edit.expectedHash !== null || edit.originalContent !== '') {
    throw new Error(`Create edit has an invalid undo snapshot: ${edit.path}`);
  }
}

async function inspectForUndo(root: string, edit: PreparedFileEdit): Promise<UndoCandidate> {
  assertUndoSnapshot(edit);
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
  const current = await inspectExistingTextFile(root, item.edit.path);
  if (current.hash !== item.edit.proposedHash) {
    throw changedAfterApplyError(item.edit.path);
  }
}

async function rollbackUndoneCandidate(
  root: string,
  item: UndoneCandidate,
  dependencies: EditUndoDependencies,
  tempPaths: Set<string>
) {
  if (item.edit.action === 'create') {
    if (!item.backupPath) {
      throw new Error(`Missing undo backup for created file: ${item.edit.path}`);
    }
    await dependencies.rename(item.backupPath, item.targetPath);
    return;
  }

  const current = await inspectExistingTextFile(root, item.edit.path);
  if (current.hash !== item.edit.expectedHash) {
    throw new Error(`Cannot roll back undo because the restored file changed: ${item.edit.path}`);
  }
  const tempPath = await stageContent(item.targetPath, item.edit.proposedContent, item.mode);
  tempPaths.add(tempPath);
  await dependencies.rename(tempPath, item.targetPath);
  tempPaths.delete(tempPath);
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
      for (const item of candidates) {
        if (item.edit.action === 'update') {
          const tempPath = await stageContent(item.targetPath, item.edit.originalContent, item.mode);
          tempPaths.add(tempPath);
          staged.set(item.targetPath, tempPath);
        }
      }

      for (const item of candidates) {
        await recheckBeforeUndo(canonicalRoot, item);
        if (item.edit.action === 'create') {
          const backupPath = createBackupPath(item.targetPath);
          await dependencies.rename(item.targetPath, backupPath);
          backupPaths.add(backupPath);
          undone.push({...item, backupPath});
        } else {
          const tempPath = staged.get(item.targetPath);
          if (!tempPath) {
            throw new Error(`Missing staged undo content: ${item.edit.path}`);
          }
          await dependencies.rename(tempPath, item.targetPath);
          tempPaths.delete(tempPath);
          undone.push(item);
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
      files: proposal.files.map(({path, action}) => ({path, action}))
    };
  };
}

export const undoEditProposal = createEditUndoer();
