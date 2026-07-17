import {describe, expect, it} from 'vitest';
import {createEditPreview} from '../../src/edits/preview.js';
import type {EditProposal} from '../../src/edits/types.js';

const proposal: EditProposal = {
  summary: '更新答案并增加配置',
  files: [
    {
      path: 'src/app.ts',
      reason: '修正答案',
      action: 'update',
      operations: [{oldText: '41', newText: '42'}],
      expectedHash: 'before-hash',
      proposedHash: 'after-hash',
      originalContent: 'const answer = 41;\n',
      proposedContent: 'const answer = 42;\n'
    },
    {
      path: 'src/config.ts',
      reason: '增加配置',
      action: 'create',
      operations: [{oldText: '', newText: 'export const enabled = true;\n'}],
      expectedHash: null,
      proposedHash: 'create-hash',
      originalContent: '',
      proposedContent: 'export const enabled = true;\n'
    }
  ]
};

describe('createEditPreview', () => {
  it('creates unified patches for updates and new files', () => {
    const preview = createEditPreview(proposal);

    expect(preview.summary).toBe(proposal.summary);
    expect(preview.files[0].patch).toContain('--- a/src/app.ts');
    expect(preview.files[0].patch).toContain('+++ b/src/app.ts');
    expect(preview.files[0].patch).toContain('-const answer = 41;');
    expect(preview.files[0].patch).toContain('+const answer = 42;');
    expect(preview.files[1].patch).toContain('--- /dev/null');
    expect(preview.files[1].patch).toContain('+export const enabled = true;');
    expect(preview.truncated).toBe(false);
  });

  it('bounds individual and total preview output', () => {
    const largeProposal: EditProposal = {
      summary: '大变更',
      files: proposal.files.map((file, index) => ({
        ...file,
        path: `src/large-${index}.ts`,
        originalContent: `${'before\n'.repeat(100)}`,
        proposedContent: `${'after\n'.repeat(100)}`
      }))
    };

    const preview = createEditPreview(largeProposal, {maxPatchBytes: 120, maxTotalBytes: 180});

    expect(preview.truncated).toBe(true);
    expect(preview.files.some((file) => file.patch.includes('[edit preview truncated]'))).toBe(true);
    expect(Buffer.byteLength(preview.files.map((file) => file.patch).join(''), 'utf8')).toBeLessThanOrEqual(180);
  });
});
