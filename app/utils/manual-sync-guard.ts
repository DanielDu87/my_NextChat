let manualDatabaseSyncDepth = 0;

export function isManualDatabaseSyncActive() {
  return manualDatabaseSyncDepth > 0;
}

export async function runWithManualDatabaseSyncActive<T>(
  task: () => Promise<T> | T,
): Promise<T> {
  manualDatabaseSyncDepth += 1;
  try {
    return await task();
  } finally {
    manualDatabaseSyncDepth = Math.max(0, manualDatabaseSyncDepth - 1);
  }
}
