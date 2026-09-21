# Workspaces

## Overview

X-Pilot treats a **Workspace** as the top-level local container for one project. Each Workspace owns its Queue, Tweet Banks, automation session, publish attempts, and activity data. Switching the active Workspace changes the data shown by the Side Panel without replacing or mixing the data of another Workspace.

## Data model

The `Workspace` entity stores identity and lifecycle metadata such as name, description, favorite, archived, and activity timestamps. `WorkspaceState` contains the Workspace metadata together with its Queue, `TweetBank` records, `AutomationSession`, and `PublishAttempt` history. Queue items, sessions, and attempts carry a `workspaceId` so background operations can verify ownership explicitly.

`xPilotMeta` stores the schema version, active Workspace, Workspace ordering, global settings, and the single `automationWorkspaceId`. Workspace payloads are stored separately under `xPilotWorkspace:<id>` so changing one Workspace does not rewrite the complete application state. Each Workspace may contain multiple independent `TweetBank` records. Queue items retain both `sourceBankId` and the legacy `sourceBankUrl` so provenance remains visible and older data remains readable.

## Migration

The first Workspace schema is version 2. On first startup, if no valid v2 metadata exists, X-Pilot reads the legacy `xQueueState` and `xQueueSettings` keys and creates **مساحة العمل الافتراضية**. Queue items, the existing session, history, and settings are copied into that Workspace. The legacy keys are intentionally retained until a later explicit cleanup policy is introduced. The migration writes the new Workspace payload and metadata together and is idempotent on subsequent starts.

If no legacy data exists, an empty default Workspace is created. The application always maintains at least one Workspace, preventing an invalid no-Workspace UI state.

## Active and running Workspaces

`activeWorkspaceId` is a UI selection persisted in `xPilotMeta`. It controls what the Side Panel displays. It is not used as the source of truth for background automation.

The automation runtime has one owner, stored as `automationWorkspaceId`. Starting a Queue claims that owner. A second Workspace cannot start while another Workspace owns the runtime. Users may switch to another Workspace to inspect or edit its non-running data; a persistent indicator links back to the running Workspace.

## Alarm and recovery ownership

The current Service Worker keeps the existing alarm and tab lifecycle behavior while routing background reads and writes through the persisted automation owner. Before publishing, the runtime validates the current session, Queue item, operation ID, and Workspace-owned state. Completion and Stop release the owner. Recovery continues to normalize interrupted sessions and reconstruct the owner state before resuming an alarm.

A later hardening phase should encode Workspace and Session identities directly into alarm names. The current owner verification prevents an alarm from using the active UI Workspace as an implicit replacement, while preserving the existing alarm behavior with minimal breaking change.

## Workspace operations

The Workspaces tab provides a compact switcher and cards for opening, creating, archiving, and deleting Workspaces. The Queue tab provides Bank cards for creating, selecting, extracting, refreshing, archiving, restoring, and deleting Tweet Banks. Refresh stores a lightweight snapshot and presents a non-destructive Diff review. New items can be selected explicitly before they are merged into Queue; existing, previously published, removed, and invalid items are informational and are not added automatically. Archiving preserves all data and removes the Workspace or Bank from the default active selector. Deletion requires explicit confirmation, cannot delete the last Workspace, and cannot delete a running Workspace or Bank.

## Privacy and permissions

Workspaces remain local-first. Names, Bank URLs, Queue items, sessions, and history are not sent to a backend. The feature does not add Chrome permissions; it uses the existing storage, tabs, alarms, scripting, and Side Panel permissions.

## Current limitations

The initial Workspace release uses global automation settings for all Workspaces, with session settings copied at extraction/start time. Replace-versus-append extraction is planned as a follow-up because the current extraction path retains the established Queue replacement behavior. History remains the existing bounded attempts list, now scoped to the Workspace state. Alarm names remain compatible with the current release and are protected by persisted owner verification.
