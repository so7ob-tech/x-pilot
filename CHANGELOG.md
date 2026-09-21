# Changelog

## [0.13.1] - Patch

### Fixed

- Dry Run results now show only the Queue item number, status, and first ten words; raw target URLs are no longer rendered.
- Scheduled Sessions now create a runnable session when Queue had no prior session and report a clear failure when no item is runnable at Alarm time.
- Scheduled Alarm handling now reschedules early alarms and persists observable failure state instead of silently returning.

## [0.13.0] - Unreleased

### Added

- Scheduled Sessions with persistent Chrome Alarm scheduling, rescheduling, cancellation, and startup recovery.
- Workspace Publishing Windows with weekday rules, multiple windows, overnight support, and explicit time zones.
- Workspace Automation Profiles inheriting from Global Defaults.
- Opt-in Chrome Notifications for important session events without per-success noise.
- Chrome Badge modes for remaining count, status, or no Badge.

## [0.12.0] - Unreleased

### Added

- Full local JSON Backup / Restore for all Workspaces, Tweet Banks, Queue items, Sessions, Session History, Publish Attempts, and settings.
- Pre-restore validation for format, schema, workspace ordering, bank references, Queue references, and active automation protection.
- Confirmation summary before replacing local data.
- Excludes transient Automation Tab and operation state from backups.

## [0.11.0] - Unreleased

### Added

- Dry Run / Test Mode for one item or the entire Queue.
- Sequential reuse of one automation tab for inspection.
- Structured results for login, content, Composer, Post button, invalid URL, challenge, and error states.
- Strict no-publish boundary: Dry Run never sends `X_PUBLISH`, changes Queue status, increments attempts, or creates publish history.

## [0.10.0] - Unreleased

### Added

- Preflight Check before Queue Start.
- Structured PASS/WARN/FAIL readiness report for Workspace, Queue, Banks, X Adapter, permissions, alarms, duplicates, retry configuration, and interval.
- Blocking Start guard for invalid Queue, X login/challenge, duplicate policy violations, missing permissions, and conflicting automation ownership.
- Dashboard readiness counts and actionable diagnostic details.

## [0.9.0] - Unreleased

### Added

- SHA-256 Content Fingerprint generation from supported tweet intent URLs.
- Normalized-content duplicate detection across Tweet Banks and Workspaces.
- Duplicate policies: Block, Warn, and Allow.
- Refresh & Diff warnings for queued duplicates and previously published content.
- Published duplicates are excluded from the default selection and blocked by the default policy.

## [0.8.0] - Unreleased

### Added

- Adds non-destructive Tweet Bank Refresh and Diff.
- Classifies refreshed links as New, Existing, Previously Published, Removed, or Invalid.
- Adds a review panel with selectable New items before Queue insertion.
- Prevents published items from being re-added automatically.
- Persists the latest Bank snapshot for future comparisons.

## [0.7.0] - Unreleased

### Added

- Adds independent Tweet Bank management inside each Workspace.
- Adds Bank creation, archive, restore, deletion protection, and metadata cards.
- Adds Bank-aware extraction and `sourceBankId` provenance on Queue items.
- Adds per-Bank Pending and Published counters while preserving Replace and Append modes.
- Normalizes legacy schema v3 Bank records with default favorite and archive fields.

## [0.6.0] - Unreleased

### Added

- Adds independent historical Automation Session records per Workspace.
- Adds a local Session History tab with status and result counters.
- Migrates Workspace storage from schema v2 to schema v3 while preserving existing Queue and attempts.
- Links runtime publish attempts and terminal session states to the historical session record.

## [0.5.1] - Unreleased

### Fixed

- Adds a visible Restore action for archived Workspaces.
- Adds explicit Replace and Append choices when extracting a Tweet Bank.
- Prevents replacing an active Queue or a Queue containing executed items without a guarded decision.
- Deduplicates appended links by target URL and preserves existing Queue items.

## [0.5.0] - Unreleased

### Added

- Adds real Workspace entities with independent Queue, Banks, Sessions, and History.
- Adds persisted active Workspace selection and a compact Workspace management tab.
- Adds schema version 2 migration from `xQueueState` and `xQueueSettings`.
- Adds a single global automation owner to prevent parallel Workspace sessions.
- Makes background state reads and writes use the persisted automation owner instead of the active UI Workspace.

## [0.4.1] - Unreleased

### Added

- Adds live connection and engine-activity indicators to the tab bar.
- Detects manually closed automation tabs and reports a disconnected state.
- Adds an accessible warning when the engine is active without a connected automation tab.

## [0.4.0] - Unreleased

### Added

- Splits the Side Panel into Operation, Tweet Bank, and Settings tabs.
- Adds a dashboard with current-tweet information, status, preview, attempts, and direct link.
- Keeps the Queue and bank extraction tools together in their dedicated tab.
- Preserves the branded Recovery card in the Operation tab.

## [0.3.7] - Unreleased

### Added

