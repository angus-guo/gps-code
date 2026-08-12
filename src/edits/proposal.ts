import {relative} from 'node:path';
import {z} from 'zod';
import {resolveWorkspacePath} from '../tools/path-safety.js';
import {
  getCanonicalWorkspaceRoot,
  hashContent,
  inspectExistingTextFile,
  resolveSafeCreateTarget,
  toPosixPath
} from './file-safety.js';
import {
  MAX_EDIT_FILES,
  MAX_EDIT_FILE_BYTES,
  MAX_EDIT_OPERATIONS_PER_FILE,
  MAX_EDIT_OPERATIONS_TOTAL,
  MAX_EDIT_TEXT_BYTES,
  type EditProposal,
  type EditProposalInput,
  type FileEditInput,
  type TextEditOperation
} from './types.js';

export const textEditOperationSchema = z.object({
  oldText: z.string(),
  newText: z.string()
});

export const fileEditInputSchema = z.object({
  path: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  action: z.enum(['create', 'update', 'delete', 'rename']),
  // Optional because delete and rename change no content. Which actions
  // require operations is enforced in assertActionShape, so the failure is a
  // sentence the model can act on rather than a zod union mismatch.
  operations: z.array(textEditOperationSchema).max(MAX_EDIT_OPERATIONS_PER_FILE).default([]),
  newPath: z.string().trim().min(1).optional()
});

export const editProposalInputSchema = z.object({
  summary: z.string().trim().min(1),
  files: z.array(fileEditInputSchema).min(1).max(MAX_EDIT_FILES)
});

/** Post-parse shape: zod's .default([]) guarantees operations is present. */
type ParsedFileEdit = z.output<typeof fileEditInputSchema>;
type ParsedProposal = z.output<typeof editProposalInputSchema>;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const preparedFileEditSchema = fileEditInputSchema.extend({
  expectedHash: sha256Schema.nullable(),
  proposedHash: sha256Schema,
  originalContent: z.string(),
  proposedContent: z.string(),
  originalMode: z.number().int().nonnegative().nullable()
});

export const editProposalSchema = z.object({
  summary: z.string().trim().min(1),
  files: z.array(preparedFileEditSchema).min(1).max(MAX_EDIT_FILES)
});

function countTextBytes(input: ParsedProposal) {
  return input.files.reduce(
    (total, file) => total
      + Buffer.byteLength(file.path, 'utf8')
      + Buffer.byteLength(file.reason, 'utf8')
      + file.operations.reduce(
        (operationTotal, operation) => operationTotal
          + Buffer.byteLength(operation.oldText, 'utf8')
          + Buffer.byteLength(operation.newText, 'utf8'),
        0
      ),
    Buffer.byteLength(input.summary, 'utf8')
  );
}

/**
 * Enforces which fields each action requires. Kept in code rather than as a
 * zod discriminated union so the model-facing JSON Schema stays a single flat
 * object -- weaker OpenAI-compatible models handle oneOf poorly -- and so the
 * error names the actual problem.
 */
function assertActionShape(file: ParsedFileEdit) {
  if (file.action === 'rename') {
    if (!file.newPath) {
      throw new Error(`Rename requires newPath: ${file.path}`);
    }
    if (file.operations.length > 0) {
      throw new Error(`Rename does not accept operations; propose the content change separately: ${file.path}`);
    }
    // Checked here rather than in prepareRenamedFile so the message names the
    // real problem; the duplicate-path scan would otherwise report it first as
    // a generic collision.
    if (file.newPath === file.path) {
      throw new Error(`Rename source and target are the same path: ${file.path}`);
    }
    return;
  }

  if (file.newPath) {
    throw new Error(`newPath is only valid for rename: ${file.path}`);
  }

  if (file.action === 'delete') {
    if (file.operations.length > 0) {
      throw new Error(`Delete does not accept operations: ${file.path}`);
    }
    return;
  }

  if (file.operations.length === 0) {
    throw new Error(`${file.action} requires at least one operation: ${file.path}`);
  }
}

function assertProposalBounds(input: ParsedProposal) {
  const operationCount = input.files.reduce((total, file) => total + file.operations.length, 0);
  if (operationCount > MAX_EDIT_OPERATIONS_TOTAL) {
    throw new Error(`Edit proposal has too many operations (${operationCount} > ${MAX_EDIT_OPERATIONS_TOTAL}).`);
  }

  const textBytes = countTextBytes(input);
  if (textBytes > MAX_EDIT_TEXT_BYTES) {
    throw new Error(`Edit proposal text is too large (${textBytes} bytes > ${MAX_EDIT_TEXT_BYTES} bytes).`);
  }
}

/**
 * A single operation whose oldText is empty means "replace the whole file",
 * as opposed to the default exact-unique-match form. It stays safe because the
 * proposal still carries expectedHash, so a file changed between proposal and
 * apply is still rejected as stale rather than clobbered.
 */
function isWholeFileRewrite(file: ParsedFileEdit) {
  return file.action === 'update'
    && file.operations.length === 1
    && file.operations[0].oldText === '';
}

function assertOperation(operation: TextEditOperation, file: ParsedFileEdit) {
  if (operation.oldText === operation.newText) {
    throw new Error(`Edit operation does not change content: ${file.path}`);
  }
  if (file.action === 'update' && operation.oldText.length === 0) {
    throw new Error(
      `Update operations require non-empty oldText unless the file has exactly one whole-file operation: ${file.path}`
    );
  }
}

