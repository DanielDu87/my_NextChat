import Locale from "../locales";

function getLocaleStoreStrings() {
  try {
    return Locale.Store;
  } catch {
    return {
      DefaultTopic: "New Chat",
      BotHello: "Hello",
    };
  }
}

export function getDefaultTopic() {
  return getLocaleStoreStrings().DefaultTopic;
}

export function getBotHelloContent() {
  return getLocaleStoreStrings().BotHello;
}

export const DEFAULT_TOPIC = getDefaultTopic();
