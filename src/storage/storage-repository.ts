import type { AppMetaState, AppState, AutomationSession, HistoricalSession, PublishAttempt, QueueItem, Settings, TweetBank, Workspace, WorkspaceState } from '../domain/models';

const defaultSettings: Settings = { intervalMinutes: 2, maxRetries: 2, failureBehavior: 'CONTINUE', confirmBeforeStart: true, keepAutomationTabOpen: true, closeTabOnComplete: false };

export const LEGACY_STATE_KEY = 'xQueueState';
export const LEGACY_SETTINGS_KEY = 'xQueueSettings';
export const META_KEY = 'xPilotMeta';
export const WORKSPACE_KEY_PREFIX = 'xPilotWorkspace:';

const emptyState = (workspaceId?: string): AppState => ({ workspaceId, queue: [], session: null, history: [] });
const workspaceKey = (workspaceId: string) => `${WORKSPACE_KEY_PREFIX}${workspaceId}`;

function createWorkspaceRecord(name: string, description = '', color?: string, icon?: string): Workspace {
  const now = Date.now();
  return { id: crypto.randomUUID(), name, description, color, icon, favorite: false, archived: false, createdAt: now, updatedAt: now, lastActivityAt: now };
}

function createWorkspaceState(workspace: Workspace, settings: Settings, seed: Partial<AppState> & { historicalSessions?: HistoricalSession[] } = {}, banks: TweetBank[] = []): WorkspaceState {
  const queue = (seed.queue ?? []).map((item) => ({ ...item, workspaceId: workspace.id }));
  const session = seed.session ? { ...seed.session, workspaceId: workspace.id } : null;
  const history = (seed.history ?? []).map((attempt) => ({ ...attempt, workspaceId: workspace.id }));
  return { workspaceId: workspace.id, workspace, banks, queue, session: session ? { ...session, ...settings } : null, history, historicalSessions: seed.historicalSessions ?? [] };
}

async function readMeta(): Promise<AppMetaState | undefined> {
  const result = await chrome.storage.local.get(META_KEY);
  return result[META_KEY] as AppMetaState | undefined;
}

async function migrateIfNeeded(): Promise<AppMetaState> {
  const existing = await readMeta();
  if (existing?.schemaVersion === 3) {
    const keys = existing.workspaceOrder.map(workspaceKey);
    const stored = await chrome.storage.local.get(keys);
    const current = stored[workspaceKey(existing.activeWorkspaceId)] as WorkspaceState | undefined;
    if (current && !current.workspace.archived) return existing;
    const replacement = existing.workspaceOrder
      .map((id) => stored[workspaceKey(id)] as WorkspaceState | undefined)
      .find((state) => state && !state.workspace.archived);
    if (replacement) {
      const repaired = { ...existing, activeWorkspaceId: replacement.workspaceId };
      await chrome.storage.local.set({ [META_KEY]: repaired });
      return repaired;
    }
  }

  if (existing?.schemaVersion === 2) {
    const keys = existing.workspaceOrder.map(workspaceKey);
    const stored = await chrome.storage.local.get(keys);
    const upgraded = { ...existing, schemaVersion: 3 as const };
    const updates: Record<string, WorkspaceState> = {};
    for (const id of existing.workspaceOrder) {
      const state = stored[workspaceKey(id)] as WorkspaceState | undefined;
      if (state) updates[workspaceKey(id)] = { ...state, historicalSessions: state.historicalSessions ?? [] };
    }
    await chrome.storage.local.set({ ...updates, [META_KEY]: upgraded });
    return upgraded;
  }

  const legacy = await chrome.storage.local.get([LEGACY_STATE_KEY, LEGACY_SETTINGS_KEY]);
  const legacyState = legacy[LEGACY_STATE_KEY] as Partial<AppState> | undefined;
  const settings: Settings = { ...defaultSettings, ...(legacy[LEGACY_SETTINGS_KEY] as Partial<Settings> | undefined) };
  const workspace = createWorkspaceRecord('مساحة العمل الافتراضية', 'تم ترحيلها تلقائيًا من بيانات X-Pilot السابقة');
  const banks: TweetBank[] = [];
  if (legacyState?.session?.bankUrl) {
    banks.push({ id: crypto.randomUUID(), workspaceId: workspace.id, name: 'البنك المرحّل', url: legacyState.session.bankUrl, createdAt: Date.now(), updatedAt: Date.now() });
  }
  const migrated = createWorkspaceState(workspace, settings, legacyState ?? {}, banks);
  const meta: AppMetaState = { schemaVersion: 3, activeWorkspaceId: workspace.id, workspaceOrder: [workspace.id], globalSettings: settings };
  await chrome.storage.local.set({ [workspaceKey(workspace.id)]: migrated, [META_KEY]: meta });
  return meta;
}

