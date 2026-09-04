# MERGE-GATES-20260904

## branch
- worktree -> `.gaia/worktrees/dario-mtn806jytj7ofm`
- branch -> `merge/upstream-20260904-dario-mtn806jytj7ofm`
- head -> `37d7451 Fix post-merge gates`

## checks
- `bun run check` -> PASS
  - `tsc -p tsconfig.json --noEmit` -> PASS
  - `tsc -p web/tsconfig.json` -> PASS
  - `tsc -p src/server/graphql.tsconfig.json --noEmit` -> PASS
  - `knip --no-exit-code` -> advisory only

## required/touched tests run individually
- `bun test test/room-service.test.ts` -> PASS 98/98
- `bun test test/account-login.test.ts` -> PASS 20/20
- `bun test test/claude-runtime.test.ts` -> PASS 50/50
- `bun test test/pi-runtime.test.ts` -> PASS 39/39
- `bun test test/transcribe.test.ts` -> PASS 22/22
- `bun test test/accounts.test.ts` -> PASS 5/5
- `bun test test/hints.test.ts` -> PASS 3/3
- `bun test test/rooms.test.ts` -> PASS 53/53
- `bun test test/http-routes.test.ts` -> PASS 7/7
- `bun test test/users.test.ts` -> PASS 13/13
- `bun test test/auth-adversarial.test.ts` -> PASS 4/4
- `bun test test/room-membership-security.test.ts` -> PASS 3/3
- `bun test test/memory-service.test.ts` -> PASS 21/21
- `bun test test/design-canvas-style-bridge.test.ts` -> SKIP source-only design fixtures absent
- `bun test test/artifact-card.test.ts` -> PASS local 1/1 + SKIP source-only design fixture
- `bun test test/artifact-revisions.test.ts` -> SKIP source-only design fixture
- `bun test test/artifacts-adversarial.test.ts` -> SKIP source-only design fixture
- touched-test sweep -> run one file at a time; initial failures fixed except design source fixtures now guarded

## landing blocker
- root status -> untracked `server-8790.pid`
- root ff-only merge -> NOT RUN
- reason -> root porcelain not clean; root checkout merge-only law

## design trap
- check mode -> `design` symlink to root design
- commit mode -> `design` empty dir restored before commits
