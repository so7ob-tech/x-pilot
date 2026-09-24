export type TabId = 'operation' | 'tests' | 'queue' | 'sessions' | 'analytics' | 'diagnostics' | 'workspaces' | 'settings';

export type TabSelectHandler = (tab: TabId) => void;
