import Fuse from "fuse.js";
import { nanoid } from "nanoid";
import { StoreKey } from "../constant";
import { safeLocalStorage } from "../utils/safe-local-storage";
import { createPersistStore } from "../utils/store";

export interface Prompt {
  id: string;
  isUser?: boolean;
  title: string;
  content: string;
  createdAt: number;
}

type PromptStoreSnapshot = {
  prompts: Record<string, Prompt>;
  deletedPromptIds: string[];
};

const PROMPT_CACHE_STORAGE_KEY = "nextchat:prompt-cache-v1";
const promptCacheStorage = safeLocalStorage();

export function persistPromptCache(state: PromptStoreSnapshot) {
  promptCacheStorage.setItem(PROMPT_CACHE_STORAGE_KEY, JSON.stringify(state));
}

export function persistPromptCacheFromState(state: {
  prompts?: Record<string, Prompt>;
  deletedPromptIds?: string[];
}) {
  persistPromptCache({
    prompts: state.prompts ?? {},
    deletedPromptIds: state.deletedPromptIds ?? [],
  });
}

export function readPromptCache(): PromptStoreSnapshot | null {
  const cachedText = promptCacheStorage.getItem(PROMPT_CACHE_STORAGE_KEY);
  if (!cachedText) return null;

  try {
    const parsed = JSON.parse(cachedText) as Partial<PromptStoreSnapshot>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      prompts: (parsed.prompts ?? {}) as Record<string, Prompt>,
      deletedPromptIds: Array.isArray(parsed.deletedPromptIds)
        ? parsed.deletedPromptIds.filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          )
        : [],
    };
  } catch {
    return null;
  }
}

export const SearchService = {
  ready: false,
  userEngine: new Fuse<Prompt>([], { keys: ["title", "content"] }),
  allPrompts: [] as Prompt[],

  init(userPrompts: Prompt[]) {
    if (this.ready) {
      this.setUserPrompts(userPrompts);
      return;
    }
    this.setUserPrompts(userPrompts);
    this.ready = true;
  },

  setUserPrompts(userPrompts: Prompt[]) {
    this.allPrompts = userPrompts.slice();
    this.userEngine.setCollection(userPrompts);
  },

  remove(id: string) {
    this.userEngine.remove((doc) => doc.id === id);
  },

  add(prompt: Prompt) {
    this.userEngine.add(prompt);
  },

  search(text: string) {
    return this.userEngine.search(text).map((v) => v.item);
  },
};

export const usePromptStore = createPersistStore(
  {
    counter: 0,
    prompts: {} as Record<string, Prompt>,
    deletedPromptIds: [] as string[],
  },

  (set, get) => ({
    add(prompt: Prompt) {
      const id = nanoid();
      const nextPrompt = {
        ...prompt,
        id,
        isUser: true,
        createdAt: Date.now(),
      };

      get().update((state) => {
        state.prompts[id] = nextPrompt;
        state.deletedPromptIds = (state.deletedPromptIds ?? []).filter(
          (deletedId) => deletedId !== id,
        );
      });

      persistPromptCache({
        prompts: get().prompts,
        deletedPromptIds: get().deletedPromptIds ?? [],
      });
      SearchService.add(nextPrompt);
      return id;
    },

    get(id: string) {
      const targetPrompt = get().prompts[id];

      return targetPrompt;
    },

    remove(id: string) {
      get().update((state) => {
        delete state.prompts[id];

        Object.entries(state.prompts).some(([key, prompt]) => {
          if (prompt.id === id) {
            delete state.prompts[key];
            return true;
          }
          return false;
        });

        state.deletedPromptIds = Array.from(
          new Set([...(state.deletedPromptIds ?? []), id]),
        );

        state.counter = get().counter + 1;
      });

      persistPromptCache({
        prompts: get().prompts,
        deletedPromptIds: get().deletedPromptIds ?? [],
      });
      SearchService.remove(id);
    },

    getUserPrompts() {
      const deletedPromptIds = new Set(get().deletedPromptIds ?? []);
      const userPrompts = Object.values(get().prompts ?? {}).filter(
        (prompt) => !deletedPromptIds.has(prompt.id),
      );
      userPrompts.sort((a, b) =>
        b.id && a.id ? b.createdAt - a.createdAt : 0,
      );
      SearchService.setUserPrompts(userPrompts);
      return userPrompts;
    },

    restorePromptCache() {
      const cached = readPromptCache();
      if (!cached) {
        return false;
      }

      get().update((state) => {
        state.prompts = cached.prompts;
        state.deletedPromptIds = cached.deletedPromptIds;
      });
      SearchService.setUserPrompts(
        Object.values(cached.prompts).filter(
          (prompt) => !cached.deletedPromptIds.includes(prompt.id),
        ),
      );
      return true;
    },

    updatePrompt(id: string, updater: (prompt: Prompt) => void) {
      const prompt = get().prompts[id] ?? {
        title: "",
        content: "",
        id,
      };

      SearchService.remove(id);
      updater(prompt);
      get().update((state) => {
        state.prompts[id] = prompt;
        state.deletedPromptIds = (state.deletedPromptIds ?? []).filter(
          (deletedId) => deletedId !== id,
        );
      });
      persistPromptCache({
        prompts: get().prompts,
        deletedPromptIds: get().deletedPromptIds ?? [],
      });
      SearchService.add(prompt);
    },

    search(text: string) {
      if (text.length === 0) {
        return this.getUserPrompts();
      }
      return this.getUserPrompts().filter((prompt) =>
        `${prompt.title}
${prompt.content}`
          .toLowerCase()
          .includes(text.toLowerCase()),
      );
    },
  }),
  {
    name: StoreKey.Prompt,
    version: 3,

    migrate(state, version) {
      const newState = JSON.parse(JSON.stringify(state)) as {
        prompts: Record<string, Prompt>;
        deletedPromptIds?: string[];
      };

      if (version < 3) {
        Object.values(newState.prompts).forEach((p) => (p.id = nanoid()));
      }

      newState.deletedPromptIds = newState.deletedPromptIds ?? [];

      return newState as any;
    },
  },
);
