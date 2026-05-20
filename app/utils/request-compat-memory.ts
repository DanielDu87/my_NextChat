import { ServiceProvider } from "../constant";

type RequestCompatibilityState = {
  disableWebSearch?: boolean;
  disableStreamOptions?: boolean;
  disableReasoningEffort?: boolean;
  disableReasoning?: boolean;
  disableThinking?: boolean;
  disableStructuredOutput?: boolean;
  disableMediaResolution?: boolean;
  disableTemperature?: boolean;
};

const REQUEST_COMPAT_STORAGE_KEY = "nextchat_request_compat_memory_v1";

function normalizeBaseUrl(baseUrl?: string) {
  return String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "")
    .toLowerCase();
}

function readRequestCompatibilityMap() {
  if (typeof window === "undefined") {
    return {} as Record<string, RequestCompatibilityState>;
  }

  try {
    const raw = window.localStorage.getItem(REQUEST_COMPAT_STORAGE_KEY);
    if (!raw) {
      return {} as Record<string, RequestCompatibilityState>;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, RequestCompatibilityState>)
      : {};
  } catch {
    return {} as Record<string, RequestCompatibilityState>;
  }
}

function writeRequestCompatibilityMap(
  map: Record<string, RequestCompatibilityState>,
) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(REQUEST_COMPAT_STORAGE_KEY, JSON.stringify(map));
}

export function buildRequestCompatibilityKey(params: {
  providerName?: string;
  model: string;
  baseUrl?: string;
}) {
  return [
    String(params.providerName || ServiceProvider.Custom)
      .trim()
      .toLowerCase(),
    normalizeBaseUrl(params.baseUrl),
    String(params.model || "")
      .trim()
      .toLowerCase(),
  ].join("::");
}

export function getRequestCompatibilityState(key: string) {
  return readRequestCompatibilityMap()[key] || {};
}

export function hasRequestCompatibilityOverrides(
  state?: RequestCompatibilityState,
) {
  return Object.values(state || {}).some(Boolean);
}

export function rememberRequestCompatibilityState(
  key: string,
  state: RequestCompatibilityState,
) {
  const currentMap = readRequestCompatibilityMap();
  if (!hasRequestCompatibilityOverrides(state)) {
    delete currentMap[key];
  } else {
    currentMap[key] = state;
  }
  writeRequestCompatibilityMap(currentMap);
}

function cloneRequestPayload(payload: any) {
  if (payload instanceof FormData) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  return JSON.parse(JSON.stringify(payload));
}

export function applyRequestCompatibilityState(
  payload: any,
  state: RequestCompatibilityState,
) {
  const nextPayload = cloneRequestPayload(payload);
  if (
    !nextPayload ||
    typeof nextPayload !== "object" ||
    nextPayload instanceof FormData
  ) {
    return nextPayload;
  }

  if (state.disableWebSearch) {
    delete nextPayload.web_search_options;
  }
  if (state.disableStreamOptions) {
    delete nextPayload.stream_options;
  }
  if (state.disableReasoningEffort) {
    delete nextPayload.reasoning_effort;
    if (nextPayload.reasoning && typeof nextPayload.reasoning === "object") {
      delete nextPayload.reasoning.effort;
      if (Object.keys(nextPayload.reasoning).length === 0) {
        delete nextPayload.reasoning;
      }
    }
  }
  if (state.disableReasoning) {
    delete nextPayload.reasoning;
    delete nextPayload.reasoning_effort;
  }
  if (state.disableThinking) {
    delete nextPayload.thinking;
  }
  if (state.disableStructuredOutput) {
    delete nextPayload.response_format;
  }
  if (state.disableMediaResolution) {
    delete nextPayload.media_resolution;
  }
  if (state.disableTemperature) {
    delete nextPayload.temperature;
  }

  return nextPayload;
}

export function getRequestCompatibilityFallback(
  errorText: string,
  currentState: RequestCompatibilityState,
) {
  const text = String(errorText || "");
  const rules: Array<{
    pattern: RegExp;
    key: keyof RequestCompatibilityState;
    label: string;
  }> = [
    {
      pattern: /Unknown parameter:\s*'web_search_options'/i,
      key: "disableWebSearch",
      label: "web_search_options",
    },
    {
      pattern: /Unknown parameter:\s*'stream_options'/i,
      key: "disableStreamOptions",
      label: "stream_options",
    },
    {
      pattern: /Unknown parameter:\s*'reasoning_effort'/i,
      key: "disableReasoningEffort",
      label: "reasoning_effort",
    },
    {
      pattern: /Unknown parameter:\s*'reasoning'/i,
      key: "disableReasoning",
      label: "reasoning",
    },
    {
      pattern: /Unknown parameter:\s*'thinking'/i,
      key: "disableThinking",
      label: "thinking",
    },
    {
      pattern: /Unknown parameter:\s*'response_format'/i,
      key: "disableStructuredOutput",
      label: "response_format",
    },
    {
      pattern: /Unknown parameter:\s*'media_resolution'/i,
      key: "disableMediaResolution",
      label: "media_resolution",
    },
    {
      pattern:
        /(?=.*temperature)(?:Unsupported value|unsupported_value|Only the default|default\s*\(1\)|param["']?\s*:\s*["']temperature["']?)/i,
      key: "disableTemperature",
      label: "temperature",
    },
  ];

  for (const rule of rules) {
    if (!rule.pattern.test(text) || currentState[rule.key]) {
      continue;
    }

    return {
      nextState: {
        ...currentState,
        [rule.key]: true,
      },
      disabledField: rule.label,
    };
  }

  return null;
}
