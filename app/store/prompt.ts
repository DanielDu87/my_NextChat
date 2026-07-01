import Fuse from "fuse.js";
import { nanoid } from "nanoid";
import { StoreKey } from "../constant";
import { getLang } from "../locales";
import { createPersistStore } from "../utils/store";

export interface Prompt {
  id: string;
  isUser?: boolean;
  title: string;
  content: string;
  createdAt: number;
}

export const SearchService = {
  ready: false,
  builtinEngine: new Fuse<Prompt>([], { keys: ["title", "content"] }),
  userEngine: new Fuse<Prompt>([], { keys: ["title", "content"] }),
  count: {
    builtin: 0,
  },
  allPrompts: [] as Prompt[],
  builtinPrompts: [] as Prompt[],

  init(builtinPrompts: Prompt[], userPrompts: Prompt[]) {
    if (this.ready) {
      return;
    }
    this.allPrompts = userPrompts.concat(builtinPrompts);
    this.builtinPrompts = builtinPrompts.slice();
    this.builtinEngine.setCollection(builtinPrompts);
    this.userEngine.setCollection(userPrompts);
    this.ready = true;
  },

  remove(id: string) {
    this.userEngine.remove((doc) => doc.id === id);
  },

  removeBuiltin(id: string) {
    this.builtinPrompts = this.builtinPrompts.filter((doc) => doc.id !== id);
    this.builtinEngine.remove((doc) => doc.id === id);
  },

  add(prompt: Prompt) {
    this.userEngine.add(prompt);
  },

  search(text: string) {
    const userResults = this.userEngine.search(text);
    const builtinResults = this.builtinEngine.search(text);
    return userResults.concat(builtinResults).map((v) => v.item);
  },
};

function getBuiltinPromptId(title: string, content: string, index: number) {
  const source = `${index}:${title}:${content}`;
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return `builtin-${index}-${hash.toString(36)}`;
}

export const usePromptStore = createPersistStore(
  {
    counter: 0,
    prompts: {} as Record<string, Prompt>,
    hiddenBuiltinPromptIds: [] as string[],
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

      SearchService.add(nextPrompt);
      return id;
    },

    get(id: string) {
      const targetPrompt = get().prompts[id];

      if (!targetPrompt) {
        return SearchService.builtinPrompts.find((v) => v.id === id);
      }

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

      SearchService.remove(id);
    },

    hideBuiltinPrompt(id: string) {
      get().update((state) => {
        state.hiddenBuiltinPromptIds = Array.from(
          new Set([...(state.hiddenBuiltinPromptIds ?? []), id]),
        );
        state.counter = get().counter + 1;
      });

      SearchService.removeBuiltin(id);
    },

    getUserPrompts() {
      const deletedPromptIds = new Set(get().deletedPromptIds ?? []);
      const userPrompts = Object.values(get().prompts ?? {}).filter(
        (prompt) => !deletedPromptIds.has(prompt.id),
      );
      userPrompts.sort((a, b) =>
        b.id && a.id ? b.createdAt - a.createdAt : 0,
      );
      return userPrompts;
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
      SearchService.add(prompt);
    },

    search(text: string) {
      if (text.length === 0) {
        // return all rompts
        const hiddenBuiltinPromptIds = new Set(
          get().hiddenBuiltinPromptIds ?? [],
        );
        return this.getUserPrompts().concat(
          SearchService.builtinPrompts.filter(
            (prompt) => !hiddenBuiltinPromptIds.has(prompt.id),
          ),
        );
      }
      const hiddenBuiltinPromptIds = new Set(
        get().hiddenBuiltinPromptIds ?? [],
      );
      return SearchService.search(text).filter(
        (prompt) => prompt.isUser || !hiddenBuiltinPromptIds.has(prompt.id),
      ) as Prompt[];
    },
  }),
  {
    name: StoreKey.Prompt,
    version: 3,

    migrate(state, version) {
      const newState = JSON.parse(JSON.stringify(state)) as {
        prompts: Record<string, Prompt>;
        hiddenBuiltinPromptIds?: string[];
        deletedPromptIds?: string[];
      };

      if (version < 3) {
        Object.values(newState.prompts).forEach((p) => (p.id = nanoid()));
      }

      newState.hiddenBuiltinPromptIds = newState.hiddenBuiltinPromptIds ?? [];
      newState.deletedPromptIds = newState.deletedPromptIds ?? [];

      return newState as any;
    },

    onRehydrateStorage(state) {
      // Skip store rehydration on server side
      if (typeof window === "undefined") {
        return;
      }

      const PROMPT_URL = "/prompts.json";

      type PromptList = Array<[string, string]>;

      fetch(PROMPT_URL)
        .then((res) => {
          const contentType = res.headers.get("content-type") || "";
          if (!res.ok || !contentType.includes("application/json")) {
            throw new Error(
              `[Prompt] prompts.json load failed: ${res.status} ${contentType}`,
            );
          }
          return res.json();
        })
        .then((res) => {
          const promptList: PromptList = res.cn || [];
          const hiddenBuiltinPromptIds = new Set(
            usePromptStore.getState().hiddenBuiltinPromptIds ?? [],
          );
          const builtinPrompts = promptList.map(
            ([title, content], index) =>
              ({
                id: getBuiltinPromptId(title, content, index),
                title,
                content,
                createdAt: Date.now(),
              }) as Prompt,
          );

          const userPrompts = usePromptStore.getState().getUserPrompts() ?? [];

          const allPromptsForSearch = builtinPrompts.filter(
            (v) =>
              !!v.title && !!v.content && !hiddenBuiltinPromptIds.has(v.id),
          );
          SearchService.count.builtin = promptList.length;
          SearchService.init(allPromptsForSearch, userPrompts);
        })
        .catch((error) => {
          console.warn("[Prompt] 内置提示词加载失败:", error);
        });
    },
  },
);
