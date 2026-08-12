import {randomUUID} from 'node:crypto';
import {
  chmod,
  link,
  open,
  rename,
  unlink
} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {
  getCanonicalWorkspaceRoot,
  hashContent,
  inspectExistingTextFile,
  resolveSafeCreateTarget
} from './file-safety.js';
import type {
  ApplyEditResult,
  EditProposal,
  PreparedFileEdit
} from './types.js';
import {MAX_EDIT_FILES} from './types.js';

type StagedFileEdit = {
  edit: PreparedFileEdit;
  targetPath: string;
  /** Only present for create and update, which write content. */
  tempPath?: string;
  /** Rename target, only present for that action. */
  renameTo?: string;
  mode: number;
};

type AppliedFile = StagedFileEdit;

export type EditApplyDependencies = {
  rename: typeof rename;
  link: typeof link;
  unlink: typeof unlink;
};

const defaultDependencies: EditApplyDependencies = {rename, link, unlink};

function staleProposalError(path: string) {
  return new Error(`Edit proposal is stale because the file changed: ${path}`);
}

function assertProposedHash(edit: PreparedFileEdit) {
  if (hashContent(edit.proposedContent) !== edit.proposedHash) {
    throw new Error(`Proposed content hash does not match: ${edit.path}`);
  }

  switch (edit.action) {
    case 'create':
      if (edit.originalContent !== '') {
        throw new Error(`Create proposal has unexpected original content: ${edit.path}`);
      }
      break;
    case 'update':
    case 'delete':
      if (hashContent(edit.originalContent) !== edit.expectedHash) {
        throw new Error(`Original content hash does not match: ${edit.path}`);
      }
      break;
    case 'rename':
      // Renames move bytes without changing them, so the two hashes match.
      if (edit.expectedHash !== edit.proposedHash) {
        throw new Error(`Rename expected and proposed hashes must match: ${edit.path}`);
      }
      if (hashContent(edit.originalContent) !== edit.expectedHash) {
        throw new Error(`Original content hash does not match: ${edit.path}`);
      }
      break;
  }
}

