# M9: Blacklist Completion and Strong Confirmation

**Status:** ✅ Completed
**Date:** 2026-08-07
**Depends on:** M6 (policy foundation), M7 (permission modes)

Split out of M8 per the milestone amendment in V2: the edit limits and
delete/rename were already the largest single change to the apply/undo path, and
mixing permission work in would have made a bisect ambiguous.

---

## Objective

Close the gaps in the M6 command policy and add a higher-friction confirmation
tier for risky-but-legitimate operations.

---

## Scope

### In scope
- Destructive system commands: `dd`, `mkfs`, `format`, `shutdown`, `reboot`, etc.
- Recursive permission changes: `chmod -R`, `chown -R`, `icacls` — blocked when
  targeting system paths or escaping the workspace, otherwise strong-confirm
- Global package installs: `npm -g`, `pnpm -g`, `pip --user`, etc. (strong-confirm)
- Database migrations: forward migrations (strong-confirm), destructive ones like
  `reset`/`drop`/`rollback` (block)
- `strong-confirm` tier: user must retype the command rather than answering `y`
- Allowlist and denylist in `config.json`

### Out of scope
- `npm`/`pnpm` publish, `curl`/`wget` with output redirect — not dangerous enough
  to block and not common enough to justify the maintenance cost
- Recursive directory removal (`rm -r dir/`) — already blocked by the M6 recursive
  flag check
- Fork bombs and piped shell commands — not a concern since the runner uses
  `shell: false`

---

## Implementation

### Policy expansion

`policy.ts` grew from 3 rules (M6) to 13 pattern groups:

1. **Destructive system commands** (block): `dd`, `mkfs.*`, `format`, `fdisk`,
   `diskpart`, `shutdown`, `reboot`, `halt`, `poweroff`
2. **File removal** (M6, unchanged): recursive or forced `rm`/`rmdir`/`del` block,
   plain removal confirms
3. **Git operations** (M6, unchanged): `push --force`, `reset --hard`, `clean -f`
   all block
4. **Recursive permission changes**: `chmod -R`, `chown -R`, `icacls` with `/t`
   - Block when any target is a system path (`/`, `/etc`, `/usr`, `C:\`, etc.) or
     contains `..` traversal that escapes the workspace
   - Otherwise strong-confirm
5. **Global package installs** (strong-confirm): `npm -g`, `pnpm -g`,
   `yarn global`, `bun -g`, `pip --user`, `gem`, `cargo`
6. **Database migrations**:
   - Forward migration tokens (`migrate`, `deploy`, `upgrade`, `db:migrate`, etc.)
     → strong-confirm
   - Destructive tokens (`reset`, `drop`, `rollback`, `clean`, `wipe`) → block
   - Covers Prisma, Sequelize, Knex, TypeORM, Alembic, Flyway, Liquibase, Rails,
     Django, Drizzle, Atlas

Allowlist and denylist consulted in precedence order: denylist, then built-in
blocks, then allowlist, then remaining built-in rules. An allowlist entry can
downgrade a `confirm` or `strong-confirm` to `allow`, but **cannot** override a
built-in `block` — the point of a block is that no config file makes it reachable.

### Strong confirmation

`CommandClassification` gained `'strong-confirm'`, `CommandProposalDecision` the
same. `getStrongConfirmationDecision(input, command)` rejects when the input is a
plain `y`/`yes`/`确认` and only confirms when it exactly matches the formatted
command line. The whole point is to break the habit of confirming without reading.

`App.tsx` now bundles the command and its decision together in `pendingCommand:
{command, strong}` so the confirmation check can never disagree with the
classification that produced the prompt. Three paths set pending commands: the
model proposal branch, the `/run` branch, and the validation suggestion after edit
apply. All three now go through `decideCommandProposal` with policy options.

### Config schema

`configSchema` gained two optional arrays:

```typescript
allowlist: z.array(z.string()).optional()
denylist: z.array(z.string()).optional()
```

Patterns are either exact matches (`"pnpm test"`) or prefix wildcards
(`"pnpm *"`). `App.tsx` reads them at boot and stores in `policyOptionsRef` for
the same reason mode lives in a ref: the `onToolActivity` callback is registered
once and would otherwise capture the value from that first render.

---

## Bug found while testing

None — but the test design is worth noting. Every new policy branch (system
commands, permission changes, global installs, migrations) was tested with both a
positive case (the pattern triggers) and a negative case (a similar command that
must not trigger). The migration logic in particular had to defend against false
positives: `git reset` contains the token `reset`, which is a destructive
migration token, but git isn't in `MIGRATION_TOOLS` so the guard prevents a
mismatch. Without that negative test, the implementation would have been plausible
but wrong.

The allowlist precedence test explicitly checks that `pnpm publish` is blocked
even though it matches the `pnpm *` allowlist entry — the denylist must win.

---

## Tests

| File | Tests | Covers |
|---|---|---|
| `tests/permissions/blacklist.test.ts` | 19 | system commands, recursive permission changes (block/strong-confirm/allow paths), global installs, migrations (forward/destructive), allowlist/denylist precedence, wildcard matching, block override protection |
| `tests/tui/strong-confirm.test.ts` | 8 | exact match confirms, reject vocabulary, `y` is unknown, partial match unknown, whitespace trim, no-args and many-args commands |
| `tests/permissions/policy.test.ts` | +0 | (M6 baseline; still passes) |

Suite: 211 passed, 3 skipped, 0 failed (31 files), up from 174/3/0. The 3 skips
are the documented Windows capability gaps.

---

## Verification

```bash
npm run typecheck   # pass
npm run build       # pass
npm test            # 211 passed, 3 skipped, 0 failed
```

**Not verified:** no live model has been observed proposing a command that
triggers strong confirmation, so the formatted prompt and the TUI branch that
checks the retyped command are unproven in practice. The patterns themselves are
covered by unit tests but the end-to-end flow (model proposes `chmod -R 755 .` →
strong-confirm prompt → user retypes → runner executes) has never run against a
real model.

---

## Files changed

```
src/permissions/types.ts            strong-confirm tier, CommandPolicyOptions
src/permissions/policy.ts           13 pattern groups, allowlist/denylist
src/permissions/decide.ts           forward options, return strong-confirm
src/tui/command-confirmation.ts     getStrongConfirmationDecision,
                                    formatPendingStrongCommand
src/tui/App.tsx                     bundled pending state, policyOptionsRef,
                                    three proposal paths
src/config/schema.ts                allowlist, denylist
tests/permissions/blacklist.test.ts             new (19)
tests/tui/strong-confirm.test.ts                new (8)
docs/.../2026-08-06-gps-code-m6-session-permissions.md  correction note
```

---

## Corrected claims from M6

The M6 plan doc (2026-08-06) stated that `policy.ts` would block
`format/mkfs/dd/shutdown/reboot` and confirm `npm`/`pnpm` publish,
`chmod`/`chown`, and `curl`/`wget` with output redirects. The M6 commit (b3845f6)
shipped only three rules: file removal flags, and three git operations
(`push --force`, `reset --hard`, `clean -f`). The other patterns were documented
as "in scope" but never coded.

M9 filled the gap for system commands and permission changes. `npm`/`pnpm` publish
and `curl`/`wget` redirects remain out of scope — neither is dangerous enough to
block and neither is common enough from a model to justify the heuristic cost.

---

## Next

**Also outstanding**
- Extend `tests/acceptance/safe-edits.test.ts` to delete and rename (carried over
  from M8)
- Hand smoke-test of Ctrl-C cancellation (carried over from M7.5)
- Mode and policy persistence across sessions
- Multi-level undo
