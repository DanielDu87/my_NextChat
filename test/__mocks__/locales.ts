const Locale = {
  Error: {
    Unauthorized: "Unauthorized",
  },
  Store: {
    DefaultTopic: "New Chat",
    BotHello: "Hello",
    Prompt: {
      Topic: "Topic",
      History: (memoryPrompt: string) => memoryPrompt,
      Summarize: "Summarize",
    },
  },
};

export const AllLangs = ["en"] as const;
export const ALL_LANG_OPTIONS = { en: "English" } as const;
export function changeLang() {}
export function getLang() {
  return "en" as const;
}

export default Locale;
