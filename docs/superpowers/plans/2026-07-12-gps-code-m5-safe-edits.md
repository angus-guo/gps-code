# GPS Code M5 Safe Edits Implementation Plan

**Goal:** Let GPS Code propose small, reviewable text edits, show an exact preview, and apply them only after explicit user confirmation.

**Architecture:** Keep model output separate from file writes. The agent first creates a structured edit proposal with exact-match operations and file hashes. A read-only preparation layer validates paths and produces proposed contents. A later apply layer rechecks hashes immediately before atomic writes. The TUI owns confirmation, cancellation, and undo state.

**Tech Stack:** TypeScript, Node.js 20+, zod, Vitest, Ink.

---

## Scope

In scope:

- Update existing UTF-8 text files.
- Create new UTF-8 text files in existing workspace directories.
- Exact-match text replacements with bounded proposal size.
- Diff preview before confirmation.
- Hash-based stale proposal detection.
- Explicit confirmation before writes.
- One-level undo for the most recent GPS Code edit.
- Post-edit diff inspection and validation command suggestions.

Out of scope:

- File deletion or rename.
- Binary files, permissions, and symbolic links.
- Autonomous edit-test-repair loops.
- Automatic git staging, commits, pushes, or pull requests.
- Large-scale refactors.

---

### Task 1: Structured Edit Proposals

- [x] Define bounded edit proposal types and schemas.
- [x] Validate workspace paths, existing files, and create targets.
- [x] Require exact unique matches for update operations.
- [x] Capture original and proposed content hashes without writing files.
- [x] Reject binary files, symbolic links, duplicate paths, and oversized proposals.

### Task 2: Preview and Safe Apply Engine

- [x] Generate bounded unified diff previews.
- [x] Recheck expected hashes immediately before applying.
- [x] Write through temporary files and preserve existing file modes.
- [x] Roll back already written files if a multi-file apply fails.
- [x] Return deterministic apply results for the TUI.

### Task 3: Agent Edit Proposal Tool

- [x] Add a model-visible `propose_file_edits` tool.
- [x] Emit a pending edit activity without writing files.
- [x] Require the final agent answer to state that confirmation is required.

### Task 4: TUI Preview and Confirmation

- [x] Store one pending edit proposal.
- [x] Render purpose, file list, and bounded diff preview.
- [x] Support explicit apply and cancel inputs.
- [x] Surface stale proposal and apply failures clearly.

### Task 5: Undo and Post-Edit Verification

- [ ] Keep an in-memory snapshot for the most recent applied edit.
- [ ] Refuse undo when files changed after GPS Code applied them.
- [ ] Show the resulting workspace diff.
- [ ] Suggest validation commands through the existing confirmation flow.

### Task 6: Cross-Language Acceptance

- [ ] Exercise focused edits in JS/TS, Python, Java, and C/C++ fixtures.
- [ ] Verify confirm, reject, stale proposal, apply failure, and undo paths.
- [ ] Run the full automated suite and manual TUI smoke test.
