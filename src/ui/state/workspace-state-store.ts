import type { AppMetaState, WorkspaceState } from '../../domain/models';

export interface WorkspaceStateCache {
  byId: Record<string, WorkspaceState>;
  revision: number;
  activeWorkspaceId: string;
}

export function createWorkspaceStateCache(states: WorkspaceState[] = [], meta?: AppMetaState): WorkspaceStateCache {
  return {
    byId: Object.fromEntries(states.map((state) => [state.workspaceId, state])),
    revision: 0,
    activeWorkspaceId: meta?.activeWorkspaceId ?? states[0]?.workspaceId ?? '',
  };
}

export function listCachedWorkspaceStates(cache: WorkspaceStateCache, includeArchived = true): WorkspaceState[] {
  return Object.values(cache.byId).filter((state) => includeArchived || !state.workspace.archived);
}

export function getCachedWorkspaceState(cache: WorkspaceStateCache, workspaceId = cache.activeWorkspaceId): WorkspaceState | undefined {
  return cache.byId[workspaceId];
}

export function replaceWorkspaceStates(cache: WorkspaceStateCache, states: WorkspaceState[], meta?: AppMetaState): WorkspaceStateCache {
  const nextRevision = cache.revision + 1;
  return {
    byId: Object.fromEntries(states.map((state) => [state.workspaceId, state])),
    revision: nextRevision,
    activeWorkspaceId: meta?.activeWorkspaceId ?? cache.activeWorkspaceId,
  };
}

export function reconcileWorkspaceState(cache: WorkspaceStateCache, state: WorkspaceState, revision?: number): WorkspaceStateCache {
  if (revision !== undefined && revision < cache.revision) return cache;
  return {
    byId: { ...cache.byId, [state.workspaceId]: state },
    revision: revision ?? cache.revision + 1,
    activeWorkspaceId: cache.activeWorkspaceId,
  };
}

export function removeWorkspaceState(cache: WorkspaceStateCache, workspaceId: string, revision?: number): WorkspaceStateCache {
  if (revision !== undefined && revision < cache.revision) return cache;
  const { [workspaceId]: _removed, ...remaining } = cache.byId;
  return { byId: remaining, revision: revision ?? cache.revision + 1, activeWorkspaceId: cache.activeWorkspaceId === workspaceId ? '' : cache.activeWorkspaceId };
}

export function setActiveWorkspaceInCache(cache: WorkspaceStateCache, activeWorkspaceId: string): WorkspaceStateCache {
  return { ...cache, activeWorkspaceId };
}

export function isNewerRequest(requestId: number, latestRequestId: number): boolean {
  return requestId >= latestRequestId;
}
