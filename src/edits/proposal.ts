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
  MAX_EDIT_OPERATIONS,
  MAX_EDIT_TEXT_BYTES,
  type EditProposal,
  type EditProposalInput,
  type FileEditInput,
  type TextEditOperation
} from './types.js';

const textEditOperationSchema = z.object({
  oldText: z.string(),
  newText: z.string()
});

const fileEditInputSchema = z.object({
  path: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  action: z.enum(['create', 'update']),
  operations: z.array(textEditOperationSchema).min(1).max(MAX_EDIT_OPERATIONS)
});

export const editProposalInputSchema = z.object({
  summary: z.string().trim().min(1),
  files: z.array(fileEditInputSchema).min(1).max(MAX_EDIT_FILES)
});

function countTextBytes(input: EditProposalInput) {
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

function assertProposalBounds(input: EditProposalInput) {
  const operationCount = input.files.reduce((total, file) => total + file.operations.length, 0);
  if (operationCount > MAX_EDIT_OPERATIONS) {
    throw new Error(`Edit proposal has too many operations (${operationCount} > ${MAX_EDIT_OPERATIONS}).`);
  }

  const textBytes = countTextBytes(input);
  if (textBytes > MAX_EDIT_TEXT_BYTES) {
    throw new Error(`Edit proposal text is too large (${textBytes} bytes > ${MAX_EDIT_TEXT_BYTES} bytes).`);
  }
}

function assertOperation(operation: TextEditOperation, file: FileEditInput) {
  if (operation.oldText === operation.newText) {
    throw new Error(`Edit operation does not change content: ${file.path}`);
  }
  if (file.action === 'update' && operation.oldText.length === 0) {
    throw new Error(`Update operations require non-empty oldText: ${file.path}`);
  }
}

function applyOperations(content: string, file: FileEditInput) {
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

async function prepareExistingFile(root: string, file: FileEditInput) {
  const inspected = await inspectExistingTextFile(root, file.path);
  const originalContent = inspected.content;
  const proposedContent = applyOperations(originalContent, file);

  return {
    ...file,
    path: inspected.relativePath,
    expectedHash: inspected.hash,
    proposedHash: hashContent(proposedContent),
    originalContent,
    proposedContent
  };
}

async function prepareCreatedFile(root: string, file: FileEditInput) {
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
    proposedContent
  };
}

export async function prepareEditProposal(root: string, input: EditProposalInput): Promise<EditProposal> {
  const parsed = editProposalInputSchema.parse(input);
  assertProposalBounds(parsed);
  const canonicalRoot = await getCanonicalWorkspaceRoot(root);

  const normalizedPaths = parsed.files.map((file) => toPosixPath(relative(
    canonicalRoot,
    resolveWorkspacePath(canonicalRoot, file.path)
  )));
  if (new Set(normalizedPaths).size !== normalizedPaths.length) {
    throw new Error('Edit proposal contains duplicate file paths.');
  }

  const files = await Promise.all(parsed.files.map((file) => file.action === 'create'
    ? prepareCreatedFile(canonicalRoot, file)
    : prepareExistingFile(canonicalRoot, file)));

  return {
    summary: parsed.summary,
    files
  };
}
