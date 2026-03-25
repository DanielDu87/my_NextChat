import {
  AUTO_SYNC_LOCK_TTL_MS,
  buildAutoSyncLock,
  isAutoSyncLockActive,
  parseAutoSyncLock,
  shouldAutoSyncLockBeTakenOver,
} from "../app/utils/sync-tab-coordination";

describe("sync tab coordination helpers", () => {
  test("parseAutoSyncLock 应该解析有效锁", () => {
    expect(
      parseAutoSyncLock(JSON.stringify({ owner: "tab-1", expiresAt: 123 })),
    ).toEqual({
      owner: "tab-1",
      expiresAt: 123,
    });
  });

  test("parseAutoSyncLock 应该拒绝无效锁", () => {
    expect(parseAutoSyncLock("not-json")).toBeNull();
    expect(parseAutoSyncLock(JSON.stringify({ owner: "", expiresAt: 1 }))).toBeNull();
    expect(
      parseAutoSyncLock(JSON.stringify({ owner: "tab-1", expiresAt: "1" })),
    ).toBeNull();
  });

  test("buildAutoSyncLock 应该按 ttl 生成过期时间", () => {
    expect(buildAutoSyncLock("tab-1", 1000)).toEqual({
      owner: "tab-1",
      expiresAt: 1000 + AUTO_SYNC_LOCK_TTL_MS,
    });
  });

  test("shouldAutoSyncLockBeTakenOver 应该只允许接管过期锁", () => {
    const activeLock = {
      owner: "tab-a",
      expiresAt: 10_000,
    };
    const expiredLock = {
      owner: "tab-a",
      expiresAt: 100,
    };

    expect(isAutoSyncLockActive(activeLock, 1_000)).toBe(true);
    expect(isAutoSyncLockActive(expiredLock, 1_000)).toBe(false);
    expect(shouldAutoSyncLockBeTakenOver(activeLock, "tab-b", 1_000)).toBe(
      false,
    );
    expect(shouldAutoSyncLockBeTakenOver(expiredLock, "tab-b", 1_000)).toBe(
      true,
    );
    expect(shouldAutoSyncLockBeTakenOver(activeLock, "tab-a", 1_000)).toBe(
      true,
    );
  });
});
