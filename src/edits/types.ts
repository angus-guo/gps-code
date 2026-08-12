export const MAX_EDIT_FILES = 20;
/** Cap on operations within a single file. */
export const MAX_EDIT_OPERATIONS_PER_FILE = 50;
/** Cap on operations summed across every file in one proposal. */
export const MAX_EDIT_OPERATIONS_TOTAL = 200;
export const MAX_EDIT_TEXT_BYTES = 512_000;
export const MAX_EDIT_FILE_BYTES = 1_000_000;
export const DEFAULT_MAX_EDIT_PATCH_BYTES = 32_000;
export const DEFAULT_MAX_EDIT_PREVIEW_BYTES = 64_000;

export type TextEditOperation = {
  oldText: string;
  newText: string;
};

export type FileEditAction = 'create' | 'update' | 'delete' | 'rename';

/** What a caller may pass in. `operations` defaults to empty when omitted. */
export type FileEditInput = {
  path: string;
  reason: string;
  action: FileEditAction;
  /** Omitted or empty for delete and rename, which do not change contents. */
  operations?: TextEditOperation[];
  /** Required for rename, rejected for every other action. */
  newPath?: string;
};

export type EditProposalInput = {
  summary: string;
  files: FileEditInput[];
};

export type PreparedFileEdit = Omit<FileEditInput, 'operations'> & {
  operations: TextEditOperation[];
  expectedHash: string | null;
  proposedHash: string;
  originalContent: string;
  proposedContent: string;
  /**
   * Permission bits of the file as it existed at proposal time, or null when
   * there was no file. Undoing a delete has to recreate the file after it is
   * gone, so the mode cannot be read back from disk at that point.
   */
  originalMode: number | null;
};

export type EditProposal = {
  summary: string;
  files: PreparedFileEdit[];
};

export type EditPreviewFile = {
  path: string;
  reason: string;
  action: FileEditAction;
  newPath?: string;
  patch: string;
  truncated: boolean;
};

export type EditPreview = {
  summary: string;
  files: EditPreviewFile[];
  truncated: boolean;
};

export type ProposedFileEdits = {
  proposal: EditProposal;
  preview: EditPreview;
};

export type AppliedFileEdit = {
  path: string;
  action: FileEditAction;
  newPath?: string;
  previousHash: string | null;
  appliedHash: string;
};

export type ApplyEditResult = {
  summary: string;
  files: AppliedFileEdit[];
};

export type UndoneFileEdit = {
  path: string;
  action: FileEditAction;
  newPath?: string;
};

export type UndoEditResult = {
  summary: string;
  files: UndoneFileEdit[];
};
