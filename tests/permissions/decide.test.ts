import {describe, expect, it} from 'vitest';
import {decideCommandProposal, decideEditProposal} from '../../src/permissions/decide.js';
import {PERMISSION_MODES} from '../../src/permissions/types.js';

const SAFE_COMMAND = {command: 'pnpm', args: ['test']};
const BLOCKED_COMMAND = {command: 'rm', args: ['-rf', 'dist']};

describe('decideCommandProposal', () => {
  it('asks for confirmation in default-confirm mode', () => {
    expect(decideCommandProposal(SAFE_COMMAND, 'default-confirm').action).toBe('confirm');
  });

  it('still asks for confirmation in auto-accept-edits mode', () => {
    // auto-accept applies to edits only; commands keep their confirmation gate.
    expect(decideCommandProposal(SAFE_COMMAND, 'auto-accept-edits').action).toBe('confirm');
  });

  it('rejects safe commands in read-only and plan modes', () => {
    for (const mode of ['read-only', 'plan'] as const) {
      const decision = decideCommandProposal(SAFE_COMMAND, mode);
      expect(decision.action).toBe('reject');
      expect(decision.reason).toContain('/mode default-confirm');
    }
  });

  it('rejects blocked commands in every mode', () => {
    for (const mode of PERMISSION_MODES) {
      expect(decideCommandProposal(BLOCKED_COMMAND, mode).action).toBe('reject');
    }
  });

  it('explains why a blocked command was refused', () => {
    const decision = decideCommandProposal(BLOCKED_COMMAND, 'default-confirm');
    expect(decision.reason).toContain('递归');
  });
});

describe('decideEditProposal', () => {
  it('asks for confirmation in default-confirm mode', () => {
    expect(decideEditProposal('default-confirm')).toEqual({action: 'confirm'});
  });

  it('applies without confirmation in auto-accept-edits mode', () => {
    const decision = decideEditProposal('auto-accept-edits');
    expect(decision.action).toBe('auto-apply');
    expect(decision.reason).toContain('跳过确认');
  });

  it('rejects edits in read-only and plan modes', () => {
    for (const mode of ['read-only', 'plan'] as const) {
      const decision = decideEditProposal(mode);
      expect(decision.action).toBe('reject');
      expect(decision.reason).toContain('/mode default-confirm');
    }
  });
});
