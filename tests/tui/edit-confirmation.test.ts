import {describe, expect, it} from 'vitest';
import {
  formatEditCancelled,
  formatEditError,
  formatEditResult,
  formatPendingEdit,
  formatPendingUndo,
  formatUndoError,
  formatUndoResult,
  getEditConfirmationDecision,
  getUndoConfirmationDecision
} from '../../src/tui/edit-confirmation.js';
import type {ProposedFileEdits} from '../../src/edits/types.js';

const proposed: ProposedFileEdits = {
  proposal: {
    summary: '修正答案',
    files: [{
      path: 'src/app.ts',
      reason: '修正常量',
      action: 'update',
      operations: [{oldText: '41', newText: '42'}],
      expectedHash: 'a'.repeat(64),
      proposedHash: 'b'.repeat(64),
      originalContent: 'const answer = 41;\n',
      proposedContent: 'const answer = 42;\n'
    }]
  },
  preview: {
    summary: '修正答案',
    files: [{
      path: 'src/app.ts',
      reason: '修正常量',
      action: 'update',
      patch: '--- a/src/app.ts\n+++ b/src/app.ts\n-const answer = 41;\n+const answer = 42;',
      truncated: true
    }],
    truncated: true
  }
};

describe('edit confirmation helpers', () => {
  it('recognizes apply and cancel inputs', () => {
    expect(getEditConfirmationDecision('y')).toBe('confirm');
    expect(getEditConfirmationDecision(' YES ')).toBe('confirm');
    expect(getEditConfirmationDecision('确认')).toBe('confirm');
    expect(getEditConfirmationDecision('应用')).toBe('confirm');
    expect(getEditConfirmationDecision('apply')).toBe('confirm');
    expect(getEditConfirmationDecision('n')).toBe('reject');
    expect(getEditConfirmationDecision('no')).toBe('reject');
    expect(getEditConfirmationDecision('取消')).toBe('reject');
    expect(getEditConfirmationDecision('cancel')).toBe('reject');
    expect(getEditConfirmationDecision('later')).toBe('unknown');
  });

  it('renders purpose, file reason, patch, truncation, and confirmation choices', () => {
    const output = formatPendingEdit(proposed);

    expect(output).toContain('准备应用编辑：修正答案');
    expect(output).toContain('修改 src/app.ts：修正常量');
    expect(output).toContain('-const answer = 41;');
    expect(output).toContain('Diff 预览已截断');
    expect(output).toContain('文件尚未修改');
    expect(output).toContain('应用/apply');
  });

  it('formats cancellation and successful apply results', () => {
    expect(formatEditCancelled(proposed)).toContain('文件未修改');
    expect(formatEditResult({
      summary: '修正答案',
      files: [{
        path: 'src/app.ts',
        action: 'update',
        previousHash: 'a'.repeat(64),
        appliedHash: 'b'.repeat(64)
      }]
    })).toContain('已修改 src/app.ts');
  });

  it('surfaces stale proposal failures and asks for regeneration', () => {
    const output = formatEditError(new Error(
      'Edit proposal is stale because the file changed: src/app.ts'
    ));

    expect(output).toContain('stale');
    expect(output).toContain('src/app.ts');
    expect(output).toContain('生成新的编辑提案');
  });

  it('formats and confirms one-level undo', () => {
    expect(getUndoConfirmationDecision('undo')).toBe('confirm');
    expect(getUndoConfirmationDecision('撤销')).toBe('confirm');
    expect(getUndoConfirmationDecision('n')).toBe('reject');
    expect(formatPendingUndo(proposed)).toContain('恢复原始内容 src/app.ts');
    expect(formatUndoResult({
      summary: '修正答案',
      files: [{path: 'src/app.ts', action: 'update'}]
    })).toContain('已恢复 src/app.ts');
    expect(formatUndoError(new Error('changed after GPS Code applied it')))
      .toContain('未强制撤销');
  });
});
