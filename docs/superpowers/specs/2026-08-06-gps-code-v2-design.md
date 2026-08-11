# GPS Code V2 Design

Date: 2026-08-06

## Summary

GPS Code V2 repositions the product from a codebase explanation tool to a **full AI coding agent** while preserving its core differentiation: Chinese-first interaction, first-class support for domestic OpenAI-compatible models (DeepSeek, Qwen, Kimi, Ollama), and a **senior engineer mentor personality** that explains WHY while changing code.

The V1 spec explicitly listed "Strong automatic code modification" as a non-goal. That constraint is now retired. GPS Code V2 is designed to handle real multi-file refactoring tasks, long agent sessions, and autonomous editing workflows — but it keeps the safety engineering and evidence-driven approach that made M1-M5 unusually robust.

## What Changes

**Retired V1 Non-Goals** (quoted from 2026-06-30-gps-code-design.md):

> "Strong automatic code modification." (line 368)

> "not making automatic code modification the main MVP flow." (line 84)

**New Positioning**:

GPS Code is a Chinese-first AI coding agent for individual developers, especially junior and mid-level programmers who benefit from **guided automation** — the agent not only changes code but explains architectural reasoning, common pitfalls, and next verification steps in Simplified Chinese.

Target capability: a developer can hand GPS Code a real task on a real repo ("refactor authentication to use JWT", "add pagination to /users API", "migrate from Vite to Next.js") and GPS Code completes it across multiple files, commits, and test-fix cycles, while teaching the developer what it did and why.

## What Stays

**Preserved Principles from V1**:

- **Evidence-driven answers**: Never claim certainty without citing specific files, functions, or configuration.
- **Propose/confirm as the default mode**: The safety model becomes a **mode system** (default-confirm / auto-accept-edits / read-only / plan) rather than an absolute. Users can opt into autonomous editing for large refactors, but the default asks before acting.
- **Atomic writes with staleness detection**: The M5 edit engine (temp file + fsync + rename/link, sha256 recheck before commit, multi-file rollback) is a production-grade asset. Do not weaken it.
- **Argv-not-shell command execution**: `shell: false` + argv array makes permission policy structural rather than regex-guessing shell strings.
- **Workspace path confinement**: All file operations stay inside the workspace root; `resolveWorkspacePath` + `realpath` block symlink escapes.
- **Chinese-first interaction**: All user-facing text (TUI, prompts, confirmation words, error messages) in Simplified Chinese. Code comments and thrown `Error` messages in English.
- **Mentor personality**: The system prompt's "结论 / 依据 / 讲解 / 注意 / 下一步" structure stays. GPS Code explains what it changed and why, not just "I applied the edit."

## Target Architecture

| Component | Responsibility | Status | Modules |
|-----------|----------------|--------|---------|
| **Agent Session** | Persistent conversation state, cross-turn message accumulation, tool loop (20+ rounds), cancellation | **Needs rework** | `agent/agent.ts` → `AgentSession` class, `agent/types.ts` |
| **Permission System** | Four-mode policy (default-confirm / auto-accept-edits / read-only / plan), dangerous command classification (allow/confirm/strong-confirm/block), allowlist/denylist | **New** | `permissions/policy.ts`, `permissions/types.ts` |
| **Context Management** | Token counting, history compression (keep recent N rounds, summarize older), tool result truncation, repo map incremental updates | **New** | `agent/agent.ts`, `model/token-counter.ts` (new) |
| **Edit Engine** | Atomic apply with staleness detection, one-level undo, exact-unique-match + whole-file modes | **Exists** (M5) | `edits/*.ts` — preserve all safety properties |
| **Edit Capabilities** | 20 files/50 operations (up from 5/20), delete, rename, multi-level undo | **Needs extension** | `edits/types.ts`, `edits/apply.ts`, `edits/undo.ts` |
| **Command Runner** | Argv + `shell:false`, timeout, output truncation, workspace-bound cwd | **Exists** (M4) | `commands/runner.ts` — add policy gate |
| **Tool Registry** | Single-source schema (zod → JSON Schema auto-gen), tool-calling degradation for weak models | **Needs rework** | `tools/registry.ts` |
| **Model Client** | OpenAI-compatible fetch, streaming, retry/backoff, multi-model routing (cheap for search, strong for edit) | **Needs extension** | `model/openai-compatible.ts` |
| **TUI** | Ink-based, streaming output, interrupt, first-run onboarding | **Needs extension** | `tui/App.tsx`, `tui/components/*.tsx` |
| **Workspace Indexer** | RepoMap for JS/TS, Python, Java, C/C++ | **Exists** (M1-M2) | `workspace/indexer.ts`, `workspace/languages/*.ts` |
| **Git Integration** | Read-only diff (exists), auto-stage/commit (new) | **Partial** | `git/diff.ts`, `git/stage.ts` (new in M11) |
| **Project Config** | GPS.md parsing, MCP client, hooks | **New** (M12) | `workspace/gps-md.ts`, `mcp/client.ts`, `hooks/runner.ts` |

