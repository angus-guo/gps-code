# GPS Code M6 — Agent Session + Permissions + Context Management

**Date:** 2026-08-06  
**Status:** ✅ Completed  
**Branch:** `master` (direct commits)

## Summary

M6 refactors the agent loop from stateless `createAgent()` factory calls into a persistent `AgentSession` class, adds a permission policy module with dangerous command classification, and optimizes context management (tool result truncation, repo map sent once per session).

## Motivation

V1 (`ask()` rebuilds messages from scratch each turn) has no cross-turn memory, wastes tokens sending repo map repeatedly, and lacks infrastructure for permission modes beyond "confirm everything." M6 fixes these foundational gaps before building V2 features (auto-accept modes, streaming, cancellation).

## Implementation

### 1. Permissions Module (`src/permissions/`)

**Files created:**
- `types.ts` — `CommandClassification`, `PermissionMode` (4 档: `default-confirm | auto-accept-edits | read-only | plan`), `CommandPolicyResult`
- `policy.ts` — `classifyCommand(request: CommandRequest, options?: CommandPolicyOptions): CommandPolicyResult` (M6 doc originally claimed signature was `argv: string[]`; corrected in M9)
  - **M6 shipped:** Block `rm/rmdir/del/erase` with recursive or force flags; confirm plain single-file removal; block `git push --force`, `git reset --hard`, `git clean -f`
  - **M6 claimed but never implemented:** `format/mkfs/dd/shutdown/reboot` blocks, `npm`/`pnpm` publish / `chmod`/`chown` / `curl`/`wget` redirect confirms. M9 filled the gap for system commands and permission changes; publish and redirects remain out of scope.
  - **Allow:** everything else
- `tests/permissions/policy.test.ts` — 10 tests (M6 shipped 9, M9 added 1), all passing ✓

**Design notes:**
- Classification works on `CommandRequest` objects (shell-safe), not shell strings
- `runner.ts` already uses `execa` with `shell: false`, perfect fit
- M6 wires up the policy but doesn't change TUI behavior yet (all commands still go through confirmation)

### 2. Agent Session Refactor (`src/agent/agent.ts`)

**Before:** `createAgent()` returns `{ask, summarizeCommandResult}` object; `ask()` rebuilds `messages` from scratch each call.

**After:** `AgentSession` class with:
- `private messages: ChatMessage[]` — persistent across turns
- `private repoMapSent = false` — repo map injected only on first turn
- `private abortController: AbortController | null` — for future cancellation support
- `maxToolRounds` raised from 4 → 20 (matching Claude Code)
- `MAX_TOOL_RESULT_LENGTH = 2000` — tool results >2KB get truncated with `...[truncated]...` marker
- `cancel(): void` method (currently unused, ready for TUI integration)
- Backward compatibility: `createAgent()` factory still exported, wraps `new AgentSession()`

**Tests:** `tests/agent/agent.test.ts` — 7/7 passing ✓

### 3. TUI Integration (`src/tui/App.tsx`)

**Changes:**
- Added `agentRef = useRef<Agent | null>(null)` to hold persistent session
- Boot sequence now creates session once (when config is available) and registers `onToolActivity` callback at construction time
- `handleSubmit` uses `agentRef.current.ask(input)` instead of creating new agent each turn
- `executePendingCommand` uses `agentRef.current.summarizeCommandResult()` for post-command summary
- Added `permissionMode` state (currently hardcoded to `'default-confirm'`; future M7+ will expose `/mode` command)

**Typecheck:** ✅ Passes  
**Build:** ✅ Succeeds

### 4. Test Results

**Full suite:** 119/126 passing  
**7 failures:** All pre-existing Windows path separator issues (`\` vs `/`) in:
- `tests/config/store.test.ts` (1)
- `tests/commands/runner.test.ts` (1)
- `tests/edits/apply.test.ts` (1)
- `tests/edits/proposal.test.ts` (1)
- `tests/edits/undo.test.ts` (1)
- `tests/tools/search-text.test.ts` (2)

**Verdict:** No new regressions. M6 refactoring successful.

## Not Done in M6 (Deferred to Later Milestones)

- **Permission mode switching UI:** `/mode auto-accept-edits`, `/mode read-only`, `/mode plan` (M7)
- **Policy hookup in runner.ts:** Check `classifyCommand()` before execution, auto-allow when mode permits (M7)
- **Cancellation UI:** Ctrl+C handling, `agentRef.current.cancel()` (M8)
- **Streaming:** Model streaming support (M9)
- **Session persistence:** Save/restore conversation history across CLI invocations (M10+)

## Files Changed

```
src/permissions/types.ts          (new)
src/permissions/policy.ts         (new)
tests/permissions/policy.test.ts  (new)
src/agent/agent.ts                (refactor: factory → class)
src/tui/App.tsx                   (integrate session + permissionMode)
docs/superpowers/plans/2026-08-06-gps-code-m6-session-permissions.md (new)
```

## Verification Commands

```bash
pnpm test tests/permissions/        # 9/9 ✓
pnpm test tests/agent/agent.test.ts # 7/7 ✓
pnpm typecheck                       # ✓
pnpm build                           # ✓
pnpm test                            # 119/126 (7 pre-existing Windows path fails)
```

## Next Steps

**M7 (Permission Modes UI):**
- Add `/mode <name>` slash command to `App.tsx`
- Wire `classifyCommand()` into `commands/runner.ts` before `execa`
- Add mode indicator to TUI status line

**M8 (Cancellation):**
- Intercept Ctrl+C in Ink, call `agentRef.current.cancel()`
- Pass `abortController.signal` through to model client

**M9 (Streaming):**
- Add `model.completeStream()` to `openai-compatible.ts`
- Update `AgentSession.ask()` to yield incremental tokens
- Render streaming assistant messages in `ChatView`
