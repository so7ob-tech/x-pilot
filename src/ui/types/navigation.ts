export type TabId = 'operation' | 'tests' | 'queue' | 'sessions' | 'history' | 'analytics' | 'diagnostics' | 'workspaces' | 'settings';

export type TabSelectHandler = (tab: TabId) => void;
