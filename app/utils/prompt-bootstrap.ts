import { StoreKey } from "../constant";
import {
  persistPromptCacheFromState,
  readPromptCache,
  usePromptStore,
  type Prompt,
} from "../store/prompt";
import { bootstrapStaleRevalidate } from "./stale-revalidate";

const SHARED_PROMPT_BOOTSTRAP_KEY = "shared-prompts";

function getCachedPrompts() {
  const cached = readPromptCache();
  if (!cached) return null;

  const deletedPromptIds = new Set(cached.deletedPromptIds ?? []);
  return Object.values(cached.prompts ?? {}).filter(
    (prompt): prompt is Prompt => !!prompt && !deletedPromptIds.has(prompt.id),
  );
}

export function bootstrapSharedPrompts(options?: {
  forceRestart?: boolean;
  signal?: AbortSignal;
}) {
  usePromptStore.getState().restorePromptCache();

  return bootstrapStaleRevalidate({
    key: SHARED_PROMPT_BOOTSTRAP_KEY,
    cachedData: getCachedPrompts(),
    forceRestart: options?.forceRestart,
    signal: options?.signal,
    revalidate: async (signal) => {
      const { useSyncStore } = await import("../store/sync");
      await useSyncStore.getState().sync([StoreKey.Prompt], {
        force: true,
        isolateQueue: true,
        downloadOnlyRegular: true,
        silentSummary: true,
        abortSignal: signal,
      });
      persistPromptCacheFromState(usePromptStore.getState());
      return getCachedPrompts() ?? [];
    },
  });
}