function applyOperations(content: string, file: ParsedFileEdit) {
  if (isWholeFileRewrite(file)) {
    const proposedContent = file.operations[0].newText;
    if (Buffer.byteLength(proposedContent, 'utf8') > MAX_EDIT_FILE_BYTES) {
      throw new Error(`Proposed file is too large: ${file.path}.`);
    }
    return proposedContent;
  }

  let proposedContent = content;

  for (const operation of file.operations) {
    assertOperation(operation, file);
    const firstMatch = proposedContent.indexOf(operation.oldText);
    if (firstMatch === -1) {
      throw new Error(`oldText was not found in ${file.path}.`);
    }
    if (proposedContent.indexOf(operation.oldText, firstMatch + 1) !== -1) {
      throw new Error(`oldText must match exactly once in ${file.path}.`);
    }

    proposedContent = `${proposedContent.slice(0, firstMatch)}${operation.newText}${proposedContent.slice(firstMatch + operation.oldText.length)}`;
  }

  if (Buffer.byteLength(proposedContent, 'utf8') > MAX_EDIT_FILE_BYTES) {
    throw new Error(`Proposed file is too large: ${file.path}.`);
  }
  return proposedContent;
}

async function prepareExistingFile(root: string, file: ParsedFileEdit) {
  const inspected = await inspectExistingTextFile(root, file.path);
  const originalContent = inspected.content;
  const proposedContent = applyOperations(originalContent, file);
  // Catches both a whole-file rewrite that matches the current bytes (the
  // per-operation check compares '' against newText, so it cannot see this)
  // and exact-match operations that cancel each other out.
  if (proposedContent === originalContent) {
    throw new Error(`Edit operation does not change content: ${file.path}`);
  }

  return {
    ...file,
    path: inspected.relativePath,
    expectedHash: inspected.hash,
    proposedHash: hashContent(proposedContent),
    originalContent,
    proposedContent,
    originalMode: inspected.mode
  };
}

async function prepareDeletedFile(root: string, file: ParsedFileEdit) {
  const inspected = await inspectExistingTextFile(root, file.path);

  // The original bytes stay in the proposal so undo can recreate the file from
  // memory, the same way an update restores from originalContent. Nothing is
  // left behind in the workspace after a successful apply.
  return {
    ...file,
    path: inspected.relativePath,
    expectedHash: inspected.hash,
    proposedHash: hashContent(''),
    originalContent: inspected.content,
    proposedContent: '',
    originalMode: inspected.mode
  };
}

async function prepareRenamedFile(root: string, file: ParsedFileEdit) {
  const inspected = await inspectExistingTextFile(root, file.path);
  const target = await resolveSafeCreateTarget(root, file.newPath as string);
  if (target.relativePath === inspected.relativePath) {
    throw new Error(`Rename source and target are the same path: ${file.path}`);
  }

  // A rename moves bytes without changing them, so the two hashes match.
  return {
    ...file,
    path: inspected.relativePath,
    newPath: target.relativePath,
    expectedHash: inspected.hash,
    proposedHash: inspected.hash,
    originalContent: inspected.content,
    proposedContent: inspected.content,
    originalMode: inspected.mode
  };
}

async function prepareCreatedFile(root: string, file: ParsedFileEdit) {
  const target = await resolveSafeCreateTarget(root, file.path);
  if (file.operations.length !== 1 || file.operations[0].oldText !== '') {
    throw new Error(`Create operations require exactly one empty oldText: ${file.path}`);
  }

  const proposedContent = file.operations[0].newText;
  assertOperation(file.operations[0], file);
  if (Buffer.byteLength(proposedContent, 'utf8') > MAX_EDIT_FILE_BYTES) {
    throw new Error(`Proposed file is too large: ${file.path}.`);
  }

  return {
    ...file,
    path: target.relativePath,
    expectedHash: null,
    proposedHash: hashContent(proposedContent),
    originalContent: '',
    proposedContent,
    originalMode: null
  };
}

function prepareFile(root: string, file: ParsedFileEdit) {
  switch (file.action) {
    case 'create':
      return prepareCreatedFile(root, file);
    case 'delete':
      return prepareDeletedFile(root, file);
    case 'rename':
      return prepareRenamedFile(root, file);
    default:
      return prepareExistingFile(root, file);
  }
}

export async function prepareEditProposal(root: string, input: EditProposalInput): Promise<EditProposal> {
  const parsed = editProposalInputSchema.parse(input);
  for (const file of parsed.files) {
    assertActionShape(file);
  }
  assertProposalBounds(parsed);
  const canonicalRoot = await getCanonicalWorkspaceRoot(root);

  // Every path a proposal touches, including rename targets, has to be unique:
  // two files renamed onto the same target, or an edit to a file another entry
  // deletes, would make the apply order decide the outcome.
  const touchedPaths = parsed.files.flatMap((file) => {
    const paths = [file.path];
    if (file.newPath) {
      paths.push(file.newPath);
    }
    return paths.map((path) => toPosixPath(relative(
      canonicalRoot,
      resolveWorkspacePath(canonicalRoot, path)
    )));
  });
  if (new Set(touchedPaths).size !== touchedPaths.length) {
    throw new Error('Edit proposal contains duplicate file paths.');
  }

  const files = await Promise.all(parsed.files.map((file) => prepareFile(canonicalRoot, file)));

  return {
    summary: parsed.summary,
    files
  };
}
