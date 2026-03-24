import { writeFileSync } from "fs";

import { STORAGE_KEY, StoreKey } from "../app/constant";
import { STORE_PERSIST_VERSION } from "../app/utils/sync-store-keys";
import { setStoreSnapshot } from "../app/utils/server/sync-store-repository";

type JsonObject = Record<string, any>;

type SourceFileReport = {
  path: string;
  status: "imported" | "missing" | "skipped";
  sizeBytes: number;
  note?: string;
};

type StoreMigrationReport = {
  storeKey: StoreKey;
  status: "imported" | "skipped" | "failed";
  payloadBytes: number;
  sourceFiles: SourceFileReport[];
  note?: string;
};

const DEFAULT_WEBDAV_BASE_URL = "https://webdav.dyxcloud.com/";
const DEFAULT_REPORT_PATH = "docs/db/webdav-store-migration-report.json";
const CHAT_RECORDS_DIR = "chat-records";
const MODELS_DIR = "models";

const DIRECT_FILE_NAMES: Partial<Record<StoreKey, string>> = {
  [StoreKey.Access]: "access.json",
  [StoreKey.Mask]: "mask.json",
  [StoreKey.Prompt]: "prompt.json",
};

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = (baseUrl || DEFAULT_WEBDAV_BASE_URL).replace(/\/+$/, "");
  return trimmed.endsWith(`/${STORAGE_KEY}`) ? trimmed : `${trimmed}/${STORAGE_KEY}`;
}

function getWebDavBaseUrl() {
  return normalizeBaseUrl(process.env.WEBDAV_BASE_URL || DEFAULT_WEBDAV_BASE_URL);
}

