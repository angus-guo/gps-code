# GPS Code M3 Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade GPS Code from repo-map-only answers to evidence-driven project understanding with structured tools for listing files, reading files, searching text, and showing tool activity in the TUI.

**Architecture:** Add a small tool runtime with typed inputs/outputs and safe path boundaries. Extend the agent into a bounded tool loop that lets the model request `list_files`, `read_file`, and `search_text`, then answer with concrete evidence. Keep command execution and file modification out of M3.

**Tech Stack:** TypeScript, Node.js 20+, zod, execa, fast-glob, Vitest, Ink.

---

## Scope

In scope:

- Tool result and tool registry types.
- Safe workspace path resolution.
- `list_files` tool using `fast-glob`.
- `read_file` tool with file size and binary guards.
- `search_text` tool using local `rg` through `execa`, with a JS fallback only if `rg` is unavailable.
- A bounded agent tool loop using OpenAI-compatible tool/function calling payloads.
- Tool activity events for the TUI.
- Tests for tools, path safety, agent loop behavior, and CLI/TUI integration points.

Out of scope:

- Shell command execution.
- Git operations.
- File writing, patching, or diff application.
- Vector database or embeddings.
- Full semantic code parsing.
- Multi-step autonomous coding tasks.

## File Structure

- Create `src/tools/types.ts`: tool contracts and execution context.
- Create `src/tools/path-safety.ts`: workspace-relative path validation.
- Create `src/tools/list-files.ts`: list files under the workspace.
- Create `src/tools/read-file.ts`: read bounded text files.
- Create `src/tools/search-text.ts`: search workspace text with `rg`.
- Create `src/tools/registry.ts`: built-in tool registry and schema export.
- Modify `src/model/types.ts`: allow tool definitions, tool calls, and assistant messages with tool calls.
- Modify `src/model/openai-compatible.ts`: send tools and return structured assistant results.
- Modify `src/agent/agent.ts`: implement bounded tool loop and emit tool activity.
- Modify `src/tui/App.tsx`: collect and show tool activity messages.
- Modify `src/tui/components/ChatView.tsx`: render tool activity as system messages.
- Create `tests/tools/path-safety.test.ts`.
- Create `tests/tools/list-files.test.ts`.
- Create `tests/tools/read-file.test.ts`.
- Create `tests/tools/search-text.test.ts`.
- Modify `tests/model/openai-compatible.test.ts`.
- Modify `tests/agent/agent.test.ts`.

---

### Task 1: Tool Types And Path Safety

**Files:**
- Create: `src/tools/types.ts`
- Create: `src/tools/path-safety.ts`
- Create: `tests/tools/path-safety.test.ts`

- [ ] **Step 1: Write failing path safety tests**

Create tests that assert:

- `resolveWorkspacePath(root, 'src/index.ts')` returns an absolute path under `root`.
- absolute paths outside `root` are rejected.
- `../` traversal outside `root` is rejected.
- empty path resolves to `root` only when explicitly allowed.

Run:

```bash
pnpm test tests/tools/path-safety.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement shared tool types**

Create `src/tools/types.ts` with:

```ts
import type {z} from 'zod';

export type ToolContext = {
  root: string;
};

export type ToolResult = {
  content: string;
  metadata?: Record<string, unknown>;
};

export type ToolDefinition<Input> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<Input>;
  execute(input: Input, context: ToolContext): Promise<ToolResult>;
};

