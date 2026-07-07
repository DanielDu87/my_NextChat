export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startApiConfigBackupScheduler } = await import(
      "./app/utils/server/api-config-backup-scheduler"
    );
    startApiConfigBackupScheduler();
    
    const { startChatBackupScheduler } = await import(
      "./app/utils/server/chat-backup-scheduler"
    );
    startChatBackupScheduler();
  }
}
