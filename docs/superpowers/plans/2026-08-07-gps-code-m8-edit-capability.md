# M8: Edit Capability Extension

**Status:** ✅ Completed
**Date:** 2026-08-07
**Depends on:** M5 (edit engine), M7 (permission modes)

Numbered M8 per the amendment in the V2 spec, which shifted everything after M6
by one when shipped M7 turned out to be Permission Modes rather than this.

---

## Objective

Make the edit engine able to carry a real refactor. M5's caps (5 files, 20
operations) and its two actions (create, update) meant a rename had to be
expressed as create-plus-delete — except delete didn't exist either.

---

## Scope

### In scope
- `MAX_EDIT_FILES` 5 → 20; operation caps split and raised
- Whole-file rewrite as an alternative to exact-unique-match
- `delete` action, undoable
- `rename` action, undoable
- Rollback coverage for both new actions

### Out of scope (unchanged from M5, deliberately)
- Binary files, symlinks, permission changes
- Directory operations (create/remove/move a directory)
- Rename that also changes content — needs two proposals, since the target path
  doesn't exist when the first is prepared
- Multi-level undo (still one level)
- Blacklist completion and `strong-confirm`, which the V2 spec grouped into this
  milestone. Split out: this change is already the largest single edit to the
  safety-critical apply/undo path, and mixing permission work into the same
  commit would make a bisect ambiguous.

---

## Implementation

Done in two commits so the risky half could be verified separately.

### M8a — limits and whole-file rewrite

`MAX_EDIT_OPERATIONS` served double duty as both the per-file cap (in the zod
schema) and the whole-proposal cap (in `assertProposalBounds`). Raising files to
20 while keeping one number would have left ~2.5 operations per file, so it
split into `MAX_EDIT_OPERATIONS_PER_FILE` (50) and
`MAX_EDIT_OPERATIONS_TOTAL` (200).

Whole-file rewrite: an `update` whose single operation has an empty `oldText`
replaces the entire file. Restricted to being that file's only operation —
mixing it with exact-match operations is rejected — and it still carries
`expectedHash`, so staleness detection is unaffected.

That change opened a hole worth naming: the existing no-op check compares
`oldText` against `newText`, which can't see a whole-file rewrite whose content
matches the current bytes. `prepareExistingFile` now also rejects when
`proposedContent === originalContent`, which additionally catches exact-match
operations that cancel each other out — a case M5 never checked.

`tests/tools/registry.test.ts` hardcoded `maxItems: 5` and `20`. It now imports
the constants, so changing the zod bound without the JSON Schema fails the test.
That is exactly the drift CLAUDE.md warns about for the dual schema definition,
and it was previously unguarded.

### M8b — delete and rename

**Type contract.** `PreparedFileEdit` gains `originalMode: number | null`.
Undoing a delete has to recreate a file that no longer exists, so its mode can't
be read back from disk at that point — it has to be captured at proposal time.

`FileEditInput.operations` became optional (delete and rename take none), which
made the type serve two incompatible roles: zod's `.default([])` means
`operations` is optional on input and guaranteed on output. Typecheck caught
this. Split into `FileEditInput` (the input contract) and an internal
`ParsedFileEdit = z.output<typeof fileEditInputSchema>` used by every helper
after parsing.

**Validation.** `assertActionShape()` enforces per-action field requirements in
code rather than as a zod discriminated union. A union would render as `oneOf` in
the model-facing JSON Schema, which weaker OpenAI-compatible models handle
badly — and this product exists to target those models. The code check also
produces a sentence the model can act on ("Rename requires newPath") instead of
a union mismatch.

The duplicate-path scan now includes rename targets. Without that, two files
renamed onto the same target, or an edit to a file another entry deletes, would
let commit order decide the outcome.

**Apply.** Delete and rename skip the staging phase entirely — there is no
content to write — and act in place at commit (`unlink`, `rename`). The commit
loop became an explicit switch over the four actions, each asserting the fields
its path needs, so a future action can't silently fall through to the update
branch.

