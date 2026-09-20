# Architecture Plan

The implementation follows the approved architecture in the project-level plan: a local-first Manifest V3 extension with a React Side Panel, a short-lived Service Worker, persistent state in `chrome.storage.local`, one reusable automation tab, `chrome.alarms` for future execution, a Content Script for DOM inspection, and an isolated `XProviderAdapter` for provider-specific selectors.

## Development sequence

1. Stabilize domain models, storage schema, migrations, and state transitions.
2. Add parser and queue behavior with unit tests.
3. Add alarm persistence and restart recovery tests.
4. Add provider fixtures and safe inspection tests.
5. Integrate the automation engine with tab lifecycle, locking, retry, and outcome verification.
6. Complete UI operations, export/import, Refresh Bank, and recovery dialogs.
7. Run build, test, manual Load Unpacked checks, and release review before merging to `develop`.

## Safety invariants

- No credentials, Cookies, or tokens are collected.
- Login pages, CAPTCHA, and security challenges pause or fail safely.
- No click occurs without a verified X page, composer, non-empty content, enabled post button, and active item lock.
- The countdown is derived from the persisted `nextRunAt` timestamp; it is never the scheduler source of truth.
- Published items are not re-queued by refresh or browser restart.
