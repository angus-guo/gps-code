# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

GPS Code is a Chinese-first TUI code agent (`gps-code`) that helps junior/mid-level developers understand unfamiliar local codebases. It talks to any OpenAI-compatible endpoint (DeepSeek, Qwen, Kimi, Ollama). Priority languages for detection are JS/TS, Python, Java, and C/C++.

Full product design is in `docs/superpowers/specs/2026-06-30-gps-code-design.md`; per-milestone implementation plans (M1–M7, with completed task checklists) are in `docs/superpowers/plans/`. V2 roadmap (M6–M12) is in `docs/superpowers/specs/2026-08-06-gps-code-v2-design.md`. Read the relevant plan before extending a subsystem — it records what was deliberately left out of scope.

## Commands

```bash
pnpm install
pnpm dev                 # run the CLI from source via tsx
pnpm test                # vitest run (whole suite)
pnpm test:watch
pnpm typecheck           # tsc --noEmit, covers src/ AND tests/
pnpm build               # tsup -> dist/cli/index.js (ESM, node20, with shebang)

pnpm vitest run tests/edits/apply.test.ts          # single file
pnpm vitest run tests/edits -t "rolls back"        # single test by name
```

Node >= 20 required. Verification convention used by the plans: full suite → `typecheck` → `build`.

## Architecture

One request flows straight down this chain; each layer is separately unit-tested and takes its dependencies as arguments rather than reaching for globals.

```
InputBox -> tui/App.tsx -> agent/agent.ts -> model/openai-compatible.ts
                              |                        (tool_calls)
                              v
                      tools/registry.ts -> list_files | read_file | search_text
                                           propose_command | propose_file_edits
```

- `src/workspace/indexer.ts` builds a `RepoMap` at TUI boot by fanning out to `languages/{javascript,python,java,cpp}.ts` detectors and merging their `LanguageDetectorResult` partials. The RepoMap is serialized into a system message so the model starts with project context.
- `src/agent/agent.ts` owns the tool loop (`maxToolRounds`, default 20). Refactored in M6 from factory to `AgentSession` class with persistent `messages: ChatMessage[]`. Reports every tool call through `onToolActivity`, which is how the TUI learns about proposals.
- **Cancellation (M7.5)**: each `ask()` creates an `AbortController`, threads its signal through `ModelRequest` into `fetch`, and checks `signal.aborted` both before each model call and after each batch of tools. `openai-compatible.ts` translates `fetch`'s `AbortError` into a typed `ModelRequestAbortedError` so a deliberate cancel is distinguishable from a network failure. **A cancelled turn rolls `messages` back to its pre-turn length** — otherwise history can end on an assistant `tool_calls` message with no tool results, which every OpenAI-compatible provider rejects, permanently breaking the session after one cancel.
- `src/model/openai-compatible.ts` is a hand-written `fetch` client (no OpenAI SDK) that translates the internal `ChatMessage` union to/from OpenAI wire format.
- `src/permissions/` (M6–M7) is two layers. `policy.ts:classifyCommand()` classifies an argv request as `block | confirm | allow` and knows nothing about modes; `decide.ts` combines that classification with the current `PermissionMode` to produce a `confirm | auto-apply | reject` decision. Both are pure and unit-tested without Ink. **`classifyCommand()` is additionally called inside `runCommand()`** — that is the choke point that makes a `block` unbypassable, including via the manual `/run` path. Mode-dependent decisions stay in the TUI; `commands/runner.ts` deliberately knows nothing about session state.
- `src/tui/App.tsx` holds all interaction state: `pendingCommand`, `pendingEdit`, `pendingUndo`, `lastAppliedEdit`, `permissionMode`. `AgentSession` created once at boot via `useRef`. Formatting/decision logic lives in sibling pure modules (`command-confirmation.ts`, `edit-confirmation.ts`, `diff-summary.ts`, `edit-verification.ts`) so it can be tested without rendering Ink.

## The propose → confirm → apply invariant

This is the core safety property of the product. Do not weaken it.

**Tools never mutate anything.** `propose_command` and `propose_file_edits` only validate and prepare; the actual side effects live in `commands/runner.ts` and `edits/apply.ts`, and are reachable only from the TUI after the user types a confirmation word.

