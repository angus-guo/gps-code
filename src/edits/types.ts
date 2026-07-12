export const MAX_EDIT_FILES = 5;
export const MAX_EDIT_OPERATIONS = 20;
export const MAX_EDIT_TEXT_BYTES = 512_000;
export const MAX_EDIT_FILE_BYTES = 1_000_000;

export type TextEditOperation = {
  oldText: string;
  newText: string;
};

export type FileEditInput = {
  path: string;
  reason: string;
  action: 'create' | 'update';
  operations: TextEditOperation[];
};

export type EditProposalInput = {
  summary: string;
  files: FileEditInput[];
};

export type PreparedFileEdit = FileEditInput & {
  expectedHash: string | null;
  proposedHash: string;
  originalContent: string;
  proposedContent: string;
};

export type EditProposal = {
  summary: string;
  files: PreparedFileEdit[];
};