**Undo.** Delete restores from the proposal's in-memory `originalContent`, the
same mechanism update uses. The alternative — a `.deleted` backup file — would
leave artifacts in the workspace after a *successful* apply, which seemed worse.
Rename reverses the move.

---

## Bug found while testing

The first rename-undo implementation was a silent no-op. `inspectForUndo`
returned the *current* path as `targetPath`, which for a rename is the new path;
the commit then called `rename(newPath, newPath)` and did nothing, without
error. `targetPath` for a rename undo has to be the original path — where the
file is going — while the hash check still reads the new path, where the file
currently is.

This is the failure mode worth remembering: a rollback or undo branch that does
nothing looks identical to one that succeeded. Every new branch in this
subsystem needs a test that fails when the branch is removed.

Also fixed: the "rename source and target are the same" check lived in
`prepareRenamedFile`, which runs after the duplicate-path scan, so the generic
"duplicate file paths" error masked it. Moved into `assertActionShape`.

---

## Tests

| File | Tests | Covers |
|---|---|---|
| `tests/edits/delete-rename.test.ts` | 13 | delete apply/undo/stale/rejects-operations; rename apply/undo/stale/existing-target/missing-newPath/rejects-operations/same-path; delete+create in one proposal; two renames onto one target |
| `tests/edits/delete-rename-rollback.test.ts` | 5 | delete restored when a later delete fails; delete restored when a later create fails; rename moved back when a later update fails; rename rollback **refuses** when the file changed at its new path; undo rollback re-deletes a recreated file |
| `tests/edits/proposal.test.ts` | +5 | whole-file rewrite; no-op rewrite; empty `oldText` mixed with other operations; cancelling operations; total operation budget |

**Every new rollback branch was verified by removing the implementation and
confirming only the matching tests fail** — the delete branch, then the rename
branch, each restored afterwards. Given the silent-no-op bug above, a passing
rollback test proves nothing on its own.

**Suite: 174 passed, 3 skipped, 0 failed** (29 files), up from 151/3/0. The 3
skips are the documented Windows capability gaps.

---

## Verification

```bash
npm run typecheck   # pass
npm run build       # pass
npm test            # 174 passed, 3 skipped, 0 failed
```

**Not verified:** no end-to-end run against a live model proposing a delete or
rename. The tool schema advertises both actions but no real model has been
observed choosing them, so the descriptions in `toolParameterSchemas` are
unproven in practice. The acceptance test (`tests/acceptance/safe-edits.test.ts`)
also still only exercises create and update across the four language fixtures —
extending it to the new actions would be worthwhile.

---

## Files changed

```
src/edits/types.ts        four actions, originalMode, split operation caps,
                          FileEditInput vs PreparedFileEdit
src/edits/proposal.ts     assertActionShape, prepareDeletedFile,
                          prepareRenamedFile, whole-file rewrite, no-op guard,
                          rename targets in the duplicate scan, ParsedFileEdit
src/edits/apply.ts        per-action inspect/commit/rollback branches
src/edits/undo.ts         per-action inspect/commit/rollback branches
src/edits/preview.ts      delete and rename patch headers
src/tools/registry.ts     action enum, newPath, relaxed required, raised caps
tests/edits/delete-rename.test.ts           new (13)
tests/edits/delete-rename-rollback.test.ts  new (5)
tests/edits/proposal.test.ts                +5
tests/tools/registry.test.ts                bound to shared constants
tests/edits/preview.test.ts                 originalMode in fixtures
tests/tui/edit-confirmation.test.ts         originalMode in fixture
```

---

## Next

**M9 — blacklist completion and strong-confirm** (split out of this milestone)
- `chmod -R`, `chown -R`, global package installs, DB migrations
- `strong-confirm` tier requiring the command to be retyped
- allowlist/denylist in `config.json`

**Also outstanding**
- Extend `tests/acceptance/safe-edits.test.ts` to delete and rename
- Hand smoke-test of Ctrl-C cancellation (carried over from M7.5)
- Mode persistence across sessions
- Multi-level undo