Proposals travel from tool to TUI via `ToolResult.metadata`, decoded by `getProposedCommand()` / `getProposedFileEdits()`. Note the deliberate split in `ToolResult`:

- `metadata` — rich payload for the app (full `EditProposal` with file contents and hashes). Never sent to the model.
- `modelMetadata` — small summary that *is* sent back to the model.

Keeping bulky content out of `modelMetadata` is intentional; `agent.ts:formatToolResult` prefers `modelMetadata` when present.

When a proposal has been seen, `agent.ts` appends a notice to the final answer stating nothing has run/changed yet.

### Edit pipeline specifics (`src/edits/`)

`proposal.ts` (prepare, read-only) → `preview.ts` (bounded unified diff) → `apply.ts` (write) → `undo.ts` (one level).

- Four actions: `create`, `update`, `delete`, `rename`. Which fields each one requires is enforced by `assertActionShape()` in code, **not** by a zod discriminated union — the model-facing JSON Schema stays one flat object because weaker OpenAI-compatible models handle `oneOf` poorly, and the error names the actual problem. `delete`/`rename` take no operations; `rename` requires `newPath` and is rejected for every other action.
- Update operations require `oldText` to match **exactly once** in the file. The one exception is a whole-file rewrite: a single operation with an empty `oldText` replaces the entire file. It must be that file's only operation (mixing it with exact-match operations is rejected).
- `rename` moves bytes without changing them, so `expectedHash === proposedHash`. Changing content while renaming takes two proposals — the target path doesn't exist yet when the first one is prepared.
- Every prepared edit carries `expectedHash` (sha256 of current bytes) and `proposedHash`. `apply.ts` re-checks the hash immediately before committing, so a file edited between proposal and confirmation produces a stale-proposal error instead of a clobber. This covers the whole-file rewrite and `delete` paths too.
- Writes go through a temp file (`.gps-code-<name>-<uuid>.tmp`) in the target directory, `fsync`ed, then `rename` (update) or `link` + `unlink` (create, so an existing file is never silently overwritten). `delete` and `rename` have no temp file; they act in place at commit. Original file mode is preserved.
- Undoing a `delete` recreates the file from the proposal's in-memory `originalContent`, the same way an update restores — no `.deleted` backup is left in the workspace. This is why `PreparedFileEdit` carries `originalMode`: once the file is gone the mode can't be read back from disk.
- Multi-file applies roll back already-committed files in reverse on failure; rollback errors are appended to the thrown message rather than swallowed. Undo backups are deliberately preserved when rollback fails. A rollback refuses (rather than clobbers) when the file changed underneath it — including a renamed file modified at its new path.
- Bounds live in `edits/types.ts`: `MAX_EDIT_FILES` 20, `MAX_EDIT_OPERATIONS_PER_FILE` 50, `MAX_EDIT_OPERATIONS_TOTAL` 200, plus size caps. The per-file and total operation caps are separate on purpose — one number for both would leave ~2.5 operations per file at 20 files. Still out of scope by design: binary files, symlinks, permission changes.

### Path and command safety

- All workspace-relative paths go through `tools/path-safety.ts:resolveWorkspacePath`, which rejects escapes outside the root; `edits/file-safety.ts` additionally `realpath`s targets and refuses symlinks and non-UTF-8/binary content.
- `commands/runner.ts` runs with `shell: false` and an argv array — never a shell string — plus a timeout and byte-capped, truncation-marked stdout/stderr. `propose_command`'s schema documents this to the model ("do not include shell syntax").
- `git/diff.ts` shells out to `git` read-only (`status --short`, `diff --stat`, `diff`) to show the user what changed after a command or edit.

## Conventions

