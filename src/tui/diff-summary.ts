import type {WorkspaceDiff} from '../git/diff.js';

function outputSection(label: string, output: string) {
  return output ? `${label}:\n${output}` : '';
}

export function formatWorkspaceDiff(diff: WorkspaceDiff) {
  if (!diff.isGitRepository || !diff.hasChanges) {
    return '';
  }

  const sections = [
    '检测到工作区存在未提交变更。这些变更可能在刚才的命令执行前就已存在。',
    outputSection('git status --short', diff.status),
    outputSection('git diff --stat HEAD', diff.stat),
    outputSection('短补丁摘录', diff.patch)
  ].filter(Boolean);

  if (diff.truncated) {
    sections.push('Diff 输出已截断，仅展示部分内容。');
  }
  sections.push('下一步你希望我解释这些变更、建议验证方式，还是暂时保留？');

  return sections.join('\n\n');
}
