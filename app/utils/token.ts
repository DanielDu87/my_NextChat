type TokenizerModule = typeof import("gpt-tokenizer");

let tokenizerModulePromise: Promise<TokenizerModule> | null = null;

function loadTokenizer() {
  tokenizerModulePromise ??= import("gpt-tokenizer");
  return tokenizerModulePromise;
}

function extractTextFromContent(
  content:
    | string
    | { type: string; text?: string; image_url?: { url: string } }[],
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join(" ");
}

export async function countPromptTokens(
  messages: { role: string; content: string | any }[],
  model?: string,
): Promise<number> {
  const { encodeChat, encode } = await loadTokenizer();
  const chatMessages = messages.map((m) => ({
    role: m.role,
    content: extractTextFromContent(m.content),
  }));
  try {
    return encodeChat(chatMessages, (model || "gpt-4") as any).length;
  } catch {
    return chatMessages.reduce(
      (sum, m) => sum + encode(m.content, (model || "gpt-4") as any).length,
      0,
    );
  }
}

export async function countSystemTokens(
  messages: { role: string; content: string | any }[],
  model?: string,
): Promise<number> {
  const { encodeChat, encode } = await loadTokenizer();
  const systemMessages = messages.filter((m) => m.role === "system");
  const chatMessages = systemMessages.map((m) => ({
    role: m.role,
    content: extractTextFromContent(m.content),
  }));
  try {
    return encodeChat(chatMessages, (model || "gpt-4") as any).length;
  } catch {
    return chatMessages.reduce(
      (sum, m) => sum + encode(m.content, (model || "gpt-4") as any).length,
      0,
    );
  }
}

export async function countCompletionTokens(
  text: string,
  model?: string,
): Promise<number> {
  if (!text) return 0;
  const { encode } = await loadTokenizer();
  return (encode as any)(text, model || "gpt-4").length;
}

export function estimateTokenLength(input: string): number {
  let tokenLength = 0;

  for (let i = 0; i < input.length; i++) {
    const charCode = input.charCodeAt(i);

    if (charCode < 128) {
      // ASCII character
      if (charCode <= 122 && charCode >= 65) {
        // a-Z
        tokenLength += 0.25;
      } else {
        tokenLength += 0.5;
      }
    } else {
      // Unicode character
      tokenLength += 1.5;
    }
  }

  return tokenLength;
}
