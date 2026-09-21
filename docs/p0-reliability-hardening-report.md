# P0 Reliability Hardening Report

## 1. P0-1 No Double Publish

### Root cause
Recovery treated every interrupted `PUBLISHING` item as safe to return to `PENDING`. That status did not preserve enough evidence to distinguish a failure before the Post action from a Service Worker termination after X may already have accepted the action.

### Design
The queue item now persists a publish intent identity and timestamps before `X_PUBLISH` is sent. Recovery treats any interrupted `PUBLISHING` item as `PUBLISHED_UNVERIFIED`. This state means that the publish command may have been accepted, but confirmation was lost. It is terminal for automatic processing and cannot be republished automatically. An explicit user Retry clears the quarantine markers.

### Files changed
`src/domain/models.ts`, `src/domain/data-integrity.ts`, `src/domain/recovery.ts`, and `src/background/service-worker.ts`.

### Tests
The integration harness simulates an interrupted publish with a persisted intent and verifies the recovered item is `PUBLISHED_UNVERIFIED` and rejected by `shouldNeverRepublish`. Existing restart and terminal-item tests were updated to enforce the conservative behavior.

### Result
**PASS.** Automatic recovery cannot send a second publish for an interrupted `PUBLISHING` item.

## 2. P0-2 Concurrent START

### Root cause
`claimAutomationOwner` allowed two START transitions for the same Workspace because both requests observed the same owner and proceeded. A Workspace owner check alone is not a transition lock.

### Design
START now acquires a persisted tokenized lock at `xPilot:lock:start`. Acquisition is serialized within the Service Worker, verifies the write by reading it back, rejects a live lock, and expires stale locks after a bounded TTL. START also rejects an existing active session before preflight and ownership mutation. The lock is released in `finally`.

### Files changed
`src/storage/storage-repository.ts`, `src/background/service-worker.ts`, and `src/domain/models.ts`.

### Tests
The integration harness uses a fake `chrome.storage.local` implementation and runs two concurrent `acquireStartLock` calls. Exactly one succeeds and the other receives `START_ALREADY_IN_FLIGHT`.

### Result
**PASS.** At most one active START transition is admitted by the persisted lock, and the existing global Automation Owner rule remains in force.

## 3. P0-3 Alarm Failure Recovery

### Root cause
The `chrome.alarms.onAlarm` listener ended with a silent catch. A failed `advanceSession` or scheduled-start handler could therefore consume the Alarm while leaving a `WAITING` or `SCHEDULED` session without a future trigger or visible failure.

### Design
Alarm execution is routed through an explicit handler. Failures are logged, persisted on the session, retried at the original future trigger up to three times, and then transition the session to `FAILED`, clear the Alarm, release ownership, and notify the user. The deterministic retry/terminal decision is implemented in `src/domain/alarm-recovery.ts` so it can be tested independently of browser APIs.

### Files changed
`src/domain/alarm-recovery.ts`, `src/background/service-worker.ts`, and `src/domain/models.ts`.

### Tests
The integration harness verifies that a `WAITING` failure produces a future next-item Alarm and that an exhausted `SCHEDULED` failure produces an explicit terminal decision.

### Result
**PASS.** Alarm failures are no longer silently discarded and retries are bounded.

## 4. P0-4 Transactional Restore

### Root cause
Restore removed the current canonical keys before writing the incoming backup. A failure between those operations could destroy the only valid copy.

### Design
Restore now follows **Stage → Verify → Commit**. The full target state is validated, written to transaction-scoped staging keys, read back for verification, and committed without deleting the current state first. The canonical commit is verified. If the commit fails, the captured previous canonical state is restored. Obsolete keys are removed only after successful commit. Orphaned staging keys are cleaned during startup and installation recovery.

Validation now rejects duplicate Workspace, Bank, and Queue identifiers, missing critical Workspace fields, broken Workspace ownership, and invalid Queue-to-Bank references.

### Files changed
`src/storage/storage-repository.ts`, `src/background/service-worker.ts`, `tests/backup-restore.test.mjs`, and `tests/p0-reliability.integration.test.mjs`.

