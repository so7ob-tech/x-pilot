# Changelog

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