- ESM with `"type": "module"` and `moduleResolution: "Bundler"`, but **every relative import still uses an explicit `.js` extension** (e.g. `import {x} from './types.js'`) even from `.ts`/`.tsx` sources. Match this.
- zod schemas define tool inputs and are the single validation point; `tools/registry.ts` keeps a parallel hand-written JSON Schema per tool in `toolParameterSchemas` for the model wire format. **Adding or changing a tool input means updating both.** Register new tools in `builtinTools`. `tests/tools/registry.test.ts` imports the bound constants (`MAX_EDIT_FILES`, `MAX_EDIT_OPERATIONS_PER_FILE`) rather than hardcoding numbers, so changing one side without the other fails the test instead of silently drifting.
- Language split: all user-facing strings (TUI text, prompts in `agent/prompts.ts`, confirmation words) are Simplified Chinese; identifiers, code comments, and thrown `Error` messages are English.
- Confirmation vocabulary is centralized: commands accept `y/yes/确认/执行/run`, edits accept `y/yes/确认/应用/apply`, undo also accepts `撤销/undo`, all reject with `n/no/取消/cancel`.
- Slash commands handled in `App.tsx`: `/run <cmd>`, `/undo`, and `/mode [mode-name]`.
- Permission modes (M7): `default-confirm` (default — commands and edits both need confirmation), `auto-accept-edits` (commands still need confirmation, edits apply immediately), `read-only` and `plan` (both reject commands and edits). Switch with `/mode <name>`; `/mode` alone prints the current mode. A `block` classification outranks the mode — blocked commands are refused even in `auto-accept-edits`. Mode vocabulary (`PERMISSION_MODES`, labels, descriptions, `isPermissionMode`) is centralized in `permissions/types.ts`; adding a mode should touch only that file plus `decide.ts`.
- `App.tsx` keeps `permissionMode` in **both** state and a ref. `onToolActivity` is registered once during boot, so it would close over the first render's mode value forever — it reads `permissionModeRef.current` instead. Update through `changePermissionMode()` so the two never drift.
- Auto-applied edits go through `autoApplyEdit()`, not `executePendingEdit()`: it runs while the agent loop is still active, so it must not touch `setBusy` (which `handleSubmit` owns) and must not stage a validation command (which would collide with the running loop).
- Ctrl-C cancels an in-flight agent turn; when there is nothing to cancel it exits. `render()` passes `exitOnCtrlC: false` (`cli/commands.ts`) so `App` owns the key — otherwise Ink would cancel *and* quit in one keystroke. The decision is a pure function in `tui/interrupt.ts`. `App` tracks `agentBusy` separately from `busy`, because `busy` is also true during commands and edits where `cancel()` is a no-op; keying off `busy` would report a cancellation that never happened.
- Model config lives at `$HOME/.gps-code/config.json`, written 0600 in a 0700 directory (`config/store.ts`); `config:show` masks the API key. Tests inject `homeDir` rather than touching the real home.

## Tests

`tests/` mirrors `src/` one-to-one, plus `tests/acceptance/safe-edits.test.ts`, which drives propose → confirm/reject → apply → stale → undo across the four language fixtures in `tests/fixtures/safe-edits/`. Vitest runs in the `node` environment with `restoreMocks: true`; only `tests/**/*.test.ts` is collected.

Filesystem tests create real temp workspaces via `mkdtemp` and clean up in `afterEach` — don't mock `fs`. To exercise failure paths, use the factory exports that accept injectable syscalls: `createEditApplier({rename, link, unlink})` and `createEditUndoer({rename})`. The default singletons `applyEditProposal` / `undoEditProposal` are those factories called with real deps.

`tests/helpers/fs-capabilities.ts` exports `canCreateSymlinks` and `canPersistFileModes` — top-level-await probes, not `process.platform` checks, so a test skips only where the capability is genuinely missing and still runs on a Windows box with Developer Mode. Windows cannot create symlinks without elevation and NTFS reports `0o666` for every file regardless of `chmod`. Tests that exist *only* to check those use `it.skipIf(!canX)`; where the capability is one assertion inside a broader test (`edits/apply`, `edits/undo`), guard just that assertion with `if (canPersistFileModes)` so the rest still runs. Prefer a probe over a platform check, and prefer guarding an assertion over skipping a whole test.

An async model mock should settle **only** when its `AbortSignal` fires, the way a real in-flight `fetch` does (see `tests/agent/cancel.test.ts`). Timer- or `setImmediate`-based mocks race: the mock finishes before the test can cancel, and the test then fails for a reason unrelated to what it claims to check.