export async function getMeta(): Promise<AppMetaState> { return migrateIfNeeded(); }
export async function saveMeta(meta: AppMetaState): Promise<void> { await chrome.storage.local.set({ [META_KEY]: meta }); }

export async function getWorkspaceState(workspaceId: string): Promise<WorkspaceState> {
  const meta = await migrateIfNeeded();
  const result = await chrome.storage.local.get(workspaceKey(workspaceId));
  const stored = result[workspaceKey(workspaceId)] as WorkspaceState | undefined;
  if (stored) return stored;
  const workspace = createWorkspaceRecord('مساحة عمل جديدة');
  const fallback = createWorkspaceState({ ...workspace, id: workspaceId }, meta.globalSettings);
  await chrome.storage.local.set({ [workspaceKey(workspaceId)]: fallback });
  return fallback;
}

export async function getState(workspaceId?: string): Promise<AppState> {
  const meta = await migrateIfNeeded();
  const state = await getWorkspaceState(workspaceId ?? meta.activeWorkspaceId);
  return { workspaceId: state.workspaceId, queue: state.queue, session: state.session, history: state.history };
}

export async function saveWorkspaceState(state: WorkspaceState): Promise<void> {
  await chrome.storage.local.set({ [workspaceKey(state.workspaceId)]: state });
}

export async function updateWorkspaceState(workspaceId: string, mutator: (state: WorkspaceState) => WorkspaceState): Promise<WorkspaceState> {
  const next = mutator(await getWorkspaceState(workspaceId));
  await saveWorkspaceState(next);
  const meta = await getMeta();
  const updatedWorkspace = { ...next.workspace, lastActivityAt: Date.now(), updatedAt: Date.now() };
  await saveWorkspaceState({ ...next, workspace: updatedWorkspace });
  return { ...next, workspace: updatedWorkspace };
}

export async function updateState(mutator: (state: AppState) => AppState): Promise<AppState> {
  const meta = await getMeta();
  const current = await getWorkspaceState(meta.activeWorkspaceId);
  const next = mutator({ workspaceId: current.workspaceId, queue: current.queue, session: current.session, history: current.history });
  const saved = await updateWorkspaceState(meta.activeWorkspaceId, (state) => ({ ...state, ...next, workspaceId: state.workspaceId }));
  return { workspaceId: saved.workspaceId, queue: saved.queue, session: saved.session, history: saved.history };
}

export async function listWorkspaces(includeArchived = true): Promise<Workspace[]> {
  const meta = await getMeta();
  const states = await Promise.all(meta.workspaceOrder.map((id) => getWorkspaceState(id)));
  return states.map((state) => state.workspace).filter((workspace) => includeArchived || !workspace.archived).sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.lastActivityAt - a.lastActivityAt);
}

export async function createWorkspace(name: string, description = '', color?: string, icon?: string): Promise<WorkspaceState> {
  const meta = await getMeta();
  const workspace = createWorkspaceRecord(name, description, color, icon);
  const state = createWorkspaceState(workspace, meta.globalSettings);
  await saveWorkspaceState(state);
  await saveMeta({ ...meta, workspaceOrder: [...meta.workspaceOrder, workspace.id] });
  return state;
}

export async function updateWorkspace(workspaceId: string, patch: Partial<Pick<Workspace, 'name' | 'description' | 'color' | 'icon' | 'favorite'>>): Promise<Workspace> {
  const state = await getWorkspaceState(workspaceId);
  const workspace = { ...state.workspace, ...patch, updatedAt: Date.now(), lastActivityAt: Date.now() };
  await saveWorkspaceState({ ...state, workspace });
  return workspace;
}

export async function setActiveWorkspace(workspaceId: string): Promise<AppMetaState> {
  const meta = await getMeta();
  const state = await getWorkspaceState(workspaceId);
  if (state.workspace.archived) throw new Error('WORKSPACE_ARCHIVED');
  const next = { ...meta, activeWorkspaceId: workspaceId };
  await saveMeta(next);
  return next;
}

