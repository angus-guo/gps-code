# M7: Permission Modes UI

**Status:** ✅ Completed  
**Date:** 2026-08-06  
**Depends on:** M6 (AgentSession + Permissions)

---

## Objective

Provide UI for users to switch between permission modes via `/mode` command and see current mode in status bar.

---

## Scope

### In Scope
- `/mode` slash command to switch modes
- Mode indicator in TUI status bar
- Four permission modes:
  - `default-confirm`: Every operation requires confirmation (default)
  - `auto-accept-edits`: Commands require confirmation, edits auto-apply
  - `read-only`: Block all commands and edits
  - `plan`: Block all commands and edits, agent only plans

### Out of Scope
- Persistence of mode across sessions (M8)
- Per-project mode defaults
- Mode-specific agent prompts (future milestone)

---

## Implementation

### 1. Add `/mode` Command Handler ✅

**File:** `src/tui/App.tsx`

Added slash command parsing in `handleSubmit`:
- `/mode` with no args → show current mode + help text
- `/mode <mode-name>` → switch to specified mode
- Invalid mode name → show error with valid options

Mode labels (Chinese):
- `default-confirm` → 默认确认模式
- `auto-accept-edits` → 自动接受编辑模式
- `read-only` → 只读模式
- `plan` → 计划模式

### 2. Add Permission Mode State ✅

**File:** `src/tui/App.tsx`

```ts
const [permissionMode, setPermissionMode] = useState<PermissionMode>('default-confirm');
```

### 3. Integrate Policy Check ✅

**File:** `src/tui/App.tsx`

Updated `onToolActivity` handler for proposed commands:
- Call `classifyCommand(command)` to get policy result
- If `classification === 'block'` → auto-reject with reason
- If `classification === 'allow'` → auto-confirm (currently unused, reserved for `auto-accept-edits` mode in future)
- If `classification === 'confirm'` → show confirmation UI as before

**Note:** Current policy implementation (`src/permissions/policy.ts`) does NOT yet use `permissionMode` parameter. Mode-aware policy enforcement will be added in future milestone when we implement:
- `auto-accept-edits` → allow read-only commands automatically
- `read-only` → block all commands except reads
- `plan` → block all commands

### 4. Add Mode Indicator ✅

**File:** `src/tui/App.tsx`

Added mode indicator to TUI header (placeholder implementation, needs visual design):

```tsx
<Text bold color="green">GPS Code [{permissionMode}]</Text>
```

Future improvement: Better visual formatting for mode indicator.

---

## Testing

### Manual Testing Checklist ✅

- [x] `/mode` with no args shows current mode and help
- [x] `/mode default-confirm` switches mode successfully
- [x] `/mode auto-accept-edits` switches mode successfully
- [x] `/mode read-only` switches mode successfully
- [x] `/mode plan` switches mode successfully
- [x] `/mode invalid-mode` shows error message
- [x] Mode indicator updates after switching
- [x] Dangerous commands blocked regardless of mode
- [x] TypeScript typecheck passes
- [x] Build succeeds

### Automated Tests

No new tests added (TUI component not easily unit-testable with current architecture).

Existing test suite status: 119/126 passing
- 7 pre-existing failures (Windows path separator issues in `search-text.test.ts` and `edits/apply.test.ts`)
- No new test failures introduced

---

## Verification

```bash
npm run typecheck  # ✅ Pass
npm run build      # ✅ Pass (83ms ESM, 10156ms DTS)
npm test           # ✅ 119/126 (same baseline as M6)
```

---

## Architecture Notes

### Design Decision: Policy Check in TUI Layer

Permission policy check stays in `App.tsx` (TUI layer), not `commands/runner.ts` (execution layer), because:

1. `runner.ts` is a pure execution utility — it should not know about session-level `permissionMode`
2. Policy decisions belong to the session/UI layer where user context lives
3. Keeps execution layer testable without mocking session state

### Future Work

1. **Mode-aware policy enforcement** (future milestone):
   - `classifyCommand()` currently does NOT use `permissionMode`
   - Need to pass mode and implement mode-specific rules:
     - `auto-accept-edits`: auto-approve read-only commands (ls, cat, git status)
     - `read-only`: block all write/execute commands
     - `plan`: block all commands

2. **Edit proposals** (future milestone):
   - Currently no policy check on edit proposals
   - Need similar `onToolActivity` logic for `status === 'edit-proposed'`
   - `auto-accept-edits` mode should auto-apply edits

3. **Mode persistence** (M8):
   - Save mode to session state
   - Restore on `/resume`

4. **Mode-specific agent prompts** (future milestone):
   - `plan` mode should tell agent to only plan, not propose actions
   - Inject mode-aware system message at agent boot

---

## Files Changed

- `src/tui/App.tsx` — added `/mode` command, mode state, mode indicator
- `src/permissions/types.ts` — already exported `PermissionMode` type (M6)
- `src/permissions/policy.ts` — no changes (already implements `classifyCommand`)

---

## Next Milestone

**M8: Session Persistence**
- Persist session to disk (messages, mode, lastAppliedEdit)
- Implement `/resume` command
- Save/load from `~/.gps-code/sessions/<workspace-hash>.json`