## Roadmap Amendment (2026-08-06, after M6/M7 shipped)

The roadmap below was written before implementation. What actually shipped
differs, and the numbering has been amended rather than silently corrected:

- **M6 as shipped** covered the `AgentSession` refactor, tool-result truncation,
  send-repo-map-once, and the *infrastructure* for permissions — but the mode
  system was inert and the blacklist was bypassable via `/run`.
- **M7 as shipped** is therefore **Permission Modes**, not "Edit Capability
  Extension": it made the four modes actually change behavior, closed the `/run`
  bypass by enforcing policy inside `runCommand()`, and added the header
  indicator. See `plans/2026-08-06-gps-code-m7-permission-modes.md`, which also
  records three claims the first pass of that document made falsely.
- **Everything from M7 onward below shifts by one.** "Edit Capability Extension"
  becomes M8; "Complete Blacklist + Tool-Calling Degradation" merges its
  blacklist half into M8 and its degradation half into M9.
- **Cancellation is still not done.** `AgentSession.cancel()` and its
  `AbortController` exist, but no `AbortSignal` reaches `fetch` and no key
  handler calls `cancel()`. It was listed in M6 scope and did not ship. Note
  that `InputBox` already owns Ink's `useInput`, so Ctrl-C wiring needs care.
  **Resolved 2026-08-07 in M7.5** — see
  `plans/2026-08-07-gps-code-m7.5-cancellation.md`. Numbered 7.5 because it
  closes M6 debt rather than opening a milestone, so the shift below is still
  one, not two.

Treat the milestone *contents* below as still valid and the *numbers* as
off-by-one past M6.

## Long-Term Roadmap: M6-M12

### M6 — Agent Session + Permission Modes + Lightweight Context Management

**Goal**: Enable multi-turn coding tasks, auto-accept-edits mode for large refactors, and prevent context window explosions.

**Why M6**: Session state is the foundation. Every milestone delayed multiplies the rework. Permission modes unlock "接 30 文件重构任务" immediately. Without context management, the session built in M6 would die in 10 rounds.

**In Scope**:
- `AgentSession` class: persistent `messages`, `ask()` appends instead of rebuilds, `maxToolRounds` → 20
- `App.tsx` creates session once at boot, reuses it across submits
- Four permission modes: `default-confirm` / `auto-accept-edits` / `read-only` / `plan`
- Dangerous command blacklist (基础版): `rm -rf`, `git push --force/-f`, `git reset --hard`
- Tool result truncation: content > 2000 tokens → keep head + tail + "..."
- Repo map: first turn full JSON, later turns placeholder or skip
- Interrupt: `AbortController` + Ctrl-C binding

**Out of Scope**: history compression (M9), complete blacklist (M8), tool schema auto-gen (M10), streaming (M9)

**Files**:
- `src/agent/agent.ts` — large refactor
- `src/agent/types.ts` — new
- `src/tui/App.tsx` — medium refactor
- `src/permissions/policy.ts` — new
- `src/permissions/types.ts` — new
- `src/commands/runner.ts` — small change (call policy at entry)
- `tests/permissions/policy.test.ts` — new
- `tests/agent/agent.test.ts` — large refactor

