export type InterruptAction = 'ignore' | 'cancel-agent' | 'exit';

export type InterruptContext = {
  /** True only while an agent turn is in flight, not during commands or edits. */
  agentBusy: boolean;
  /** False before the model is configured, when there is nothing to cancel. */
  hasAgent: boolean;
};

/**
 * Decides what Ctrl-C should do. Cancelling is only claimed when an agent turn
 * is actually running; otherwise Ctrl-C keeps its usual meaning and quits, so
 * the app never reports a cancellation that did not happen.
 */
export function getInterruptAction(
  input: string,
  key: {ctrl?: boolean},
  context: InterruptContext
): InterruptAction {
  if (!key.ctrl || input !== 'c') {
    return 'ignore';
  }

  return context.agentBusy && context.hasAgent ? 'cancel-agent' : 'exit';
}

export function formatAgentCancelled() {
  return '已取消当前请求。你可以继续提问。';
}
