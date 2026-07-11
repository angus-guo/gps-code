# GPS Code M4 Command Assistance Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Keep command execution conservative: GPS Code may suggest and prepare actions, but it must ask before running commands or changing files.

**Goal:** Upgrade GPS Code from evidence-gathering assistance to semi-automatic assistance. GPS Code should be able to suggest useful project commands, ask for confirmation, run confirmed commands safely, summarize command output, and prepare simple diffs without making autonomous edits the primary product experience.

**Architecture:** Add a command runtime that executes argv-style commands inside the workspace with safe cwd validation, timeouts, and bounded output. Then add a TUI confirmation flow that keeps pending command proposals explicit. Later, let the agent propose commands in a structured way and summarize completed command results.

**Tech Stack:** TypeScript, Node.js 20+, zod, execa, Vitest, Ink.

---

## Scope

In scope:

- Safe command execution primitives.
- Workspace-bound command cwd validation.
- Command output capture, truncation, exit status, duration, and timeout handling.
- TUI pending-command confirmation flow.
- Agent-facing command proposal events.
- Command result summarization.
- Simple diff preparation for already modified workspace files.

Out of scope:

- Fully autonomous code modification.
- Shell scripts or arbitrary shell interpolation by default.
- Git push, PR creation, or remote operations from inside GPS Code.
- Long-running interactive processes.
- Background task management.
- Sandboxed containers.

---

## User Experience

The first M4 experience should feel like:

1. User asks: "我应该怎么验证这个项目？"
2. GPS Code inspects the repo and proposes a command such as `pnpm test`.
3. TUI shows the proposed command and asks for confirmation.
4. User confirms.
5. GPS Code runs the command in the workspace, captures output, and summarizes what happened.
6. If files changed, GPS Code can prepare a concise diff summary and ask what the user wants to do next.

---

## File Structure

- Create `src/commands/types.ts`: command proposal and execution result types.
- Create `src/commands/runner.ts`: workspace-bound command execution.
- Create `tests/commands/runner.test.ts`.
- Modify `src/agent/agent.ts`: support structured command proposals.
- Modify `src/tui/App.tsx`: store pending command, handle confirmation, run commands.
- Modify `src/tui/components/ChatView.tsx`: render command proposals and command results clearly.
- Modify `tests/agent/agent.test.ts`.

---

### Task 1: Safe Command Runner

**Files:**

- Create: `src/commands/types.ts`
- Create: `src/commands/runner.ts`
- Create: `tests/commands/runner.test.ts`

- [x] **Step 1: Write failing tests**

Test that `runCommand`:

- runs an argv-style command in the workspace.
- resolves an optional workspace-relative cwd.
- rejects cwd traversal outside the workspace.
- captures stdout, stderr, exit code, duration, and timed-out state.
- truncates overly large output with a clear marker.
- handles non-zero exits without throwing.

Run:

```bash
pnpm test tests/commands/runner.test.ts
```

Expected: FAIL because the module does not exist.

- [x] **Step 2: Implement command types**

Define:

```ts
export type CommandRequest = {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export type CommandResult = {
  commandLine: string;
  cwd: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
};
```

- [x] **Step 3: Implement `runCommand`**

Use `execa` with `reject: false`, `shell: false`, bounded timeout, and workspace path safety. Keep defaults conservative:

- `timeoutMs`: `30_000`
- `maxOutputBytes`: `64_000`

- [x] **Step 4: Verify and commit**

Run:

```bash
pnpm test tests/commands/runner.test.ts
pnpm test
pnpm typecheck
```

Commit:

```bash
git add src/commands/types.ts src/commands/runner.ts tests/commands/runner.test.ts
git commit -m "feat: add safe command runner"
```

---

### Task 2: TUI Confirmation Flow

**Files:**

- Modify: `src/tui/App.tsx`
- Modify: `src/tui/components/ChatView.tsx`
- Create: focused tests when the TUI structure is testable without brittle terminal snapshots.

- [x] Store one pending command proposal in `App`.
- [x] When pending, interpret `y`, `yes`, `确认`, `执行`, and `run` as confirmation.
- [x] Interpret `n`, `no`, `取消`, and `cancel` as rejection.
- [x] Run confirmed commands through `runCommand`.
- [x] Show command start, exit code, timeout, and output summary in the chat stream.

---

### Task 3: Agent Command Proposals

**Files:**

- Modify: `src/agent/agent.ts`
- Modify: `src/tools/types.ts`
- Modify: `src/tools/registry.ts`
- Create: `src/tools/propose-command.ts`
- Modify: `tests/agent/agent.test.ts`

- [ ] Add a model-visible `propose_command` tool.
- [ ] Validate proposed command shape but do not execute it.
- [ ] Emit command proposal activity to the TUI.
- [ ] Keep the agent's final answer explicit: command execution requires user confirmation.

---

### Task 4: Command Result Summaries

**Files:**

- Modify: `src/agent/agent.ts`
- Modify: `src/tui/App.tsx`
- Modify: tests as needed.

- [ ] Feed completed command results back to the model for concise summarization.
- [ ] If model summarization fails, show a deterministic fallback summary.
- [ ] Preserve raw output excerpts with truncation markers.

---

### Task 5: Simple Diff Preparation

**Files:**

- Create: `src/git/diff.ts`
- Create: `tests/git/diff.test.ts`
- Modify: TUI/agent integration only after the primitive is stable.

- [ ] Detect whether the workspace has modified files.
- [ ] Prepare a bounded `git diff --stat` and optional short patch excerpt.
- [ ] Do not stage, commit, or revert files.
- [ ] Ask the user what they want to do next.

---

## Verification

Before opening the M4 PR:

```bash
pnpm test
pnpm typecheck
pnpm build
node dist/cli/index.js --help
```

Manual TUI smoke test:

```bash
gps-code
```

Ask a validation question, approve a safe command, reject another command, and verify both paths render clearly.