### Tests
The integration harness covers duplicate-ID rejection, commit failure with preservation of the previous canonical state, successful staging cleanup, and orphan staging cleanup.

### Result
**PASS.** Restore failure cannot intentionally delete the previous valid state before a successful commit.

## 5. P0-5 Scheduled Restart Recovery

### Root cause
Startup recovery recreated a scheduled Alarm only when `scheduledStartAt` was still in the future. An overdue `SCHEDULED` session could remain indefinitely scheduled without a trigger.

### Design
Future `SCHEDULED` sessions remain scheduled and the startup path recreates their Alarm. An overdue session is moved to `PAUSED` with `SCHEDULED_START_MISSED_AFTER_RESTART`, clears its stale scheduling fields, and requires an explicit user Resume. This favors safety over an unverified automatic publish and cannot violate a Publishing Window.

### Files changed
`src/domain/recovery.ts`, `src/background/service-worker.ts`, and `tests/p0-reliability.integration.test.mjs`.

### Tests
The integration harness verifies both future scheduled preservation and overdue scheduled transition to `PAUSED`.

### Result
**PASS.** A `SCHEDULED` session cannot remain scheduled without a future trigger after restart.

## Invariants Proven

| Invariant | Test | Result |
|---|---|---|
| An interrupted `PUBLISHING` item is never automatically republished | P0-1 integration recovery test | PASS |
| Only one persisted START lock is admitted concurrently | P0-2 storage harness test | PASS |
| Alarm retry is bounded and terminal failure is explicit | P0-3 Alarm policy test | PASS |
| Restore validation rejects duplicate and broken references | P0-4 validation test | PASS |
| Restore commit failure preserves the previous canonical state | P0-4 transaction test | PASS |
| `WAITING` and `SCHEDULED` failures have a retry or terminal path | P0-3 handler design and policy test | PASS |
| Future `SCHEDULED` sessions retain a recoverable trigger | P0-5 recovery test | PASS |
| Overdue `SCHEDULED` sessions do not remain stuck | P0-5 recovery test | PASS |

## Data Migration Impact

No schema version change was required. All added fields are optional and backward-compatible. Existing records without publish markers are handled conservatively: an interrupted `PUBLISHING` status is treated as an unverified outcome. Existing schema version 4 data remains readable, and no legacy keys are removed as part of migration.

## Backward Compatibility

Existing `PENDING`, `PUBLISHED`, `PUBLISHED_UNVERIFIED`, `PAUSED`, `WAITING`, and `SCHEDULED` records continue to normalize. Manual Retry remains available and explicitly clears publish quarantine markers. Backup format versions 1 and 2 continue to be validated through the existing compatibility paths.

## Remaining Risks

The lock is persisted and verified, but `chrome.storage.local` does not provide a compare-and-swap primitive. The in-Service-Worker serialized acquisition closes the concurrent request race in the extension runtime, while the persisted TTL protects against Service Worker death. A real multi-process Chrome lifecycle test would still be valuable.

The browser lifecycle and live X adapter were not exercised in this sandbox. The P0 tests use deterministic Chrome API fakes and the domain recovery path.

## Runtime Verification Status

**NOT RUNTIME VERIFIED.** No live X publish was performed. No real Chrome Load Unpacked lifecycle test was claimed. The validation used the Node integration harness, the complete regression suite, and the production build.

## npm test

`150` tests passed, `0` failed.

## npm run build

Passed with TypeScript compilation and Vite production bundling.

## Branches

Implementation branch: `fix/p0-reliability-hardening`.

The planned release branch is `release/v0.25.8` after the fix branch is merged into `develop`.

## Commits

The implementation will be committed as the P0 reliability hardening fix and released as `v0.25.8` after the required Git-flow checks.

## Pull Request

The Pull Request URL will be recorded here after the fix branch is pushed and the PR is created.

## References

[1]: https://github.com/so7ob-tech/x-pilot "X-Pilot repository"
[2]: https://developer.chrome.com/docs/extensions/reference/api/storage "Chrome Storage API"
[3]: https://developer.chrome.com/docs/extensions/reference/api/alarms "Chrome Alarms API"