async function inspectForApply(root: string, edit: PreparedFileEdit) {
  assertProposedHash(edit);

  if (edit.action === 'create') {
    if (edit.expectedHash !== null) {
      throw new Error(`Create proposal has an unexpected original hash: ${edit.path}`);
    }
    const target = await resolveSafeCreateTarget(root, edit.path);
    return {targetPath: target.targetPath, mode: target.mode};
  }

  if (edit.action === 'rename') {
    if (!edit.newPath) {
      throw new Error(`Rename proposal is missing newPath: ${edit.path}`);
    }
    const current = await inspectExistingTextFile(root, edit.path);
    if (current.hash !== edit.expectedHash) {
      throw staleProposalError(edit.path);
    }
    const target = await resolveSafeCreateTarget(root, edit.newPath);
    return {targetPath: current.targetPath, renameTo: target.targetPath, mode: current.mode};
  }

  // update and delete: inspect the source file.
  if (!edit.expectedHash) {
    throw new Error(`${edit.action} proposal is missing an expected hash: ${edit.path}`);
  }
  const current = await inspectExistingTextFile(root, edit.path);
  if (current.hash !== edit.expectedHash) {
    throw staleProposalError(edit.path);
  }
  return {targetPath: current.targetPath, mode: current.mode};
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

async function recheckBeforeCommit(root: string, staged: StagedFileEdit) {
  const {edit} = staged;

  if (edit.action === 'create') {
    await resolveSafeCreateTarget(root, edit.path);
    return;
  }

  if (edit.action === 'rename') {
    await resolveSafeCreateTarget(root, edit.newPath as string);
    // The source file must still match the expected hash; if it changed
    // between stage and commit, another process is modifying the workspace.
    const current = await inspectExistingTextFile(root, edit.path);
    if (current.hash !== edit.expectedHash) {
      throw staleProposalError(edit.path);
    }
    return;
  }

  // update and delete: the file must still match the proposal's baseline.
  const current = await inspectExistingTextFile(root, edit.path);
  if (current.hash !== edit.expectedHash) {
    throw staleProposalError(edit.path);
  }
}

async function rollbackAppliedFile(
  root: string,
  applied: AppliedFile,
  dependencies: EditApplyDependencies,
  tempPaths: Set<string>
) {
  const {edit, targetPath, renameTo} = applied;

  if (edit.action === 'create') {
    const current = await inspectExistingTextFile(root, edit.path);
    if (current.hash !== edit.proposedHash) {
      throw new Error(`Cannot roll back a created file that changed: ${edit.path}`);
    }
    await dependencies.unlink(targetPath);
    return;
  }

  if (edit.action === 'delete') {
    // The file is gone; recreate it from the proposal's originalContent.
    // originalMode is why we store the mode in the proposal: once the file is
    // deleted, we can't read it back from disk.
    const mode = edit.originalMode ?? 0o644;
    const rollbackTempPath = await stageContent(targetPath, edit.originalContent, mode);
    tempPaths.add(rollbackTempPath);
    await dependencies.rename(rollbackTempPath, targetPath);
    tempPaths.delete(rollbackTempPath);
    return;
  }

  if (edit.action === 'rename') {
    if (!renameTo) {
      throw new Error(`Rename rollback is missing renameTo: ${edit.path}`);
    }
    // The file now sits at renameTo; move it back.
    const current = await inspectExistingTextFile(root, edit.newPath as string);
    if (current.hash !== edit.proposedHash) {
      throw new Error(`Cannot roll back a renamed file that changed: ${edit.newPath}`);
    }
    await dependencies.rename(renameTo, targetPath);
    return;
  }

  // update: revert the content.
  const current = await inspectExistingTextFile(root, edit.path);
  if (current.hash !== edit.proposedHash) {
    throw new Error(`Cannot roll back an updated file that changed: ${edit.path}`);
  }
  const mode = edit.originalMode ?? 0o644;
  const rollbackTempPath = await stageContent(targetPath, edit.originalContent, mode);
  tempPaths.add(rollbackTempPath);
  await dependencies.rename(rollbackTempPath, targetPath);
  tempPaths.delete(rollbackTempPath);
}

export function createEditApplier(
  overrides: Partial<EditApplyDependencies> = {}
) {
  const dependencies = {...defaultDependencies, ...overrides};

  return async function applyEditProposal(root: string, proposal: EditProposal): Promise<ApplyEditResult> {
    if (proposal.files.length === 0 || proposal.files.length > MAX_EDIT_FILES) {
      throw new Error(`Edit proposal must contain between 1 and ${MAX_EDIT_FILES} files.`);
    }
    const canonicalRoot = await getCanonicalWorkspaceRoot(root);
    const preflight = await Promise.all(proposal.files.map(async (edit) => ({
      edit,
      ...await inspectForApply(canonicalRoot, edit)
    })));
    const targetPaths = preflight.map((item) => item.targetPath);
    if (new Set(targetPaths).size !== targetPaths.length) {
      throw new Error('Edit proposal contains duplicate file paths.');
    }
    const tempPaths = new Set<string>();
    const staged: StagedFileEdit[] = [];
    const applied: AppliedFile[] = [];

    try {
      // Stage phase: write content to temp for create/update. Delete and rename
      // have no temp, they operate in place during commit.
      for (const item of preflight) {
        if (item.edit.action === 'delete' || item.edit.action === 'rename') {
          staged.push(item);
        } else {
          const tempPath = await stageContent(item.targetPath, item.edit.proposedContent, item.mode);
          tempPaths.add(tempPath);
          staged.push({...item, tempPath});
        }
      }

      // Commit phase: atomic rename for create/update, in-place unlink/rename
      // for delete/rename. After each commit the file is live and rollback must
      // preserve its modified state.
      for (const item of staged) {
        await recheckBeforeCommit(canonicalRoot, item);

        switch (item.edit.action) {
          case 'create':
            if (!item.tempPath) {
              throw new Error(`Create commit is missing tempPath: ${item.edit.path}`);
            }
            await dependencies.link(item.tempPath, item.targetPath);
            applied.push(item);
            await dependencies.unlink(item.tempPath);
            tempPaths.delete(item.tempPath);
            break;

          case 'update':
            if (!item.tempPath) {
              throw new Error(`Update commit is missing tempPath: ${item.edit.path}`);
            }
            await dependencies.rename(item.tempPath, item.targetPath);
            tempPaths.delete(item.tempPath);
            applied.push(item);
            break;

          case 'delete':
            await dependencies.unlink(item.targetPath);
            applied.push(item);
            break;

          case 'rename':
            if (!item.renameTo) {
              throw new Error(`Rename commit is missing renameTo: ${item.edit.path}`);
            }
            await dependencies.rename(item.targetPath, item.renameTo);
            applied.push(item);
            break;
        }
      }
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const item of [...applied].reverse()) {
        try {
          await rollbackAppliedFile(canonicalRoot, item, dependencies, tempPaths);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        }
      }

      const message = error instanceof Error ? error.message : String(error);
      const rollbackMessage = rollbackErrors.length
        ? ` Rollback also failed: ${rollbackErrors.join('; ')}`
        : '';
      throw new Error(`Unable to apply edit proposal: ${message}.${rollbackMessage}`);
    } finally {
      await Promise.all([...tempPaths].map(async (tempPath) => {
        try {
          await unlink(tempPath);
        } catch {
          // The temp file may already have been moved or removed.
        }
      }));
    }

    return {
      summary: proposal.summary,
      files: proposal.files.map((edit) => ({
        path: edit.path,
        action: edit.action,
        newPath: edit.newPath,
        previousHash: edit.expectedHash,
        appliedHash: edit.proposedHash
      }))
    };
  };
}

export const applyEditProposal = createEditApplier();