export type ToolActivity = {
  toolName: string;
  input: unknown;
  status: 'started' | 'completed' | 'failed';
  summary: string;
};
```

- [ ] **Step 3: Implement safe path resolution**

Create `src/tools/path-safety.ts` with:

- `resolveWorkspacePath(root, relativePath, options?)`
- `options.allowRoot?: boolean`
- reject paths outside the workspace
- normalize paths through `node:path`

- [ ] **Step 4: Verify**

Run:

```bash
pnpm test tests/tools/path-safety.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/types.ts src/tools/path-safety.ts tests/tools/path-safety.test.ts
git commit -m "feat: add tool path safety"
```

---

### Task 2: File Listing Tool

**Files:**
- Create: `src/tools/list-files.ts`
- Create: `tests/tools/list-files.test.ts`

- [ ] **Step 1: Write failing tests**

Test that `list_files`:

- lists workspace files relative to root
- ignores `.git`, `node_modules`, `dist`, and `coverage`
- respects an optional `limit`
- returns a concise text summary plus metadata

Run:

```bash
pnpm test tests/tools/list-files.test.ts
```

Expected: FAIL because the tool does not exist.

- [ ] **Step 2: Implement `listFilesTool`**

Use `fast-glob` and zod input:

```ts
{
  path?: string;
  limit?: number;
}
```

Default `path` is workspace root. Default `limit` is `200`. Output relative file paths.

- [ ] **Step 3: Verify and commit**

Run:

```bash
pnpm test tests/tools/list-files.test.ts
pnpm test
pnpm typecheck
```

Commit:

```bash
git add src/tools/list-files.ts tests/tools/list-files.test.ts
git commit -m "feat: add list files tool"
```

---

### Task 3: Read File Tool

**Files:**
- Create: `src/tools/read-file.ts`
- Create: `tests/tools/read-file.test.ts`

- [ ] **Step 1: Write failing tests**

Test that `read_file`:

- reads a UTF-8 text file under the workspace
- rejects traversal outside the workspace
- rejects directories
- rejects files larger than the configured max bytes
- returns line-number-friendly content metadata

Run:

```bash
pnpm test tests/tools/read-file.test.ts
```

Expected: FAIL because the tool does not exist.

- [ ] **Step 2: Implement `readFileTool`**

Use zod input:

```ts
{
  path: string;
  maxBytes?: number;
}
```

Default `maxBytes` is `64_000`. Return content and metadata:

```ts
{
  path,
  bytes,
  lineCount
}
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
pnpm test tests/tools/read-file.test.ts
pnpm test
pnpm typecheck
```

Commit:

```bash
git add src/tools/read-file.ts tests/tools/read-file.test.ts
git commit -m "feat: add read file tool"
```

---

### Task 4: Search Text Tool

**Files:**
- Create: `src/tools/search-text.ts`
- Create: `tests/tools/search-text.test.ts`

- [ ] **Step 1: Write failing tests**

Test that `search_text`:

- finds matching lines with file path and line number
- limits result count
- returns empty result text when no matches exist
- does not search ignored directories
- handles `rg` exit code `1` as no matches, not an error

Run:

```bash
pnpm test tests/tools/search-text.test.ts
```

Expected: FAIL because the tool does not exist.

- [ ] **Step 2: Implement `searchTextTool`**

Use `execa` to call `rg`:

```bash
rg --line-number --no-heading --color never <query> <path>
```

Input schema:

```ts
{
  query: string;
  path?: string;
  limit?: number;
}
```

Default `limit` is `50`. If `rg` is unavailable, use a small JS fallback based on `fast-glob` and `readFile`.

- [ ] **Step 3: Verify and commit**

Run:

```bash
pnpm test tests/tools/search-text.test.ts
pnpm test
pnpm typecheck
```

Commit:

```bash
git add src/tools/search-text.ts tests/tools/search-text.test.ts
git commit -m "feat: add search text tool"
```

---

### Task 5: Tool Registry

**Files:**
- Create: `src/tools/registry.ts`
- Create: `tests/tools/registry.test.ts`

- [ ] **Step 1: Write failing tests**

Test that the registry:

- exposes `list_files`, `read_file`, and `search_text`
- rejects unknown tool names
- validates tool input before execution
- converts zod schemas into OpenAI-compatible JSON schema metadata

- [ ] **Step 2: Implement registry**

Create:

- `createToolRegistry(tools)`
- `builtinTools`
- `getToolDefinitionsForModel()`
- `executeToolCall(name, input, context)`

Keep schemas simple enough to express as JSON schema manually; do not add a heavy converter dependency in M3.

- [ ] **Step 3: Verify and commit**

Run:

```bash
pnpm test tests/tools/registry.test.ts
pnpm test
pnpm typecheck
```

Commit:

```bash
git add src/tools/registry.ts tests/tools/registry.test.ts
git commit -m "feat: add tool registry"
```

---

### Task 6: Model Tool Call Support

**Files:**
- Modify: `src/model/types.ts`
- Modify: `src/model/openai-compatible.ts`
- Modify: `tests/model/openai-compatible.test.ts`

- [ ] **Step 1: Extend model tests first**

Add tests that verify:

- tool definitions are sent in the chat completions payload
- assistant tool calls are returned as structured data
- tool result messages can be sent back to the model
- plain assistant text still works

- [ ] **Step 2: Update model types**

Add:

- `ToolCall`
- `ModelToolDefinition`
- structured `ModelResponse`
- support for `tool` messages

- [ ] **Step 3: Update OpenAI-compatible client**

Keep backward compatibility by making `chat()` return structured response or by adding `complete()` while preserving existing tests through an adapter. Prefer explicit structure for agent use:

```ts
model.complete({messages, tools})
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm test tests/model/openai-compatible.test.ts
pnpm test
pnpm typecheck
```

Commit:

```bash
git add src/model tests/model/openai-compatible.test.ts
git commit -m "feat: support model tool calls"
```

---

### Task 7: Agent Tool Loop

**Files:**
- Modify: `src/agent/agent.ts`
- Modify: `tests/agent/agent.test.ts`

- [ ] **Step 1: Write failing agent loop tests**

Test that the agent:

- sends built-in tool definitions to the model
- executes a requested `read_file` tool call
- sends the tool result back to the model
- returns the final assistant answer
- stops after a bounded number of tool iterations
- emits tool activity events

- [ ] **Step 2: Implement bounded tool loop**

Add options:

```ts
maxToolRounds?: number;
onToolActivity?: (activity: ToolActivity) => void;
```

Default max rounds: `4`.

The loop:

1. Sends prompt, repo map, user input, and tool definitions.
2. If model returns tool calls, execute them through registry.
3. Append tool results to messages.
4. Ask model again.
5. Return final assistant text.

- [ ] **Step 3: Verify and commit**

Run:

```bash
pnpm test tests/agent/agent.test.ts
pnpm test
pnpm typecheck
```

Commit:

```bash
git add src/agent tests/agent/agent.test.ts
git commit -m "feat: add agent tool loop"
```

---

### Task 8: TUI Tool Activity

**Files:**
- Modify: `src/tui/App.tsx`
- Modify: `src/tui/components/ChatView.tsx`
- Optional create: `tests/tui/tool-activity.test.tsx`

- [ ] **Step 1: Add TUI behavior**

When agent emits tool activity:

- show started/completed/failed as system messages
- include tool name and a short summary
- keep user and assistant messages unchanged

- [ ] **Step 2: Verify manually through CLI**

Run:

```bash
pnpm build
node dist/cli/index.js --help
```

If a real API key is configured, ask:

```text
帮我解释 src/workspace/indexer.ts
```

Expected: TUI shows file/tool activity before final answer.

- [ ] **Step 3: Verify and commit**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Commit:

```bash
git add src/tui tests/tui
git commit -m "feat: show tool activity in TUI"
```

---

## Final Verification

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
node dist/cli/index.js --help
```

Expected:

- all tests pass
- typecheck passes
- build succeeds
- CLI help lists `config:set`, `config:presets`, and `config:show`

## Acceptance Criteria

M3 is complete when GPS Code can answer these questions using tool evidence:

- `这个项目怎么启动？`
- `登录逻辑在哪？`
- `帮我解释 src/workspace/indexer.ts`
- `config:set 命令是怎么保存配置的？`
- `OpenAI-compatible client 是怎么实现的？`

The answer should mention files actually read or searched, not only the repo map.