**Acceptance**:
1. Cross 5-turn conversation, model references file read in turn 1
2. `auto-accept-edits` mode: 10 consecutive edit proposals apply without 10 confirmations
3. `read-only` mode: edit and command proposals rejected
4. `plan` mode: edit and command rejected, only read allowed
5. `rm -rf /` blocked
6. `git push --force` blocked
7. Large repo (1000+ files): turn 2 does not resend full repo map (check message array length)
8. Ctrl-C interrupts in-flight model call
9. Tool result > 2000 tokens truncated (check for "..." or "[truncated]")

**Risk**: Session state bugs. Full M5 regression required.

---

### M7 — Edit Capability Extension

**Goal**: Support delete, rename, higher limits, whole-file mode for real refactoring tasks.

**Why M7**: M6 built session, but 5-file/20-op caps kill real tasks immediately. This must follow M6 directly.

**In Scope**:
- `MAX_EDIT_FILES` 20, `MAX_EDIT_OPERATIONS` 50
- `action: 'delete'`: backup to `.gps-code-<name>-<uuid>.deleted`, undo restores
- `action: 'rename'`: requires `newPath`, checks target does not exist
- Whole-file-rewrite: `oldText` empty + `action='update'` → `newText` is full content (with `expectedHash` check)
- Keep exact-unique-match as default (most robust)

**Out of Scope**: multi-level undo (M11), git auto-stage (M11), binary/symlink (永久 out of scope)

**Files**:
- `src/edits/types.ts`, `src/edits/proposal.ts`, `src/edits/apply.ts`, `src/edits/undo.ts` — medium changes
- `src/tools/propose-file-edits.ts` — small change
- `src/tools/registry.ts` — small change (JSON Schema sync)
- `tests/edits/*.test.ts`, `tests/acceptance/safe-edits.test.ts` — changes

**Acceptance**:
1. Propose delete 3 + rename 2 + update 15 files, apply all in one confirmation
2. Whole-file mode rewrites a 500-line file successfully
3. Delete undo restores file
4. Rename undo restores original name
5. All M5 safety properties pass: staleness rejection, atomic write, rollback

**Risk**: Delete/rename undo edge cases (file changed after rename).

---

### M8 — Complete Blacklist + Tool-Calling Degradation

**Goal**: Fill safety gaps, make weak domestic models usable.

**Why M8**: Users start using M6-M7 for real. Safety and model compatibility must land now.

**In Scope**:
- Blacklist: `chmod -R`, `chown -R`, `npm/pnpm/yarn/bun install -g`, migration commands (`django-admin migrate`, `rails db:migrate`, `prisma migrate deploy`, `flyway migrate`)
- Strong-confirm: requires typing command itself or "确认删除", not `y`
- Tool-calling degradation: catch format errors, fallback to "模型未能正确调用工具，请用自然语言描述你的发现"
- Config allowlist/denylist (`config.json` adds fields)

**Out of Scope**: multi-model routing (M11), MCP (M12)

**Files**:
- `src/permissions/policy.ts` — medium changes
- `src/permissions/types.ts` — small change
- `src/config/schema.ts` — small change
- `src/agent/agent.ts` — small change (degradation logic)
- `src/model/openai-compatible.ts` — small change
- `src/tui/App.tsx` — medium change (strong-confirm flow)
- `src/tui/command-confirmation.ts` — small change
- `tests/permissions/*.test.ts` — changes

**Acceptance**:
1. `chmod -R 777 /` blocked
2. `npm install -g pkg` triggers strong-confirm, `y` rejected, typing command passes
3. Allowlist `["pnpm test"]` auto-allows `pnpm test`
4. Qwen-Turbo (weak tool-calling) completes basic conversation via degradation

**Risk**: Blacklist incomplete (document "不保证拦截所有风险").

---

### M9 — History Compression + Streaming + Token Counting

**Goal**: Long sessions don't explode, long answers feel responsive.

**Why M9**: M6 built persistent sessions, M7-M8 users start real use → long-session explosion surfaces.

