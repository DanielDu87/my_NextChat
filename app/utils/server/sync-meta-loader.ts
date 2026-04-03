import { getStoreSnapshotMetas } from "./sync-store-repository";

export async function loadStoreSnapshotMetasSafely(
  keys: string[],
  userId: string,
) {
  if (keys.length === 0) {
    return [];
  }

  try {
    return await getStoreSnapshotMetas(keys, userId);
  } catch (error) {
    if (keys.length === 1) {
      console.error(`[DB Sync Meta] 读取 ${keys[0]} 失败`, error);
      return [];
    }

    console.error(
      `[DB Sync Meta] 批量读取失败，回退到逐项读取: ${keys.join(", ")}`,
      error,
    );

    const metas = [];
    for (const key of keys) {
      try {
        const singleMetas = await getStoreSnapshotMetas([key], userId);
        metas.push(...singleMetas);
      } catch (singleError) {
        console.error(`[DB Sync Meta] 读取 ${key} 失败，已跳过`, singleError);
      }
    }

    return metas;
  }
}
