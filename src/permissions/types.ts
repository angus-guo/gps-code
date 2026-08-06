export type CommandClassification = 'allow' | 'confirm' | 'block';

export type PermissionMode = 'default-confirm' | 'auto-accept-edits' | 'read-only' | 'plan';

export type CommandPolicyResult = {
  classification: CommandClassification;
  reason?: string;
};
