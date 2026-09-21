import type { HistoricalSession, PublishAttempt, QueueItem, TweetBank, WorkspaceState } from './models';

export type SearchStatus = 'ALL' | 'PENDING' | 'PUBLISHED' | 'FAILED' | 'SKIPPED';

export interface SearchFilters {
  query: string;
  status: SearchStatus;
  bankId: string;
  sessionId: string;
  workspaceId: string;
  dateFrom: string;
  dateTo: string;
}

export const emptySearchFilters: SearchFilters = {
  query: '', status: 'ALL', bankId: '', sessionId: '', workspaceId: '', dateFrom: '', dateTo: ''
};

function normalized(value: unknown): string { return String(value ?? '').toLocaleLowerCase().trim(); }
function statusMatches(status: SearchStatus, value: string): boolean {
  if (status === 'ALL') return true;
  if (status === 'PUBLISHED') return value === 'PUBLISHED' || value === 'PUBLISHED_UNVERIFIED' || value === 'COMPLETED';
  return value === status;
}
function dateMatches(timestamp: number | undefined, filters: SearchFilters): boolean {
  if (!filters.dateFrom && !filters.dateTo) return true;
  if (!timestamp) return false;
  const from = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`).getTime() : -Infinity;
  const to = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999`).getTime() : Infinity;
  return timestamp >= from && timestamp <= to;
}
function queryMatches(query: string, values: unknown[]): boolean {
  const term = normalized(query);
  return !term || values.some((value) => normalized(value).includes(term));
}

export function workspaceScopeMatches(filters: SearchFilters, workspaceId: string | undefined, activeWorkspaceId = ''): boolean {
  if (filters.workspaceId === '*') return true;
  if (filters.workspaceId) return workspaceId === filters.workspaceId;
  // Empty is only tolerated before async initialisation in pure callers; the UI
  // initialises it to meta.activeWorkspaceId before displaying a view.
  return !activeWorkspaceId || workspaceId === activeWorkspaceId;
}

export function filterQueue(items: QueueItem[], filters: SearchFilters, banks: TweetBank[] = [], activeWorkspaceId = ''): QueueItem[] {
  const bankNames = new Map(banks.map((bank) => [bank.id, bank.name]));
  return items.filter((item) => workspaceScopeMatches(filters, item.workspaceId, activeWorkspaceId) && statusMatches(filters.status, item.status) && (!filters.bankId || filters.bankId === '*' || item.sourceBankId === filters.bankId) && dateMatches(item.updatedAt || item.createdAt, filters) && queryMatches(filters.query, [item.id, item.position, item.label, item.targetUrl, item.sourceBankUrl, bankNames.get(item.sourceBankId ?? '')]));
}

export function filterBanks(banks: TweetBank[], filters: SearchFilters, activeWorkspaceId = ''): TweetBank[] {
  return banks.filter((bank) => workspaceScopeMatches(filters, bank.workspaceId, activeWorkspaceId) && dateMatches(bank.updatedAt, filters) && queryMatches(filters.query, [bank.id, bank.name, bank.description, bank.url]));
}

export function filterSessions(sessions: HistoricalSession[], filters: SearchFilters, activeWorkspaceId = ''): HistoricalSession[] {
  return sessions.filter((session) => workspaceScopeMatches(filters, session.workspaceId, activeWorkspaceId) && (!filters.sessionId || filters.sessionId === '*' || session.id === filters.sessionId) && statusMatches(filters.status, session.status) && dateMatches(session.updatedAt || session.createdAt, filters) && queryMatches(filters.query, [session.id, session.workspaceId, session.status]));
}

export function filterHistory(history: PublishAttempt[], filters: SearchFilters, activeWorkspaceId = ''): PublishAttempt[] {
  return history.filter((attempt) => workspaceScopeMatches(filters, attempt.workspaceId, activeWorkspaceId) && (!filters.sessionId || filters.sessionId === '*' || attempt.sessionId === filters.sessionId) && statusMatches(filters.status, attempt.result) && dateMatches(attempt.timestamp, filters) && queryMatches(filters.query, [attempt.id, attempt.queueItemId, attempt.link, attempt.action, attempt.result, attempt.error]));
}

export function workspaceStatesToSearchData(states: WorkspaceState[], includeArchived = false) {
  const visible = states.filter((state) => includeArchived || !state.workspace.archived);
  return {
    queue: visible.flatMap((state) => state.queue.map((item) => ({ ...item, workspaceId: item.workspaceId ?? state.workspaceId }))),
    banks: visible.flatMap((state) => state.banks),
    sessions: visible.flatMap((state) => state.historicalSessions),
    history: visible.flatMap((state) => state.history.map((attempt) => ({ ...attempt, workspaceId: attempt.workspaceId ?? state.workspaceId }))),
  };
}
