import {describe, expect, it} from 'vitest';
import {formatAgentCancelled, getInterruptAction} from '../../src/tui/interrupt.js';

const RUNNING = {agentBusy: true, hasAgent: true};

describe('getInterruptAction', () => {
  it('ignores keys that are not Ctrl-C', () => {
    expect(getInterruptAction('a', {ctrl: true}, RUNNING)).toBe('ignore');
    expect(getInterruptAction('c', {ctrl: false}, RUNNING)).toBe('ignore');
    expect(getInterruptAction('c', {}, RUNNING)).toBe('ignore');
    expect(getInterruptAction('', {ctrl: true}, RUNNING)).toBe('ignore');
  });

  it('cancels the agent when a turn is in flight', () => {
    expect(getInterruptAction('c', {ctrl: true}, RUNNING)).toBe('cancel-agent');
  });

  it('exits when idle', () => {
    expect(getInterruptAction('c', {ctrl: true}, {agentBusy: false, hasAgent: true}))
      .toBe('exit');
  });

  it('exits rather than claiming a cancel during a command or edit', () => {
    // busy but not an agent turn: there is nothing for cancel() to abort, so
    // reporting a cancellation here would be a lie.
    expect(getInterruptAction('c', {ctrl: true}, {agentBusy: false, hasAgent: true}))
      .toBe('exit');
  });

  it('exits when the model is not configured yet', () => {
    expect(getInterruptAction('c', {ctrl: true}, {agentBusy: true, hasAgent: false}))
      .toBe('exit');
  });

  it('tells the user the session is still usable', () => {
    expect(formatAgentCancelled()).toContain('已取消');
    expect(formatAgentCancelled()).toContain('继续提问');
  });
});
