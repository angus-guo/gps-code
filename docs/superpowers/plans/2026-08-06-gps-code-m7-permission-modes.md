# M7: Permission Modes

**Status:** ✅ Completed (see "Correction" below — first pass was incomplete)
**Date:** 2026-08-06
**Depends on:** M6 (AgentSession + permissions module)

---

## Objective

Make the four permission modes real: switchable from the TUI, visible in the
header, and actually changing what happens to command and edit proposals.
Close the policy bypass left open by M6.

---

## Correction to the first pass

This document originally claimed three things that were not true. Recording the
correction rather than quietly overwriting it:

1. **"Add mode indicator to TUI status bar ✅"** — the state existed but the
   header JSX was never edited, so nothing rendered. The manual-test line
   "Mode indicator updates after switching" could not have passed.
2. **Modes were inert.** `permissionMode` was stored and displayed in `/mode`
   output, but `auto-accept-edits`, `read-only`, and `plan` changed no behavior.
   Every proposal still went through the same confirmation path.
3. **The blacklist was bypassable.** `classifyCommand()` was only wired into the
   `onToolActivity` model-proposal path. `handleSubmit`'s `/run` branch called
   `setPendingCommand()` directly, so `/run rm -rf /` reached `runCommand()`
   unchecked — the exact hole flagged as the top risk before M6 started.

All three are fixed below.

---

## Scope

### In scope
- `/mode [name]` to inspect and switch modes
- Mode indicator in the TUI header
- Mode-dependent handling of command and edit proposals
- Hard policy enforcement at the `runCommand()` boundary
- Blacklist covering flag spelling variants

### Out of scope (deferred)
- Mode persistence across sessions (M8)
- `strong-confirm` tier requiring the user to retype the command (M8)
- Full blacklist: `chmod -R`, global installs, DB migrations (M8)
- Mode-aware system prompt, so `plan` mode tells the model not to propose at all
- Cancellation / Ctrl-C wiring (still deferred; `AgentSession.cancel()` exists
  but no signal reaches `fetch` and no key handler calls it)

---

## Implementation

### 1. Centralized mode vocabulary — `src/permissions/types.ts`

`PERMISSION_MODES`, `PERMISSION_MODE_LABELS`, `PERMISSION_MODE_DESCRIPTIONS`,
and the `isPermissionMode()` guard live in one place, following the same
convention as the confirmation-word tables. `/mode` output, the header, and
rejection messages all read from them, so adding a mode touches one file.

Also added `CommandProposalDecision` and `EditProposalDecision`.

### 2. Stronger classification — `src/permissions/policy.ts`

Removed the dead `DANGEROUS_PATTERNS` / `matchesPattern()` pair (defined in M6,
never called). Replaced substring matching with flag normalization:
`normalizeFlags()` expands bundled short flags, so `-rf`, `-r -f`,
`--recursive --force`, `-R`, and Windows `/s /q` all classify identically.

- **block** — `rm`/`rmdir`/`del`/`erase` with a recursive or force flag;
  `git push --force`/`-f`; `git reset --hard`; `git clean -f`
- **confirm** — plain single-file removal (`rm notes.txt`)
- **allow** — everything else

Executable name is lowercased, so `RM -rf` is caught. `git` rules check
`args[0]` as the subcommand, so `pnpm install --force` is not misread as a
force-push.

### 3. Mode decisions as pure functions — `src/permissions/decide.ts`

`decideCommandProposal(command, mode)` and `decideEditProposal(mode)` are pure
and unit-tested without Ink, matching how `command-confirmation.ts` is
structured.

| Mode | Command proposal | Edit proposal |
|---|---|---|
| `default-confirm` | confirm | confirm |
| `auto-accept-edits` | confirm | **auto-apply** |
| `read-only` | reject | reject |
| `plan` | reject | reject |

A `block` classification outranks the mode: blocked commands are rejected in
all four modes, including `auto-accept-edits`.

### 4. Hard enforcement — `src/commands/runner.ts`

`runCommand()` calls `classifyCommand()` before resolving the cwd and throws on
`block`. This is the choke point every path funnels through, so the `/run`
bypass is closed structurally rather than by remembering to check at each call
site. Mode-dependent decisions stay in the TUI layer, since `runner.ts` has no
business knowing about session state.

### 5. TUI wiring — `src/tui/App.tsx`

- `permissionModeRef` mirrors the state. `onToolActivity` is registered once
  during boot, so reading `permissionMode` directly would capture the value
  from that first render forever; the ref is what makes mode switching take
  effect mid-session. `changePermissionMode()` updates both.
- Command and edit branches of `onToolActivity` now consult `decide*`.
- The `/run` branch consults `decideCommandProposal` before staging.
- `autoApplyEdit()` handles the `auto-apply` path. It deliberately does **not**
  touch `setBusy` (the agent loop is still running and `handleSubmit` owns that
  flag) and does **not** stage a validation command (that would collide with
  the in-flight loop). Both differ from `executePendingEdit()`.
- Header renders `模式：<label>`, gray for the default mode and yellow otherwise.

---

## Tests

| File | Tests | Covers |
|---|---|---|
| `tests/permissions/policy.test.ts` | 10 | flag variants, case-insensitivity, Windows switches, git subcommands, no false positives |
| `tests/permissions/decide.test.ts` | 8 | all four modes × command/edit, block outranking mode |
| `tests/commands/runner.test.ts` | +3 | blocked command refused, refused before cwd resolution, allowed command still runs |

**Suite: 131/138 passing.** The 7 failures are pre-existing and environmental,
unchanged from the M6 baseline (119/126 → 131/138, +12 new tests, 0 new
failures):

- 3 × `EPERM: symlink` — Windows needs admin or Developer Mode to create symlinks
- 3 × file-mode assertions (`expected 438 to be 493`) — POSIX permission bits do
  not survive on NTFS
- 2 × path separator (`.\src\index.ts` vs `src/index.ts`) in `search-text`

Worth fixing separately as a cross-platform cleanup; none are related to M6/M7.

---

## Verification

```bash
npm run typecheck   # pass
npm run build       # pass
npx vitest run tests/permissions tests/commands/runner.test.ts
npm test            # 131/138, 7 pre-existing environmental failures
```

Not verified: end-to-end TUI behavior against a live model. `/mode` switching,
header rendering, and auto-apply have unit coverage for their decision logic but
have not been exercised through a real Ink session.

---

## Files changed

```
src/permissions/types.ts          rewritten (mode vocabulary + decision types)
src/permissions/policy.ts         rewritten (flag normalization, dead code removed)
src/permissions/decide.ts         new
src/commands/runner.ts            policy gate at entry
src/tui/App.tsx                   mode ref, decide* wiring, /run gate, autoApplyEdit, header
tests/permissions/policy.test.ts  rewritten (10 tests)
tests/permissions/decide.test.ts  new (8 tests)
tests/commands/runner.test.ts     +3 enforcement tests
```

---

## Next

**M8 — blacklist completion and strong-confirm**
- `chmod -R`, `chown -R`, global installs, DB migrations
- `strong-confirm` tier: retyping the command, not `y`
- allowlist/denylist in `config.json`
- Mode persistence

**Also outstanding, unscheduled**
- Cancellation: thread `AbortSignal` through `ModelRequest` → `fetch`, then have
  a key handler call `AgentSession.cancel()`. Note `InputBox` already owns
  `useInput`, so Ctrl-C handling needs care not to break quitting.
- Cross-platform test failures above.
