// To store message streaming controller
export const ChatControllerPool = {
  controllers: {} as Record<string, AbortController>,

  addController(
    sessionId: string,
    messageId: string,
    controller: AbortController,
  ) {
    const key = this.key(sessionId, messageId);
    this.controllers[key] = controller;
    return key;
  },

  stop(sessionId: string, messageId: string) {
    const key = this.key(sessionId, messageId);
    const controller = this.controllers[key];
    if (!controller) return false;
    controller.abort();
    return true;
  },

  stopSession(sessionId: string) {
    const prefix = `${sessionId},`;
    let stopped = false;
    Object.entries(this.controllers).forEach(([key, controller]) => {
      if (!key.startsWith(prefix)) return;
      controller.abort();
      stopped = true;
    });
    return stopped;
  },

  stopAll() {
    Object.values(this.controllers).forEach((v) => v.abort());
  },

  hasPending() {
    return Object.values(this.controllers).length > 0;
  },

  has(sessionId: string, messageId: string) {
    const key = this.key(sessionId, messageId);
    return Boolean(this.controllers[key]);
  },

  hasSession(sessionId: string) {
    const prefix = `${sessionId},`;
    return Object.keys(this.controllers).some((key) => key.startsWith(prefix));
  },

  remove(sessionId: string, messageId: string) {
    const key = this.key(sessionId, messageId);
    delete this.controllers[key];
  },

  key(sessionId: string, messageIndex: string) {
    return `${sessionId},${messageIndex}`;
  },
};
