# X-Pilot Premium UI Redesign Plan

## Objective

Transform the Chrome Side Panel into a calm, information-dense publishing control center while preserving the existing Business Logic, runtime message contracts, storage behavior, automation safeguards, and all current features.

## Non-goals

This redesign will not change queue processing, publishing, Dry Run, Preflight, scheduling, publishing windows, Workspace ownership, backup/restore, diagnostics, analytics calculations, or service-worker behavior except where a purely presentational loading or feedback state is required.

## Architecture

The UI will be refactored into four presentation layers:

| Layer | Responsibility | Business logic policy |
|---|---|---|
| `ui/app` | Shell state, active view, global notice/toast, modal state | Reuse existing handlers and `RuntimeMessage` values |
| `ui/components` | Tokens-driven primitives such as Button, Icon, Badge, Card, Progress, Dialog, Toast, EmptyState, and Skeleton | Stateless where possible; no storage or automation logic |
| `ui/navigation` | Header, Workspace switcher, grouped navigation, responsive compact navigation | Calls existing workspace/tab callbacks only |
| `ui/views` | Operation, Startup Tests, Queue/Banks, Sessions, History, Analytics, Diagnostics, Workspaces, Settings | Receives existing state and callbacks; no new domain behavior |

The first implementation may keep the current view functions in `main.tsx` temporarily where extraction would create unnecessary risk. Components and view extraction will happen incrementally with contract tests after each move.

## Information Architecture

The nine existing destinations will be grouped into five product areas without removing or renaming any runtime capability:

- **Control:** Operation, Startup Tests.
- **Content:** Banks and Queue.
- **Activity:** Sessions and History.
- **Insights:** Analytics and Diagnostics.
- **Manage:** Workspaces and Settings.

A compact rail/section navigation will replace the crowded horizontal tab strip. The current `TabId` values remain unchanged so existing view routing and tests continue to work.

## Visual System

A single token system will define colors, spacing, radii, shadows, typography, focus rings, and transitions. Light and dark themes will use the same semantic tokens. The identity uses graphite, electric blue, cyan, cool off-white surfaces, and restrained green/amber/red status colors. Arabic typography uses Tajawal when available with safe system fallbacks.

## Interaction and accessibility

The redesign will add semantic buttons, visible focus states, keyboard-friendly navigation, `aria-current`, live status regions, non-color status labels, compact icon tooltips, responsive layouts from 320px through 600px, and reduced-motion support. Modal and confirmation work will replace `window.prompt` and `window.confirm` incrementally while preserving the original action callbacks.

## Delivery phases

1. **Foundation:** tokens, typography, base styles, icon component, Button/Badge/Card/Progress primitives, and app shell.
2. **Navigation and Control:** premium header, Workspace switcher, grouped navigation, Operation hero, current item, progress, countdown, and action hierarchy.
3. **Content and Activity:** compact Queue rows, sticky bulk actions, Bank cards, Diff review, Session cards, and History timeline.
4. **Insights and Manage:** Analytics, Diagnostics, Workspaces, and Settings sections with loading/empty/error states.
5. **Safety verification:** build, contract tests, full regression suite, responsive CSS checks, RTL review, and visual smoke review.

## Regression guardrails

- Keep all `RuntimeMessage` names and payloads unchanged.
- Do not modify service-worker or domain logic unless a compile-safe import is needed.
- Keep URLs visually truncated or domain-only; retain the original URL in actions and `dir="ltr"` fields.
- Keep Dry Run and Diagnostics explicitly read-only.
- Preserve `finally` cleanup and existing automation-tab behavior.
- Maintain versioned Git flow and release a UI-only version after tests pass.
