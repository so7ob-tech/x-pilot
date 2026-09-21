import type { AutomationSessionRuntime, QueueItem, QueueItemStatus, WorkspaceState } from './models';

const queueStatuses: QueueItemStatus[] = ['PENDING', 'OPENING', 'READY', 'PUBLISHING', 'PUBLISHED', 'PUBLISHED_UNVERIFIED', 'FAILED', 'SKIPPED'];
const terminalStatuses = new Set<QueueItemStatus>(['PUBLISHED', 'PUBLISHED_UNVERIFIED', 'SKIPPED']);

export interface IntegrityIssue { code: string; path: string; message: string; severity: 'ERROR' | 'WARN'; }
export interface IntegrityReport { valid: boolean; issues: IntegrityIssue[]; }
export type AlarmDecision = 'EXECUTE' | 'IGNORE_STALE' | 'RECREATE_FUTURE' | 'PAUSE_SESSION';

export function isTerminalQueueItem(item: Pick<QueueItem, 'status'>): boolean { return terminalStatuses.has(item.status); }

export function normalizeQueueItem(input: Partial<QueueItem>, workspaceId: string, position: number, now = Date.now()): QueueItem | null {
  if (!input.id || input.targetUrl === undefined || input.targetUrl === null) return null;
  const status = queueStatuses.includes(input.status as QueueItemStatus) ? input.status as QueueItemStatus : 'PENDING';
  const attempts = Number.isInteger(input.attempts) && (input.attempts as number) >= 0 ? input.attempts as number : 0;
  return { id: input.id, workspaceId, sourceBankId: input.sourceBankId, sourceBankUrl: input.sourceBankUrl ?? '', targetUrl: input.targetUrl, label: input.label, position, status, attempts, createdAt: input.createdAt ?? now, updatedAt: input.updatedAt ?? now, startedAt: input.startedAt, publishedAt: input.publishedAt, lastError: input.lastError, operationId: isTerminalQueueItem({ status }) ? undefined : input.operationId, contentFingerprint: input.contentFingerprint, normalizedContent: input.normalizedContent, duplicateStatus: input.duplicateStatus, duplicateOfItemId: input.duplicateOfItemId };
}

export function normalizeWorkspaceState(input: Partial<WorkspaceState>, workspaceId: string, fallbackWorkspace: WorkspaceState['workspace'], now = Date.now()): WorkspaceState {
  const rawQueue = Array.isArray(input.queue) ? input.queue : [];
  const queue = rawQueue.map((item, index) => normalizeQueueItem(item, workspaceId, index + 1, now)).filter((item): item is QueueItem => Boolean(item));
  const banks = Array.isArray(input.banks) ? input.banks.filter((bank) => bank && bank.id && bank.workspaceId === workspaceId) : [];
  const historicalSessions = Array.isArray(input.historicalSessions) ? input.historicalSessions.filter((session) => session && session.id && session.workspaceId === workspaceId) : [];
  const history = Array.isArray(input.history) ? input.history.filter((attempt) => attempt && attempt.id && attempt.queueItemId) : [];
  return { workspaceId, workspace: input.workspace?.id === workspaceId ? input.workspace : fallbackWorkspace, banks, queue, session: input.session?.workspaceId && input.session.workspaceId !== workspaceId ? null : input.session ?? null, history, historicalSessions };
}

export function validateWorkspaceIntegrity(state: WorkspaceState): IntegrityReport {
  const issues: IntegrityIssue[] = [];
  if (!state.workspace || state.workspace.id !== state.workspaceId) issues.push({ code: 'WORKSPACE_ID_MISMATCH', path: 'workspace.id', message: 'Workspace id must match the storage partition.', severity: 'ERROR' });
  const bankIds = new Set(state.banks.map((bank) => bank.id));
  const queueIds = new Set<string>();
  for (const item of state.queue) {
    if (queueIds.has(item.id)) issues.push({ code: 'DUPLICATE_QUEUE_ID', path: `queue.${item.id}`, message: 'Queue item id is duplicated.', severity: 'ERROR' });
    queueIds.add(item.id);
    if (item.status === 'PUBLISHED' || item.status === 'PUBLISHED_UNVERIFIED') {
      if (!item.publishedAt) issues.push({ code: 'PUBLISHED_WITHOUT_TIMESTAMP', path: `queue.${item.id}`, message: 'Published item has no publishedAt timestamp.', severity: 'WARN' });
    }
    if (item.sourceBankId && !bankIds.has(item.sourceBankId)) issues.push({ code: 'MISSING_BANK_REFERENCE', path: `queue.${item.id}.sourceBankId`, message: 'Queue item references a missing Bank; history remains preserved.', severity: 'WARN' });
  }
  for (const attempt of state.history) if (!queueIds.has(attempt.queueItemId)) issues.push({ code: 'ORPHAN_ATTEMPT', path: `history.${attempt.id}`, message: 'Publish attempt has no current Queue item; retain it as immutable history.', severity: 'WARN' });
  for (const session of state.historicalSessions ?? []) if (session.workspaceId !== state.workspaceId) issues.push({ code: 'SESSION_WORKSPACE_MISMATCH', path: `sessions.${session.id}`, message: 'Historical Session belongs to another Workspace.', severity: 'ERROR' });
  return { valid: !issues.some((issue) => issue.severity === 'ERROR'), issues };
}

export function classifyAlarm(runtime: AutomationSessionRuntime | null | undefined, alarmName: string, now = Date.now()): AlarmDecision {
  if (!runtime) return 'IGNORE_STALE';
  if (runtime.alarmName && runtime.alarmName !== alarmName) return 'IGNORE_STALE';
  if (runtime.status === 'WAITING' && runtime.nextRunAt && runtime.nextRunAt > now) return 'RECREATE_FUTURE';
  if (runtime.status !== 'WAITING' && runtime.status !== 'SCHEDULED') return 'IGNORE_STALE';
  return 'EXECUTE';
}

export function shouldNeverRepublish(item: Pick<QueueItem, 'status' | 'publishedAt' | 'contentFingerprint'>): boolean {
  return isTerminalQueueItem(item) || Boolean(item.publishedAt);
}