**In Scope**:
- History compression: keep recent 5 turns full, older turns keep only user + assistant final answer (drop tool details)
- `tiktoken` or `js-tiktoken` for token counting, check budget before appending (assume 32K context, 8K buffer)
- Streaming: `openai-compatible.ts` detects `response.body.getReader()`, parses SSE, yields chunks
- TUI subscribes to stream events, renders in real-time
- Interrupt streaming: `AbortController` stops stream

**Out of Scope**: prompt caching (M11, provider-dependent)

**Files**:
- `src/agent/agent.ts` — medium changes
- `src/model/openai-compatible.ts` — **large** changes
- `src/model/types.ts` — small change
- `src/tui/App.tsx` — medium change
- `package.json` — add `js-tiktoken`

**Acceptance**:
1. After 20 turns, `session.messages` keeps 5 recent full + 15 older summaries
2. Token overflow triggers auto-compression
3. Long answer renders character-by-character, not 10s freeze
4. Ctrl-C stops stream mid-output, keeps already-rendered content

**Risk**: Compression may drop critical context (e.g., file read in turn 3, referenced in turn 15). Show "已压缩 N 轮" warning.

---

### M10 — Tool Schema Single-Source + First-Run Onboarding

**Goal**: Clear tech debt, lower new-user friction.

**Why M10**: M6-M9 fixed core capabilities, tech debt accumulated. Clean now before extending tools.

**In Scope**:
- `zod-to-json-schema` auto-generates JSON Schema from zod, delete `toolParameterSchemas` hand-written part
- First run: detect `~/.gps-code/config.json` missing → TUI shows interactive form
- Preset selection in TUI (list DeepSeek / Qwen / Kimi / Ollama, user picks)

**Out of Scope**: multi-model routing (M11), GPS.md (M11)

**Files**:
- `src/tools/registry.ts` — **large** changes
- `src/cli/commands.ts` — small change
- `src/tui/App.tsx` — medium change
- `src/tui/components/ConfigForm.tsx` — **new**
- `package.json` — add `zod-to-json-schema`

**Acceptance**:
1. Change `read_file` zod schema (`maxBytes` → 128000), JSON Schema auto-syncs
2. New user runs `gps-code`, TUI guides through DeepSeek config
3. All tool schemas pass consistency tests

**Risk**: `zod-to-json-schema` output may differ slightly (e.g., `additionalProperties`). Full tool regression required.

---

### M11 — Multi-Model Routing + Multi-Level Undo + Git Integration

**Goal**: Cut costs, improve reversibility, deep git integration.

**Why M11**: Core capabilities complete, optimize cost (multi-model) and UX (multi-undo, git).

**In Scope**:
- `config.json` → `{default: ModelConfig, search?: ModelConfig, edit?: ModelConfig}`, agent picks by phase
- Undo history persists to `~/.gps-code/undo-stack.json`, 3-5 levels
- Post-edit auto `git add`, optional auto-commit (`config.json` adds `autoCommit: boolean`)

**Out of Scope**: auto-PR (永久 out of scope), subagents (M12)

**Files**:
- `src/config/schema.ts` — medium change
- `src/agent/agent.ts` — small change
- `src/edits/undo.ts` — medium change
- `src/git/stage.ts` — **new**
- `src/tui/App.tsx` — small change

**Acceptance**:
1. Config `search`: Qwen-Turbo, `edit`: DeepSeek-V2.5 → agent auto-switches
2. After 5 edits, `/undo` reverts 1, `/undo 3` reverts 3
3. Edit applied → `git status` shows files staged

**Risk**: Phase detection inaccurate (search phase suddenly needs edit) → fallback to `default`.

---

### M12 — Project Config + MCP Client + Hooks

**Goal**: Extensibility for project-specific needs.

**Why M12**: Core + UX done, now open extension interfaces.

**In Scope**:
- GPS.md parsing (like CLAUDE.md): project root `GPS.md` → inject into system message
- MCP client: connect to local MCP server, extend tool set
- Hooks: `pre-edit` / `post-edit` / `pre-command` / `post-command` scripts in `.gps-code/hooks/`

**Out of Scope**: subagents (需要更复杂的并发控制, maybe M13)

