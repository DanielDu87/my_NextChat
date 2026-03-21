const Locale = {
  Error: {
    Unauthorized: "Unauthorized",
  },
  Store: {
    DefaultTopic: "New Chat",
    BotHello: "Hello",
    Prompt: {
      Topic: "Topic",
      History: (memoryPrompt) => memoryPrompt,
      Summarize: "Summarize",
    },
  },
};

const exported = {
  __esModule: true,
  default: Locale,
  AllLangs: ["en"],
  ALL_LANG_OPTIONS: { en: "English" },
  changeLang() {},
  getLang() {
    return "en";
  },
};

module.exports = exported;
