type RevalidateEntry<T> = {
  controller: AbortController;
  promise: Promise<T>;
};

const revalidateEntries = new Map<string, RevalidateEntry<unknown>>();

export function isAbortLikeError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    String(error).toLowerCase().includes("signal is aborted") ||
    /^error: \[(?:db )?sync\] aborted\b/i.test(String(error))
  );
}

export function runStaleRevalidate<T>(params: {
  key: string;
  forceRestart?: boolean;
  signal?: AbortSignal;
  task: (signal: AbortSignal) => Promise<T>;
}) {
  let existing = revalidateEntries.get(params.key) as
    | RevalidateEntry<T>
    | undefined;
  if (existing?.controller.signal.aborted) {
    revalidateEntries.delete(params.key);
    existing = undefined;
  }
  if (existing && !params.forceRestart) {
    return existing.promise;
  }

  if (existing && params.forceRestart) {
    existing.controller.abort();
    revalidateEntries.delete(params.key);
  }

  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  params.signal?.addEventListener("abort", abortRequest, { once: true });
  if (params.signal?.aborted) {
    controller.abort();
  }

  const promise = params.task(controller.signal).finally(() => {
    params.signal?.removeEventListener("abort", abortRequest);
    if (revalidateEntries.get(params.key)?.promise === promise) {
      revalidateEntries.delete(params.key);
    }
  });

  revalidateEntries.set(params.key, { controller, promise });
  return promise;
}

export function bootstrapStaleRevalidate<T>(params: {
  key: string;
  cachedData: T | null;
  forceRestart?: boolean;
  signal?: AbortSignal;
  revalidate: (signal: AbortSignal) => Promise<T>;
}) {
  return {
    cachedData: params.cachedData,
    isFirstLoad: params.cachedData == null,
    revalidatePromise: runStaleRevalidate<T>({
      key: params.key,
      forceRestart: params.forceRestart,
      signal: params.signal,
      task: params.revalidate,
    }),
  };
}
