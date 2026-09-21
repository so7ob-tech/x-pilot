export const CURRENT_SCHEMA_VERSION = 4 as const;

export interface StorageMigrationStep {
  id: string;
  from: number;
  to: number;
  description: string;
}

/** Ordered persisted-schema transitions. Each transition must be implemented before its target schema is written. */
export const STORAGE_MIGRATIONS: readonly StorageMigrationStep[] = [
  { id: 'legacy-to-v3', from: 1, to: 3, description: 'Move legacy flat state and settings into the initial Workspace schema.' },
  { id: 'schema-2-to-3', from: 2, to: 3, description: 'Add bank metadata and historical session collections.' },
  { id: 'schema-3-to-4', from: 3, to: 4, description: 'Separate canonical metadata, settings, Runtime, Queue, Banks, Session Records, and Attempts.' },
];

export function getMigrationPath(fromVersion: number, targetVersion = CURRENT_SCHEMA_VERSION): StorageMigrationStep[] {
  const path: StorageMigrationStep[] = [];
  let current = fromVersion;
  while (current < targetVersion) {
    const step = STORAGE_MIGRATIONS.find((candidate) => candidate.from === current);
    if (!step) throw new Error(`MIGRATION_PATH_NOT_FOUND:${current}->${targetVersion}`);
    path.push(step);
    current = step.to;
  }
  if (current !== targetVersion) throw new Error(`MIGRATION_TARGET_UNREACHABLE:${fromVersion}->${targetVersion}`);
  return path;
}

export function validateMigrationRegistry(targetVersion = CURRENT_SCHEMA_VERSION): void {
  for (const step of STORAGE_MIGRATIONS) if (step.to > targetVersion) continue;
  getMigrationPath(1, targetVersion);
  getMigrationPath(2, targetVersion);
  getMigrationPath(3, targetVersion);
}