**Files**:
- `src/workspace/gps-md.ts` — **new**
- `src/mcp/client.ts` — **new**
- `src/hooks/runner.ts` — **new**
- `src/agent/agent.ts` — small change
- `src/tui/App.tsx` — small change

**Acceptance**:
1. `GPS.md` states "Django project, test with `python manage.py test`" → agent reflects this
2. Connect to local MCP server with `database_query` tool → agent can call it
3. `.gps-code/hooks/pre-edit.sh` exists → runs before edit, non-zero exit blocks edit

**Risk**: MCP protocol version compat, hook security (docs must warn "hooks run arbitrary code").

---

## Sequencing Rationale

1. **M6 most urgent**: Session is foundation. Every milestone delayed → N more files to change.
2. **M7 immediately after**: Without this, "能接任务" is empty promise (5-file cap kills real work).
3. **M8 safety + compat**: Users start real use after M6-M7 → safety gaps and weak-model compat must land.
4. **M9 UX bottleneck**: Long sessions explode, long answers feel frozen → must fix before users churn.
5. **M10 tech debt**: Debt not cleared → adding tools becomes painful.
6. **M11-M12 polish**: Core complete, optimize and extend.

**Refused Temptations**:
- **Not streaming first**: Obvious UX win, but not architectural blocker → M9.
- **Not MCP first**: Cool extensibility, but users need "working agent" first → M12.
- **Not delaying permission modes**: Risk surface large after M5 edits → M6 must have basic blocking.

## Key Risks

1. **Session refactor breakage**: M6 touches core agent loop. Full regression essential.
2. **Blacklist incompleteness**: No blacklist catches all danger. Docs must set expectations.
3. **Compression drops context**: Early turns' file reads may be referenced 15 turns later. Show compression warnings.
4. **Weak model tool-calling fails silently**: Degradation fallback must be obvious, not hidden failure.
5. **Multi-model routing phase detection**: Heuristic may guess wrong → need `default` fallback.

## Open Decisions

1. **Token counter library**: `tiktoken` (wasm, heavy) vs `js-tiktoken` (JS, lighter but approximate)?
2. **History compression trigger**: Absolute token count or percentage of context window?
3. **Strong-confirm UX**: Type full command vs type "确认删除" vs custom challenge phrase?
4. **GPS.md format**: Markdown sections vs YAML frontmatter vs free-form?
5. **MCP server discovery**: Manual config vs auto-discovery in `~/.config/mcp/`?

## Success Criteria for V2

GPS Code V2 is ready for public announcement when:

1. A developer can hand GPS Code a **30-file TypeScript refactor** ("convert all class components to hooks"), confirm once in `auto-accept-edits` mode, and GPS Code completes it while explaining each batch of changes.
2. A **20-turn debugging session** on a large repo does not hit context limits or lose track of earlier evidence.
3. `rm -rf`, `git push --force`, and global installs are **blocked by default**, with clear explanations.
4. A new user runs `gps-code` for the first time and **completes model setup inside the TUI** without reading docs.
5. All **M1-M5 safety properties** still pass: staleness rejection, atomic writes, rollback, exact-unique-match, workspace confinement.
6. GPS Code works with **Qwen-Turbo and early Kimi models** (weak tool-calling) via degradation, not just DeepSeek-V2.5.
7. The **mentor personality** remains visible: after a multi-file edit, GPS Code explains "为什么这么改" and "下一步应该验证什么", not just "I applied 15 edits."

## Differentiation Anchor

**Position GPS Code as the AI coding agent for developers who want to learn, not just delegate.**

Every other agent (Claude Code, Aider, Cline, Cursor) treats code modification as a black box: the model changes files, the user reviews diffs. GPS Code uniquely combines autonomous capability with **pedagogical transparency**: it explains the architectural reasoning behind each change, warns about edge cases, and suggests verification commands — all in the user's native language.

This is especially valuable for junior and mid-level developers, who benefit most from understanding *why* a refactor works, not just seeing that it compiled.

The Chinese-first + domestic-model-optimized positioning differentiates on **access and cost**, while the mentor personality differentiates on **learning value**. Together they define a wedge no competitor currently occupies.
