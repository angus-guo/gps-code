import type {
  ApplyEditResult,
  EditPreviewFile,
  ProposedFileEdits
} from '../edits/types.js';
import type {ConfirmationDecision} from './command-confirmation.js';

const confirmInputs = new Set(['y', 'yes', '确认', '应用', 'apply']);
const rejectInputs = new Set(['n', 'no', '取消', 'cancel']);

export function getEditConfirmationDecision(input: string): ConfirmationDecision {
  const normalized = input.trim().toLowerCase();
  if (confirmInputs.has(normalized)) {
    return 'confirm';
  }
  if (rejectInputs.has(normalized)) {
    return 'reject';
  }
  return 'unknown';
}

function actionLabel(action: EditPreviewFile['action']) {
  return action === 'create' ? '新建' : '修改';
}

function formatPreviewFile(file: EditPreviewFile) {
  const patch = file.patch || '[该文件的 Diff 因总预览大小限制而省略]';
  return [
    `${actionLabel(file.action)} ${file.path}：${file.reason}`,
    patch
  ].join('\n');
}

export function formatPendingEdit(proposed: ProposedFileEdits) {
  const details = [
    `准备应用编辑：${proposed.proposal.summary}`,
    '',
    ...proposed.preview.files.flatMap((file, index) => [
      ...(index > 0 ? [''] : []),
      formatPreviewFile(file)
    ])
  ];
  if (proposed.preview.truncated) {
    details.push('', 'Diff 预览已截断，仅展示部分内容。');
  }
  details.push('', '文件尚未修改。请回复 y/yes/确认/应用/apply 应用，或 n/no/取消/cancel 取消。');
  return details.join('\n');
}

export function formatEditStarted(proposed: ProposedFileEdits) {
  return `开始应用编辑：${proposed.proposal.summary}`;
}

export function formatEditCancelled(proposed: ProposedFileEdits) {
  return `已取消编辑：${proposed.proposal.summary}；文件未修改。`;
}

export function formatEditResult(result: ApplyEditResult) {
  return [
    `编辑应用成功：${result.summary}`,
    ...result.files.map((file) => `- ${file.action === 'create' ? '已新建' : '已修改'} ${file.path}`)
  ].join('\n');
}

export function formatEditError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    `编辑应用失败：${message}`,
    '请重新检查文件内容并生成新的编辑提案。'
  ].join('\n');
}
