import {z} from 'zod';
import {prepareEditProposal, editProposalInputSchema, editProposalSchema} from '../edits/proposal.js';
import {createEditPreview} from '../edits/preview.js';
import type {EditProposalInput, ProposedFileEdits} from '../edits/types.js';
import type {ToolDefinition} from './types.js';

export type ProposeFileEditsInput = z.input<typeof editProposalInputSchema>;

export function getProposedFileEdits(
  metadata: Record<string, unknown> | undefined
): ProposedFileEdits | null {
  const parsed = editProposalSchema.safeParse(metadata?.editProposal);
  if (!parsed.success) {
    return null;
  }

  return {
    proposal: parsed.data,
    preview: createEditPreview(parsed.data)
  };
}

function formatContent(proposed: ProposedFileEdits) {
  const files = proposed.proposal.files.map((file) => (
    `- ${file.action === 'create' ? 'create' : 'update'} ${file.path}: ${file.reason}`
  ));

  return [
    `Prepared edit proposal: ${proposed.proposal.summary}`,
    ...files,
    proposed.preview.truncated ? 'The diff preview is truncated.' : 'The diff preview is complete.',
    'No files have been changed. The user must review and confirm the diff before GPS Code can apply it.'
  ].join('\n');
}

export const proposeFileEditsTool: ToolDefinition<EditProposalInput> = {
  name: 'propose_file_edits',
  description: 'Prepare exact text-file edits and a diff for user confirmation. This tool never writes files.',
  inputSchema: editProposalInputSchema,
  async execute(input, context) {
    const proposal = await prepareEditProposal(context.root, input);
    const proposed = {
      proposal,
      preview: createEditPreview(proposal)
    };

    return {
      content: formatContent(proposed),
      metadata: {editProposal: proposal},
      modelMetadata: {
        summary: proposal.summary,
        files: proposal.files.map((file) => ({
          path: file.path,
          reason: file.reason,
          action: file.action
        })),
        previewTruncated: proposed.preview.truncated,
        applied: false
      }
    };
  }
};
