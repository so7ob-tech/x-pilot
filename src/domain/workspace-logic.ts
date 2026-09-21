type LegacyState = {
  queue?: Array<Record<string, unknown>>;
  session?: Record<string, unknown>;
  history?: Array<Record<string, unknown>>;
};

type WorkspaceRecord = { id: string; name: string; description: string; favorite: boolean; archived: boolean; createdAt: number; updatedAt: number; lastActivityAt: number };

export function createDefaultWorkspace(name = 'مساحة العمل الافتراضية', now = Date.now(), id = crypto.randomUUID()): WorkspaceRecord {
  return { id, name, description: 'تم ترحيلها تلقائيًا من بيانات X-Pilot السابقة', favorite: false, archived: false, createdAt: now, updatedAt: now, lastActivityAt: now };
}

export function migrateLegacyState(legacy: LegacyState = {}, settings: Record<string, unknown> = {}, workspaceId = crypto.randomUUID(), now = Date.now()) {
  const workspace = createDefaultWorkspace('مساحة العمل الافتراضية', now, workspaceId);
  const queue = (legacy.queue ?? []).map((item) => ({ ...item, workspaceId }));
  const session = legacy.session ? { ...legacy.session, workspaceId } : null;
  const history = (legacy.history ?? []).map((attempt) => ({ ...attempt, workspaceId }));
  return { workspaceId, workspace, banks: [], queue, session: session ? { ...session, ...settings } : null, history };
}

export function canClaimAutomationOwner(currentOwner: string | undefined, requestedOwner: string): boolean {
  return !currentOwner || currentOwner === requestedOwner;
}

export function resolveActiveWorkspace(workspaces: WorkspaceRecord[], requestedId?: string): WorkspaceRecord | undefined {
  const requested = workspaces.find((workspace) => workspace.id === requestedId && !workspace.archived);
  return requested ?? workspaces.find((workspace) => !workspace.archived) ?? workspaces[0];
}
