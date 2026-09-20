export type QueueItemStatus = 'PENDING' | 'OPENING' | 'READY' | 'PUBLISHING' | 'PUBLISHED' | 'PUBLISHED_UNVERIFIED' | 'FAILED' | 'SKIPPED';
export type SessionStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'STOPPED' | 'WAITING' | 'COMPLETED' | 'FAILED';
export type FailureBehavior = 'CONTINUE' | 'PAUSE';

export interface QueueItem {
  id: string;
  sourceBankUrl: string;
  targetUrl: string;
  label?: string;
  position: number;
  status: QueueItemStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  publishedAt?: number;
  lastError?: string;
  operationId?: string;
}

export interface AutomationSession {
  id: string;
  bankUrl: string;
  status: SessionStatus;
  currentItemId?: string;
  currentIndex: number;
  total: number;
  startedAt?: number;
  pausedAt?: number;
  completedAt?: number;
  nextRunAt?: number;
  automationTabId?: number;
  intervalMinutes: number;
  maxRetries: number;
  failureBehavior: FailureBehavior;
  confirmBeforeStart: boolean;
  keepAutomationTabOpen: boolean;
  closeTabOnComplete: boolean;
  version: number;
  updatedAt: number;
}

export interface PublishAttempt {
  id: string;
  queueItemId: string;
  link: string;
  timestamp: number;
  attemptNumber: number;
  action: string;
  result: string;
  error?: string;
}

export interface AppState {
  queue: QueueItem[];
  session: AutomationSession | null;
  history: PublishAttempt[];
}

export interface Settings {
  intervalMinutes: number;
  maxRetries: number;
  failureBehavior: FailureBehavior;
  confirmBeforeStart: boolean;
  keepAutomationTabOpen: boolean;
  closeTabOnComplete: boolean;
}

export const defaultSettings: Settings = {
  intervalMinutes: 2,
  maxRetries: 2,
  failureBehavior: 'CONTINUE',
  confirmBeforeStart: true,
  keepAutomationTabOpen: true,
  closeTabOnComplete: false
};

export type RuntimeMessage =
  | { type: 'GET_STATE' }
  | { type: 'EXTRACT_BANK'; bankUrl: string }
  | { type: 'START'; confirmed?: boolean }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'SKIP_CURRENT' }
  | { type: 'RETRY_ITEM'; itemId: string }
  | { type: 'REORDER'; itemId: string; direction: 'up' | 'down' }
  | { type: 'DELETE_ITEM'; itemId: string }
  | { type: 'CLEAR_COMPLETED' }
  | { type: 'UPDATE_SETTINGS'; settings: Settings };

export type ContentMessage =
  | { type: 'X_INSPECT' }
  | { type: 'X_PUBLISH' };

export interface ContentInspection {
  ok: boolean;
  pageKind: 'X' | 'LOGIN' | 'CHALLENGE' | 'ERROR' | 'UNKNOWN';
  composerFound: boolean;
  contentPresent: boolean;
  postButtonFound: boolean;
  postButtonEnabled: boolean;
  reason?: string;
}
