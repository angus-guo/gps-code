import type {CommandRequest} from '../commands/types.js';
import {classifyCommand} from './policy.js';
import {
  PERMISSION_MODE_LABELS,
  type CommandProposalDecision,
  type EditProposalDecision,
  type PermissionMode
} from './types.js';

/**
 * Decides what the TUI should do with a proposed command. Blocked commands are
 * rejected in every mode; `read-only` and `plan` additionally refuse commands
 * that would otherwise be offered for confirmation.
 */
export function decideCommandProposal(
  command: CommandRequest,
  mode: PermissionMode
): CommandProposalDecision {
  const policy = classifyCommand(command);
  if (policy.classification === 'block') {
    return {action: 'reject', reason: policy.reason};
  }

  if (mode === 'read-only' || mode === 'plan') {
    return {
      action: 'reject',
      reason: `当前是${PERMISSION_MODE_LABELS[mode]}，不会执行命令。切换模式：/mode default-confirm`
    };
  }

  return {action: 'confirm', reason: policy.reason};
}

/**
 * Decides what the TUI should do with a proposed file edit. Only
 * `auto-accept-edits` skips confirmation; the read-only modes refuse outright.
 */
export function decideEditProposal(mode: PermissionMode): EditProposalDecision {
  if (mode === 'read-only' || mode === 'plan') {
    return {
      action: 'reject',
      reason: `当前是${PERMISSION_MODE_LABELS[mode]}，不会修改文件。切换模式：/mode default-confirm`
    };
  }

  if (mode === 'auto-accept-edits') {
    return {
      action: 'auto-apply',
      reason: `当前是${PERMISSION_MODE_LABELS[mode]}，已跳过确认直接应用。`
    };
  }

  return {action: 'confirm'};
}
