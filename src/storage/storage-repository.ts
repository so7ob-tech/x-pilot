import type { AppState, AutomationSession, PublishAttempt, QueueItem, Settings } from '../domain/models';
import { defaultSettings } from '../domain/models';

const KEY = 'xQueueState';

const emptyState: AppState = { queue: [], session: null, history: [] };

export async function getState(): Promise<AppState> {
  const result = await chrome.storage.local.get(KEY);
  return { ...emptyState, ...(result[KEY] as Partial<AppState> | undefined) };
}

export async function saveState(state: AppState): Promise<void> {
  await chrome.storage.local.set({ [KEY]: state });
}

export async function updateState(mutator: (state: AppState) => AppState): Promise<AppState> {
  const next = mutator(await getState());
  await saveState(next);
  return next;
}

export async function addAttempt(attempt: PublishAttempt): Promise<void> {
  await updateState((state) => ({ ...state, history: [...state.history, attempt].slice(-2000) }));
}

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get('xQueueSettings');
  return { ...defaultSettings, ...(result.xQueueSettings as Partial<Settings> | undefined) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ xQueueSettings: settings });
}

export async function saveSession(session: AutomationSession | null): Promise<void> {
  await updateState((state) => ({ ...state, session }));
}

export async function saveQueue(queue: QueueItem[]): Promise<void> {
  await updateState((state) => ({ ...state, queue }));
}