- Adds the official transparent X-Pilot logo to Chrome extension icons and the Side Panel.
- Adds branded Settings and Recovery surfaces.
- Documents the branding assets and includes the logo in the project README.

## [0.3.6] - Unreleased

### Fixed

- Applies automation-tab retention settings on Stop, completion, and final failure.
- Clears stale `automationTabId` state when the automation tab is manually removed.
- Prevents late automation errors from overwriting sessions already paused or stopped.
- Keeps the automation tab available during WAITING and PAUSED states when configured.

## [0.3.5] - Unreleased

### Fixed

- Prevents repeated Content Script injection per tab and removes injection state when tabs navigate or close.
- Adds a page-level guard so duplicate Content Script executions cannot register duplicate runtime listeners.
- Guarantees temporary bank-tab removal in `finally`, including extraction and scripting failures.

## [0.3.4] - Unreleased

### Fixed

- Opens the X target in the background first and activates the automation tab only after navigation completes.
- Gives X a short foreground-rendering window before readiness polling.
- Preserves restoration of the user's previous tab after the operation.

## [0.3.3] - Unreleased

### Fixed

- Activates the automation tab before waiting for X's dynamically rendered composer and publish controls.
- Handles tabs that are already complete without waiting indefinitely for a missed update event.
- Restores the user's previously active tab after publish, failure, or interruption.

## [0.3.2] - Unreleased

### Fixed

- Broadens X publish-control detection across button, role, data-testid, aria-label, title, and nested text variants.
- Normalizes Arabic whitespace, tatweel, and diacritics.
- Rejects hidden, disabled, reply, Add Post, and Post All controls before clicking.
- Adds regression coverage for localized publish labels.

## [0.3.1] - Unreleased

### Fixed

- Failed attempts now enter `WAITING` with a persisted Alarm for the next retry.
- The Queue persists the next item before waiting after a successful publish.
- The alarm handler prefers the persisted current item and no longer depends on recursive retry calls.
- Exhausted failures with Continue advance to the next item; exhausted failures with Pause remain paused.

## [0.3.0] - Unreleased

### Added

- Added persisted Queue recovery on browser startup and extension installation.
- Interrupted items are normalized back to `PENDING` without being marked published.
- Future waiting alarms are recreated idempotently from `nextRunAt`.
- Expired active sessions become `PAUSED` and require explicit Resume.
- Paused sessions remain paused across restart and published items are protected.

## [0.2.0] - Unreleased

### Added

- Added persisted Pause and Resume controls for Queue automation.
- Pause clears active alarms without advancing the current item.
- Resume continues the current eligible item or recreates a waiting alarm.
- Added state-machine and service-worker contract coverage for the lifecycle.

## [0.1.6] - 2026-09-20

### Fixed

- Detects Arabic X composer and publish controls, including `نص المنشور` and `نشر`.
- Avoids confusing `إضافة منشور` and `نشر الكل` thread controls with the single-post action.
- Schedules the next queue item after an exhausted failure and restarts its persisted countdown.

## [0.1.5] - 2026-09-20

### Added

- Queue rows now show a concise preview decoded from the tweet intent URL instead of the long URL.
- Queue actions remain visible with fixed-width controls on narrow Side Panels.
- Added a seconds countdown derived from the persisted `nextRunAt` timestamp.
- Added preview and Unicode truncation tests.

## [0.1.4] - 2026-09-20

### Fixed

- Polls for the X composer and enabled Post button for a bounded period before failing.
- Adds additional stable accessibility and test-id strategies for X publish controls.
- Advances to the next pending item after retries are exhausted when failure behavior is Continue.
- Marks the session Completed when the exhausted failure was the last remaining item.

## [0.1.3] - 2026-09-20

### Changed

- Renamed the Chrome extension display name and package identity to X-Pilot.
- Renamed the GitHub repository to `x-pilot`.

## [0.1.2] - 2026-09-20

### Release

- Formalized the extraction fix through the issue, feature branch, pull request, integration branches, release tag, and GitHub release workflow.

## [0.1.1] - 2026-09-20

### Fixed

- Bank extraction now reads X/Twitter intent URLs embedded in raw Google Sites markup, including HTML-encoded query parameters.
- The UI reports the actual number of extracted links instead of reporting success when the Queue is empty.
- Added parser tests for encoded links, duplicates, and unrelated page links.

## [0.1.0] - 2026-09-20

### Added

- Initial Manifest V3 scaffold with React, TypeScript, Vite, Side Panel, Service Worker, and Content Script.
- Local queue model for X/Twitter composer URLs.
- Local storage repository, initial state machine, alarm scheduling, retry state, and attempt history.
- Safe X provider inspection that refuses to click when the page, composer, content, or enabled post button cannot be verified.
- Dynamic request for the specific external bank host permission when the user presses extraction.

### Known limitations

- The first scaffold does not yet include the complete restart recovery dialog, Refresh Bank diff view, or import/export UI.
- X selectors are best-effort and require maintenance when the site UI changes.
