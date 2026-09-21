import type { HistoricalSession, PublishAttempt, WorkspaceState } from './models';

export interface WorkspaceAnalytics {
  workspaceId: string;
  workspaceName: string;
  totalSessions: number;
  totalPosts: number;
  published: number;
  failed: number;
  skipped: number;
  successRate: number;
  averageAttempts: number;
  averageSessionDurationMs: number;
  mostActiveBank?: { bankId: string; name: string; activity: number };
  lastActivityAt?: number;
}

export interface SessionsOverTimePoint { date: string; sessions: number; }
export interface GlobalAnalytics {
  totalWorkspaces: number;
  totalPublished: number;
  totalFailures: number;
  sessionsOverTime: SessionsOverTimePoint[];
}

function terminalTotal(sessions: HistoricalSession[]): number { return sessions.reduce((sum, session) => sum + session.publishedCount + session.failedCount + session.skippedCount, 0); }
function rounded(value: number): number { return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0; }

export function calculateWorkspaceAnalytics(state: WorkspaceState): WorkspaceAnalytics {
  const sessions = state.historicalSessions ?? [];
  const attempts = state.history ?? [];
  const published = sessions.reduce((sum, session) => sum + session.publishedCount, 0);
  const failed = sessions.reduce((sum, session) => sum + session.failedCount, 0);
  const skipped = sessions.reduce((sum, session) => sum + session.skippedCount, 0);
  const durations = sessions.filter((session) => session.startedAt && session.completedAt && session.completedAt >= session.startedAt).map((session) => session.completedAt! - session.startedAt);
  const itemAttempts = new Map<string, number>();
  for (const attempt of attempts) {
    const key = `${attempt.sessionId ?? 'legacy'}:${attempt.queueItemId}`;
    itemAttempts.set(key, Math.max(itemAttempts.get(key) ?? 0, attempt.attemptNumber || 1));
  }
  const bankActivity = new Map<string, number>();
  for (const session of sessions) {
    if (session.bankId) bankActivity.set(session.bankId, (bankActivity.get(session.bankId) ?? 0) + session.publishedCount + session.failedCount + session.skippedCount);
  }
  for (const bank of state.banks) {
    if (!bankActivity.has(bank.id)) bankActivity.set(bank.id, state.queue.filter((item) => item.sourceBankId === bank.id).length);
  }
  const mostActiveEntry = [...bankActivity.entries()].sort((a, b) => b[1] - a[1])[0];
  const mostActiveBank = mostActiveEntry && mostActiveEntry[1] > 0 ? { bankId: mostActiveEntry[0], name: state.banks.find((bank) => bank.id === mostActiveEntry[0])?.name ?? mostActiveEntry[0], activity: mostActiveEntry[1] } : undefined;
  const lastActivityAt = [state.workspace.lastActivityAt, ...sessions.map((session) => session.updatedAt), ...attempts.map((attempt) => attempt.timestamp)].filter(Boolean).sort((a, b) => b - a)[0];
  const totalPosts = terminalTotal(sessions);
  return {
    workspaceId: state.workspaceId,
    workspaceName: state.workspace.name,
    totalSessions: sessions.length,
    totalPosts,
    published,
    failed,
    skipped,
    successRate: totalPosts ? rounded((published / totalPosts) * 100) : 0,
    averageAttempts: itemAttempts.size ? rounded([...itemAttempts.values()].reduce((sum, value) => sum + value, 0) / itemAttempts.size) : 0,
    averageSessionDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
    mostActiveBank,
    lastActivityAt,
  };
}

export function calculateGlobalAnalytics(states: WorkspaceState[], includeArchived = false): GlobalAnalytics {
  const selected = states.filter((state) => includeArchived || !state.workspace.archived);
  const workspaceAnalytics = selected.map(calculateWorkspaceAnalytics);
  const byDate = new Map<string, number>();
  for (const state of selected) for (const session of state.historicalSessions ?? []) {
    if (!session.startedAt) continue;
    const date = new Date(session.startedAt).toISOString().slice(0, 10);
    byDate.set(date, (byDate.get(date) ?? 0) + 1);
  }
  return {
    totalWorkspaces: selected.length,
    totalPublished: workspaceAnalytics.reduce((sum, value) => sum + value.published, 0),
    totalFailures: workspaceAnalytics.reduce((sum, value) => sum + value.failed, 0),
    sessionsOverTime: [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, sessions]) => ({ date, sessions })),
  };
}
