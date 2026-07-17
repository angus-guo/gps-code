import {createTwoFilesPatch} from 'diff';
import {z} from 'zod';
import {
  DEFAULT_MAX_EDIT_PATCH_BYTES,
  DEFAULT_MAX_EDIT_PREVIEW_BYTES,
  type EditPreview,
  type EditProposal
} from './types.js';

const TRUNCATION_MARKER = '\n[edit preview truncated]';

const previewOptionsSchema = z.object({
  context: z.number().int().min(0).max(20).default(3),
  maxPatchBytes: z.number().int().positive().max(1_000_000).default(DEFAULT_MAX_EDIT_PATCH_BYTES),
  maxTotalBytes: z.number().int().positive().max(2_000_000).default(DEFAULT_MAX_EDIT_PREVIEW_BYTES)
});

export type EditPreviewOptions = z.input<typeof previewOptionsSchema>;

function truncatePatch(patch: string, maxBytes: number) {
  if (Buffer.byteLength(patch, 'utf8') <= maxBytes) {
    return {patch, truncated: false};
  }

  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, 'utf8');
  if (maxBytes < markerBytes) {
    return {patch: '', truncated: true};
  }
  const keepBytes = Math.max(0, maxBytes - markerBytes);
  const patchBuffer = Buffer.from(patch, 'utf8');
  let prefix = '';
  for (let end = keepBytes; end >= Math.max(0, keepBytes - 4); end -= 1) {
    try {
      prefix = new TextDecoder('utf-8', {fatal: true}).decode(patchBuffer.subarray(0, end));
      break;
    } catch {
      // Retry without an incomplete trailing UTF-8 sequence.
    }
  }
  return {
    patch: `${prefix}${TRUNCATION_MARKER}`,
    truncated: true
  };
}

export function createEditPreview(
  proposal: EditProposal,
  options: EditPreviewOptions = {}
): EditPreview {
  const parsed = previewOptionsSchema.parse(options);
  let remainingBytes = parsed.maxTotalBytes;
  let totalTruncated = false;

  const files = proposal.files.map((file) => {
    const oldName = file.action === 'create' ? '/dev/null' : `a/${file.path}`;
    const patch = createTwoFilesPatch(
      oldName,
      `b/${file.path}`,
      file.originalContent,
      file.proposedContent,
      '',
      '',
      {context: parsed.context}
    );
    const allowedBytes = Math.min(parsed.maxPatchBytes, remainingBytes);
    const bounded = truncatePatch(patch, allowedBytes);
    const usedBytes = Buffer.byteLength(bounded.patch, 'utf8');
    remainingBytes = Math.max(0, remainingBytes - usedBytes);
    const truncated = bounded.truncated;
    totalTruncated = totalTruncated || truncated;

    return {
      path: file.path,
      reason: file.reason,
      action: file.action,
      patch: bounded.patch,
      truncated
    };
  });

  return {
    summary: proposal.summary,
    files,
    truncated: totalTruncated
  };
}
