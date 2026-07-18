# GPS Code M6 Stateful Sessions Implementation Plan

**Goal:** Give GPS Code coherent multi-turn conversations and explicit, safe local session persistence across process restarts.

**Architecture:** Store a versioned, append-only user-visible transcript separately from the bounded model context reconstructed by the agent. Sessions are isolated by a SHA-256 identifier derived from the canonical workspace path. The TUI may restore completed transcript events, but pending commands, edit proposals, and undo confirmations always expire when the process exits.

**Tech Stack:** TypeScript, Node.js 20+, zod, Vitest, Ink.

---

## Scope

In scope:

- Versioned local session metadata and transcript events.
- Workspace-isolated storage under `~/.gps-code/sessions/`.
- Multi-turn agent history with deterministic context bounds.
- Explicit new, continue, and selected-session CLI flows.
- Minimal TUI session status and lifecycle commands.
- Local-only privacy mode and restrictive filesystem permissions.
- Corrupt-tail recovery and clear persistence warnings.

Out of scope:

- Cloud synchronization or shared sessions.
- Vector databases, embeddings, or semantic memory retrieval.
- Model-generated conversation summarization.
- Restoring pending commands, edits, or undo confirmations.
- Branching conversation trees or a full-screen session browser.
- Provider-specific conversation APIs.

---

### Task 1: Versioned Session Store

- [x] Define bounded session metadata and transcript event schemas.
- [x] Derive stable workspace identifiers from canonical paths.
- [x] Create append-only JSONL session files with schema versions.
- [x] Enforce private directory and file permissions.
- [x] Recover valid history from a corrupt trailing record.
- [x] Refuse appends to a session with unresolved corruption.
- [x] List sessions and resolve the latest session per workspace.

Task 1 verification: 24 test files and 125 tests, followed by typecheck,
production build, and `git diff --check`.

### Task 2: Multi-Turn Agent Context

- [x] Keep user and assistant turns across repeated `ask` calls.
- [x] Preserve required tool-call/tool-result pairs in model history.
- [x] Reconstruct model context from a resumed transcript.
- [x] Bound history by deterministic byte and turn budgets.
- [x] Keep the system prompt and current repo map in every request.

Task 2 verification: 25 test files and 132 tests, followed by typecheck,
production build, and `git diff --check`.

### Task 3: TUI Transcript Persistence

- [ ] Persist user-visible messages after they are rendered.
- [ ] Restore completed messages when continuing a session.
- [ ] Surface persistence failures without stopping chat.
- [ ] Keep pending command, edit, and undo state process-local.
- [ ] Mark interrupted proposals as expired on resume.

### Task 4: CLI Session Lifecycle

- [ ] Start a new session by default.
- [ ] Add `--continue` for the latest workspace session.
- [ ] Add `--session <id>` for an explicit session.
- [ ] Add a bounded workspace session listing command.
- [ ] Add `--no-save` for ephemeral sessions.

### Task 5: TUI Session Controls

- [ ] Show the active session identifier and persistence mode.
- [ ] Add `/new` to begin a fresh session.
- [ ] Add `/clear` to clear only the visible conversation context.
- [ ] Prevent session controls while a confirmation is pending.
- [ ] Keep commands concise and discoverable without adding a full help screen.

### Task 6: Acceptance and Documentation

- [ ] Verify follow-up questions receive prior context.
- [ ] Verify restart and explicit continuation restore history.
- [ ] Verify different workspaces never share sessions.
- [ ] Verify corrupt storage and write failures degrade clearly.
- [ ] Run the complete M1-M6 automated suite and TUI smoke tests.
- [ ] Update the Chinese and English design documents and README status.

## Acceptance Criteria

- A follow-up such as “why is it designed that way?” includes the prior answer in the next model request.
- `gps-code --continue` restores the most recent session for only the current canonical workspace.
- Resuming a session never runs a command or applies an edit without a new proposal and confirmation.
- Session files are private to the current OS user and do not contain model API keys.
- A partial trailing JSONL record does not discard earlier valid transcript events.
- Context growth is bounded and deterministic without a vector database or additional model call.
