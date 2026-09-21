import type { HistoricalSession, PublishAttempt, QueueItem, Settings, TweetBank, WorkspaceState } from './models';

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

export const emptySearchFilters: SearchFilters = { query: '', status: 'ALL', bankId: '', sessionId: '', workspaceId: '', dateFrom: '', dateTo: '' };

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

export function filterQueue(items: QueueItem[], filters: SearchFilters, banks: TweetBank[] = []): QueueItem[] {
  const bankNames = new Map(banks.map((bank) => [bank.id, bank.name]));
  return items.filter((item) => (!filters.workspaceId || filters.workspaceId === '*' || item.workspaceId === filters.workspaceId) && statusMatches(filters.status, item.status) && (!filters.bankId || filters.bankId === '*' || item.sourceBankId === filters.bankId) && dateMatches(item.updatedAt || item.createdAt, filters) && queryMatches(filters.query, [item.id, item.position, item.label, item.targetUrl, item.sourceBankUrl, bankNames.get(item.sourceBankId ?? '')]));
}

export function filterBanks(banks: TweetBank[], filters: SearchFilters): TweetBank[] {
  return banks.filter((bank) => (!filters.workspaceId || filters.workspaceId === '*' || bank.workspaceId === filters.workspaceId) && dateMatches(bank.updatedAt, filters) && queryMatches(filters.query, [bank.id, bank.name, bank.description, bank.url]));
}

export function filterSessions(sessions: HistoricalSession[], filters: SearchFilters): HistoricalSession[] {
  return sessions.filter((session) => (!filters.workspaceId || filters.workspaceId === '*' || session.workspaceId === filters.workspaceId) && (!filters.sessionId || filters.sessionId === '*' || session.id === filters.sessionId) && statusMatches(filters.status, session.status) && dateMatches(session.updatedAt || session.createdAt, filters) && queryMatches(filters.query, [session.id, session.workspaceId, session.status]));
}

export function filterHistory(history: PublishAttempt[], filters: SearchFilters): PublishAttempt[] {
  return history.filter((attempt) => (!filters.workspaceId || filters.workspaceId === '*' || attempt.workspaceId === filters.workspaceId) && (!filters.sessionId || filters.sessionId === '*' || attempt.sessionId === filters.sessionId) && statusMatches(filters.status, attempt.result) && dateMatches(attempt.timestamp, filters) && queryMatches(filters.query, [attempt.id, attempt.queueItemId, attempt.link, attempt.action, attempt.result, attempt.error]));
}

export function workspaceStatesToSearchData(states: WorkspaceState[]) {
  return {
    queue: states.flatMap((state) => state.queue.map((item) => ({ ...item, workspaceId: item.workspaceId ?? state.workspaceId }))),
    banks: states.flatMap((state) => state.banks),
    sessions: states.flatMap((state) => state.historicalSessions),
    history: states.flatMap((state) => state.history.map((attempt) => ({ ...attempt, workspaceId: attempt.workspaceId ?? state.workspaceId }))),
  };
}
