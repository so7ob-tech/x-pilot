export type QueueItemStatus = 'PENDING' | 'OPENING' | 'READY' | 'PUBLISHING' | 'PUBLISHED' | 'PUBLISHED_UNVERIFIED' | 'FAILED' | 'SKIPPED';
export type SessionStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'STOPPED' | 'WAITING' | 'COMPLETED' | 'FAILED';
export type FailureBehavior = 'CONTINUE' | 'PAUSE';

export interface QueueItem {
  id: string;
  workspaceId?: string;
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
  workspaceId?: string;
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
  workspaceId?: string;
  queueItemId: string;
  link: string;
  timestamp: number;
  attemptNumber: number;
  action: string;
  result: string;
  error?: string;
}

export interface AppState {
  workspaceId?: string;
  queue: QueueItem[];
  session: AutomationSession | null;
  history: PublishAttempt[];
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  color?: string;
  icon?: string;
  favorite: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
}

export interface TweetBank {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  createdAt: number;
  updatedAt: number;
  lastExtractedAt?: number;
  lastExtractedCount?: number;
}

export interface WorkspaceState extends AppState {
  workspaceId: string;
  workspace: Workspace;
  banks: TweetBank[];
}

export interface Settings {
  intervalMinutes: number;
  maxRetries: number;
  failureBehavior: FailureBehavior;
  confirmBeforeStart: boolean;
  keepAutomationTabOpen: boolean;
  closeTabOnComplete: boolean;
}

export interface AppMetaState {
  schemaVersion: 2;
  activeWorkspaceId: string;
  automationWorkspaceId?: string;
  workspaceOrder: string[];
  globalSettings: Settings;
}

export const defaultSettings: Settings = {
  intervalMinutes: 2,
  maxRetries: 2,
  failureBehavior: 'CONTINUE',
  confirmBeforeStart: true,
  keepAutomationTabOpen: true,
  closeTabOnComplete: false
};

export type AutomationConnection = 'CONNECTED' | 'DISCONNECTED' | 'NOT_REQUIRED';

export interface RuntimeStatus {
  engineStatus: SessionStatus;
  connection: AutomationConnection;
  automationTabId?: number;
  automationWorkspaceId?: string;
  checkedAt: number;
}

export type RuntimeMessage =
  | { type: 'GET_STATE' }
  | { type: 'GET_WORKSPACES' }
  | { type: 'GET_WORKSPACE_STATE'; workspaceId?: string }
  | { type: 'CREATE_WORKSPACE'; name: string; description?: string; color?: string; icon?: string }
  | { type: 'UPDATE_WORKSPACE'; workspaceId: string; patch: Partial<Pick<Workspace, 'name' | 'description' | 'color' | 'icon' | 'favorite'>> }
  | { type: 'ARCHIVE_WORKSPACE'; workspaceId: string }
  | { type: 'RESTORE_WORKSPACE'; workspaceId: string }
  | { type: 'DELETE_WORKSPACE'; workspaceId: string; confirmed: boolean }
  | { type: 'SET_ACTIVE_WORKSPACE'; workspaceId: string }
  | { type: 'GET_RUNTIME_STATUS' }
  | { type: 'EXTRACT_BANK'; bankUrl: string; workspaceId?: string; mode?: 'REPLACE' | 'APPEND' }
  | { type: 'START'; confirmed?: boolean; workspaceId?: string }
  | { type: 'PAUSE'; workspaceId?: string }
  | { type: 'RESUME'; workspaceId?: string }
  | { type: 'STOP'; workspaceId?: string }
  | { type: 'SKIP_CURRENT' }
  | { type: 'RETRY_ITEM'; itemId: string }
  | { type: 'REORDER'; itemId: string; direction: 'up' | 'down' }
  | { type: 'DELETE_ITEM'; itemId: string }
  | { type: 'CLEAR_COMPLETED' }
  | { type: 'UPDATE_SETTINGS'; settings: Settings; workspaceId?: string };

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