function buildAuthHeaders(): Record<string, string> {
  const username = process.env.WEBDAV_USERNAME || "";
  const password = process.env.WEBDAV_PASSWORD || "";

  if (!username && !password) {
    return {};
  }

  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

async function readWebDavText(filePath: string) {
  const url = `${getWebDavBaseUrl()}/${filePath.replace(/^\/+/, "")}`;
  const response = await fetch(url, {
    headers: buildAuthHeaders(),
  });

  if (response.status === 404) {
    return {
      ok: false as const,
      status: 404,
      text: "",
      sizeBytes: 0,
      path: filePath,
    };
  }

  if (!response.ok) {
    throw new Error(`[WebDAV] 读取失败 ${filePath}: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  return {
    ok: true as const,
    status: response.status,
    text,
    sizeBytes: Buffer.byteLength(text),
    path: filePath,
  };
}

function wrapPersistedState(
  storeKey: keyof typeof STORE_PERSIST_VERSION,
  state: unknown,
) {
  return {
    state,
    version: STORE_PERSIST_VERSION[storeKey],
  };
}

function formatDateSegment(timestamp?: number) {
  const date = new Date(timestamp || Date.now());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildChatSessionFileName(session: {
  id?: string;
  lastUpdate?: number;
  storagePath?: string;
}) {
  if (session.storagePath) {
    return session.storagePath;
  }

  const datePart = formatDateSegment(session.lastUpdate);
  return `${CHAT_RECORDS_DIR}/${datePart}-${session.id}.json`;
}

function extractEmbeddedModels(configState: JsonObject) {
  return Array.isArray(configState.models) ? configState.models : [];
}

async function loadDirectStore(storeKey: StoreKey): Promise<{
  payload: unknown | null;
  sourceFiles: SourceFileReport[];
}> {
  const fileName = DIRECT_FILE_NAMES[storeKey];
  if (!fileName) {
    return {
      payload: null,
      sourceFiles: [],
    };
  }

  const file = await readWebDavText(fileName);
  if (!file.ok) {
    return {
      payload: null,
      sourceFiles: [
        {
          path: fileName,
          status: "missing",
          sizeBytes: 0,
        },
      ],
    };
  }

  return {
    payload: JSON.parse(file.text),
    sourceFiles: [
      {
        path: fileName,
        status: "imported",
        sizeBytes: file.sizeBytes,
      },
    ],
  };
}

async function loadChatStore(): Promise<{
  payload: unknown | null;
  sourceFiles: SourceFileReport[];
}> {
  const indexFile = await readWebDavText("chat-index.json");
  if (indexFile.ok) {
    const chatIndex = JSON.parse(indexFile.text) as JsonObject;
    const sessions = Array.isArray(chatIndex.sessions) ? chatIndex.sessions : [];
    const sourceFiles: SourceFileReport[] = [
      {
        path: "chat-index.json",
        status: "imported",
        sizeBytes: indexFile.sizeBytes,
      },
    ];

    const hydratedSessions = await Promise.all(
      sessions.map(async (session: JsonObject) => {
        const storagePath = buildChatSessionFileName(session);
        const sessionFile = await readWebDavText(storagePath);

        if (!sessionFile.ok) {
          sourceFiles.push({
            path: storagePath,
            status: "missing",
            sizeBytes: 0,
            note: session.topic || session.id || "",
          });

          return {
            ...session,
            messages: [],
            storagePath,
          };
        }

        sourceFiles.push({
          path: storagePath,
          status: "imported",
          sizeBytes: sessionFile.sizeBytes,
          note: session.topic || session.id || "",
        });

        const payload = JSON.parse(sessionFile.text);
        return {
          ...session,
          ...payload,
          messages: Array.isArray(payload.messages) ? payload.messages : [],
          storagePath,
        };
      }),
    );

    return {
      payload: {
        ...chatIndex,
        sessions: hydratedSessions,
      },
      sourceFiles,
    };
  }

  const legacyChat = await readWebDavText("chat.json");
  if (!legacyChat.ok) {
    return {
      payload: null,
      sourceFiles: [
        {
          path: "chat-index.json",
          status: "missing",
          sizeBytes: 0,
        },
        {
          path: "chat.json",
          status: "missing",
          sizeBytes: 0,
        },
      ],
    };
  }

  return {
    payload: JSON.parse(legacyChat.text),
    sourceFiles: [
      {
        path: "chat-index.json",
        status: "missing",
        sizeBytes: 0,
        note: "已回退到 legacy chat.json",
      },
      {
        path: "chat.json",
        status: "imported",
        sizeBytes: legacyChat.sizeBytes,
      },
    ],
  };
}

async function loadConfigStore(): Promise<{
  payload: unknown | null;
  sourceFiles: SourceFileReport[];
}> {
  const configFile = await readWebDavText("config.json");
  if (!configFile.ok) {
    return {
      payload: null,
      sourceFiles: [
        {
          path: "config.json",
          status: "missing",
          sizeBytes: 0,
        },
      ],
    };
  }

  const configState = JSON.parse(configFile.text) as JsonObject;
  const sourceFiles: SourceFileReport[] = [
    {
      path: "config.json",
      status: "imported",
      sizeBytes: configFile.sizeBytes,
    },
  ];

  let modelsState: JsonObject[] = [];
  const modelsIndexFile = await readWebDavText(`${MODELS_DIR}/index.json`);

  if (modelsIndexFile.ok) {
    sourceFiles.push({
      path: `${MODELS_DIR}/index.json`,
      status: "imported",
      sizeBytes: modelsIndexFile.sizeBytes,
    });

    const modelsIndex = JSON.parse(modelsIndexFile.text) as {
      entries?: Array<{ providerId?: string; filePath?: string }>;
    };
    const entries = Array.isArray(modelsIndex.entries) ? modelsIndex.entries : [];

    const providerModels = await Promise.all(
      entries.map(async (entry) => {
        const filePath = entry.filePath || `${MODELS_DIR}/unknown.json`;
        const modelsFile = await readWebDavText(filePath);

        if (!modelsFile.ok) {
          sourceFiles.push({
            path: filePath,
            status: "missing",
            sizeBytes: 0,
            note: entry.providerId || "",
          });
          return [];
        }

        sourceFiles.push({
          path: filePath,
          status: "imported",
          sizeBytes: modelsFile.sizeBytes,
          note: entry.providerId || "",
        });

        const parsed = JSON.parse(modelsFile.text);
        return Array.isArray(parsed) ? parsed : [];
      }),
    );

    modelsState = providerModels.flat();
  } else {
    const legacyModelsFile = await readWebDavText("models.json");
    if (legacyModelsFile.ok) {
      sourceFiles.push({
        path: "models.json",
        status: "imported",
        sizeBytes: legacyModelsFile.sizeBytes,
        note: "已回退到 legacy models.json",
      });
      modelsState = JSON.parse(legacyModelsFile.text);
    } else {
      sourceFiles.push({
        path: `${MODELS_DIR}/index.json`,
        status: "missing",
        sizeBytes: 0,
      });
      sourceFiles.push({
        path: "models.json",
        status: "missing",
        sizeBytes: 0,
      });
      modelsState = extractEmbeddedModels(configState);
      if (modelsState.length > 0) {
        sourceFiles.push({
          path: "config.json#models",
          status: "imported",
          sizeBytes: Buffer.byteLength(JSON.stringify(modelsState)),
          note: "已回退到 config.json 内嵌 models",
        });
      }
    }
  }

  return {
    payload: {
      ...configState,
      models: Array.isArray(modelsState) ? modelsState : [],
    },
    sourceFiles,
  };
}

async function loadWebDavStore(storeKey: StoreKey) {
  switch (storeKey) {
    case StoreKey.Chat:
      return loadChatStore();
    case StoreKey.Config:
      return loadConfigStore();
    case StoreKey.Access:
    case StoreKey.Mask:
    case StoreKey.Prompt:
      return loadDirectStore(storeKey);
    default:
      return {
        payload: null,
        sourceFiles: [],
      };
  }
}

async function migrateWebDavStores() {
  const targetStoreKeys: Array<keyof typeof STORE_PERSIST_VERSION> = [
    StoreKey.Chat,
    StoreKey.Access,
    StoreKey.Config,
    StoreKey.Mask,
    StoreKey.Prompt,
  ];

  const reports: StoreMigrationReport[] = [];
  const payloads = new Map<StoreKey, unknown>();

  for (const storeKey of targetStoreKeys) {
    try {
      const { payload, sourceFiles } = await loadWebDavStore(storeKey);
      if (payload == null) {
        reports.push({
          storeKey,
          status: "skipped",
          payloadBytes: 0,
          sourceFiles,
          note: "WebDAV 中未找到可迁移的数据",
        });
        continue;
      }

      payloads.set(storeKey, wrapPersistedState(storeKey, payload));
      reports.push({
        storeKey,
        status: "imported",
        payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
        sourceFiles,
      });
    } catch (error) {
      reports.push({
        storeKey,
        status: "failed",
        payloadBytes: 0,
        sourceFiles: [],
        note: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const failed = reports.filter((item) => item.status === "failed");
  if (failed.length > 0) {
    throw new Error(
      `WebDAV 迁移预检查失败: ${failed.map((item) => `${item.storeKey}: ${item.note}`).join("; ")}`,
    );
  }

  for (const [storeKey, payload] of payloads.entries()) {
    await setStoreSnapshot(storeKey, payload);
  }

  const summary = {
    migratedAt: new Date().toISOString(),
    webdavBaseUrl: getWebDavBaseUrl(),
    database: process.env.PGDATABASE || "",
    importedStoreCount: reports.filter((item) => item.status === "imported").length,
    skippedStoreCount: reports.filter((item) => item.status === "skipped").length,
    reports,
  };

  writeFileSync(DEFAULT_REPORT_PATH, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

migrateWebDavStores().catch((error) => {
  console.error(
    `[WebDAV Migration] 失败: ${error instanceof Error ? error.stack || error.message : String(error)}`,
  );
  process.exit(1);
});