export async function archiveWorkspace(workspaceId: string): Promise<AppMetaState> {
  const meta = await getMeta();
  if (meta.workspaceOrder.length <= 1) throw new Error('CANNOT_ARCHIVE_LAST_WORKSPACE');
  const state = await getWorkspaceState(workspaceId);
  await saveWorkspaceState({ ...state, workspace: { ...state.workspace, archived: true, updatedAt: Date.now() } });
  if (meta.activeWorkspaceId === workspaceId) {
    const replacement = (await listWorkspaces(false)).find((workspace) => workspace.id !== workspaceId);
    if (replacement) return setActiveWorkspace(replacement.id);
  }
  return getMeta();
}

export async function restoreWorkspace(workspaceId: string): Promise<Workspace> {
  const state = await getWorkspaceState(workspaceId);
  const workspace = { ...state.workspace, archived: false, updatedAt: Date.now() };
  await saveWorkspaceState({ ...state, workspace });
  return workspace;
}

export async function deleteWorkspace(workspaceId: string, confirmed: boolean): Promise<AppMetaState> {
  if (!confirmed) throw new Error('WORKSPACE_DELETE_CONFIRMATION_REQUIRED');
  const meta = await getMeta();
  if (meta.workspaceOrder.length <= 1) throw new Error('CANNOT_DELETE_LAST_WORKSPACE');
  if (meta.automationWorkspaceId === workspaceId) throw new Error('CANNOT_DELETE_RUNNING_WORKSPACE');
  await chrome.storage.local.remove(workspaceKey(workspaceId));
  const order = meta.workspaceOrder.filter((id) => id !== workspaceId);
  const next = { ...meta, workspaceOrder: order, activeWorkspaceId: meta.activeWorkspaceId === workspaceId ? order[0] : meta.activeWorkspaceId };
  await saveMeta(next);
  return next;
}

export async function getAutomationOwner(): Promise<string | undefined> { return (await getMeta()).automationWorkspaceId; }
export async function claimAutomationOwner(workspaceId: string): Promise<void> {
  const meta = await getMeta();
  if (meta.automationWorkspaceId && meta.automationWorkspaceId !== workspaceId) throw new Error('AUTOMATION_OWNED_BY_OTHER_WORKSPACE');
  await saveMeta({ ...meta, automationWorkspaceId: workspaceId });
}
export async function releaseAutomationOwner(workspaceId: string): Promise<void> {
  const meta = await getMeta();
  if (meta.automationWorkspaceId === workspaceId) await saveMeta({ ...meta, automationWorkspaceId: undefined });
}

export async function addAttempt(attempt: PublishAttempt): Promise<void> {
  const meta = await getMeta();
  const workspaceId = attempt.workspaceId ?? meta.automationWorkspaceId ?? meta.activeWorkspaceId;
  await updateWorkspaceState(workspaceId, (state) => ({ ...state, history: [...state.history, { ...attempt, workspaceId }].slice(-2000) }));
}
export async function getHistoricalSessions(workspaceId: string): Promise<HistoricalSession[]> {
  return (await getWorkspaceState(workspaceId)).historicalSessions ?? [];
}
export async function saveHistoricalSession(workspaceId: string, session: HistoricalSession): Promise<void> {
  await updateWorkspaceState(workspaceId, (state) => ({ ...state, historicalSessions: [...(state.historicalSessions ?? []).filter((item) => item.id !== session.id), session].sort((a, b) => b.startedAt - a.startedAt).slice(0, 500) }));
}
export async function updateHistoricalSession(workspaceId: string, sessionId: string, patch: Partial<HistoricalSession>): Promise<void> {
  await updateWorkspaceState(workspaceId, (state) => ({ ...state, historicalSessions: (state.historicalSessions ?? []).map((session) => session.id === sessionId ? { ...session, ...patch, updatedAt: Date.now() } : session) }));
}
export async function getSettings(): Promise<Settings> { return (await getMeta()).globalSettings; }
export async function saveSettings(settings: Settings): Promise<void> { const meta = await getMeta(); await saveMeta({ ...meta, globalSettings: settings }); }
export async function saveSession(session: AutomationSession | null): Promise<void> { await updateState((state) => ({ ...state, session })); }
export async function saveQueue(queue: QueueItem[]): Promise<void> { await updateState((state) => ({ ...state, queue })); }
