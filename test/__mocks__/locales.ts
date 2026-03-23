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
export const ALL_LANG_OPTIONS = { en: "English" };

export function changeLang() {}

export function getLang() {
  return "en";
}

export default Locale;
