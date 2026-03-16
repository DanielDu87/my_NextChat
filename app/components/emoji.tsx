import EmojiPicker, {
  Emoji,
  EmojiStyle,
  Theme as EmojiTheme,
} from "emoji-picker-react";

import { ModelType } from "../store";

import BotIconDefault from "../icons/llm-icons/default.svg";
import BotIconOpenAI from "../icons/llm-icons/openai.svg";
import BotIconGemini from "../icons/llm-icons/gemini.svg";
import BotIconGemma from "../icons/llm-icons/gemma.svg";
import BotIconClaude from "../icons/llm-icons/claude.svg";
import BotIconMeta from "../icons/llm-icons/meta.svg";
import BotIconMistral from "../icons/llm-icons/mistral.svg";
import BotIconDeepseek from "../icons/llm-icons/deepseek.svg";
import BotIconMoonshot from "../icons/llm-icons/moonshot.svg";
import BotIconQwen from "../icons/llm-icons/qwen.svg";
import BotIconWenxin from "../icons/llm-icons/wenxin.svg";
import BotIconGrok from "../icons/llm-icons/grok.svg";
import BotIconHunyuan from "../icons/llm-icons/hunyuan.svg";
import BotIconDoubao from "../icons/llm-icons/doubao.svg";
import BotIconChatglm from "../icons/llm-icons/chatglm.svg";

export function getEmojiUrl(unified: string, style: EmojiStyle) {
  // Whoever owns this Content Delivery Network (CDN), I am using your CDN to serve emojis
  // Old CDN broken, so I had to switch to this one
  // Author: https://github.com/H0llyW00dzZ
  return `https://fastly.jsdelivr.net/npm/emoji-datasource-apple/img/${style}/64/${unified}.png`;
}

export function AvatarPicker(props: {
  onEmojiClick: (emojiId: string) => void;
}) {
  return (
    <EmojiPicker
      width={"100%"}
      lazyLoadEmojis
      theme={EmojiTheme.AUTO}
      getEmojiUrl={getEmojiUrl}
      onEmojiClick={(e) => {
        props.onEmojiClick(e.unified);
      }}
    />
  );
}

export function Avatar(props: { model?: ModelType; avatar?: string }) {
  let LlmIcon = BotIconDefault;
  let localIcon: string | undefined;

  if (props.model) {
    const modelName = props.model.toLowerCase();
    const localIconMap: Record<string, string> = {
      aihubmix: "/provider-icons/aihubmix.ico",
      cohere: "/provider-icons/cohere-official.ico",
      microsoft: "/provider-icons/microsoft.ico",
      minimax: "/provider-icons/minimax.ico",
      perplexity: "/provider-icons/perplexity-official.ico",
      stability: "/provider-icons/stability.webp",
      xiaomi: "/provider-icons/xiaomi.svg",
      alibaba: "/provider-icons/alibaba.svg",
      qwen: "/provider-icons/qwen-official.svg",
      iflytek: "/provider-icons/iflytek.svg",
      "01.ai": "/provider-icons/lingyi.svg",
      stepfun: "/provider-icons/stepfun.svg",
      // 官方图标（从各供应商官网下载）
      nvidia: "/provider-icons/nvidia-official.ico",
      baichuan: "/provider-icons/baichuan-official.png",
      ideogram: "/provider-icons/ideogram-official.png",
      jina: "/provider-icons/jina-official.ico",
      "jina ai": "/provider-icons/jina-official.ico",
      flux: "/provider-icons/flux-official.ico",
      meituan: "/provider-icons/meituan-official.ico",
      inclusionai: "/provider-icons/inclusionai-official.png",
      baai: "/provider-icons/baai-official.svg",
      meta: "/provider-icons/meta-official.svg",
      // 新增供应商图标
      groq: "/provider-icons/groq-official.svg",
      together: "/provider-icons/together-official.png",
      mistral: "/provider-icons/mistral-official.ico",
      upstage: "/provider-icons/upstage-official.png",
      fireworks: "/provider-icons/fireworks-official.svg",
      yuto: "/provider-icons/yuto-official.png",
    };

    if (
      modelName.startsWith("gpt") ||
      modelName.startsWith("chatgpt") ||
      modelName.startsWith("dall-e") ||
      modelName.startsWith("dalle") ||
      modelName.startsWith("o1") ||
      modelName.startsWith("o3") ||
      modelName === "openai"
    ) {
      LlmIcon = BotIconOpenAI;
    } else if (modelName.startsWith("gemini") || modelName === "google") {
      LlmIcon = BotIconGemini;
    } else if (modelName.startsWith("gemma")) {
      LlmIcon = BotIconGemma;
    } else if (modelName.startsWith("claude") || modelName === "anthropic") {
      LlmIcon = BotIconClaude;
    } else if (modelName.includes("llama") || modelName === "meta") {
      LlmIcon = BotIconMeta;
    } else if (
      modelName.startsWith("mixtral") ||
      modelName.startsWith("codestral") ||
      modelName === "mistral"
    ) {
      LlmIcon = BotIconMistral;
    } else if (modelName.includes("deepseek") || modelName === "deepseek") {
      LlmIcon = BotIconDeepseek;
    } else if (
      modelName.startsWith("moonshot") ||
      modelName.startsWith("kimi") ||
      modelName === "moonshot"
    ) {
      LlmIcon = BotIconMoonshot;
    } else if (
      modelName.startsWith("qwen") ||
      modelName === "qwen" ||
      modelName === "alibaba"
    ) {
      LlmIcon = BotIconQwen;
    } else if (
      modelName.startsWith("ernie") ||
      modelName === "baidu" ||
      modelName.includes("wenxin")
    ) {
      LlmIcon = BotIconWenxin;
    } else if (
      modelName.startsWith("grok") ||
      modelName === "grok" ||
      modelName === "xai"
    ) {
      LlmIcon = BotIconGrok;
    } else if (modelName.startsWith("hunyuan") || modelName === "tencent") {
      LlmIcon = BotIconHunyuan;
    } else if (
      modelName.startsWith("doubao") ||
      modelName.startsWith("ep-") ||
      modelName === "bytedance"
    ) {
      LlmIcon = BotIconDoubao;
    } else if (
      modelName.includes("glm") ||
      modelName.startsWith("cogview-") ||
      modelName.startsWith("cogvideox-") ||
      modelName === "zhipu"
    ) {
      LlmIcon = BotIconChatglm;
    } else if (modelName === "other") {
      LlmIcon = BotIconOpenAI;
    } else if (
      modelName === "microsoft" ||
      modelName === "nvidia" ||
      modelName === "phi"
    ) {
      LlmIcon = BotIconOpenAI;
    } else if (modelName === "cohere") {
      LlmIcon = BotIconOpenAI;
    } else if (modelName === "perplexity") {
      LlmIcon = BotIconOpenAI;
    } else if (modelName === "baichuan") {
      LlmIcon = BotIconWenxin;
    } else if (modelName === "jina ai" || modelName === "jina") {
      LlmIcon = BotIconOpenAI;
    } else if (modelName === "flux") {
      LlmIcon = BotIconOpenAI;
    } else if (modelName === "meituan") {
      LlmIcon = BotIconOpenAI;
    } else if (modelName === "inclusionai") {
      LlmIcon = BotIconOpenAI;
    } else if (modelName === "baai") {
      LlmIcon = BotIconOpenAI;
    } else if (modelName === "ideogram") {
      LlmIcon = BotIconOpenAI;
    }

    // 优先使用本地图标
    localIcon = localIconMap[modelName];

    if (localIcon) {
      return (
        <div className="no-dark">
          <img
            className="user-avatar"
            src={localIcon}
            alt={`${props.model} icon`}
            width={30}
            height={30}
          />
        </div>
      );
    }

    return (
      <div className="no-dark">
        <LlmIcon className="user-avatar" width={30} height={30} />
      </div>
    );
  }

  return (
    <div className="user-avatar">
      {props.avatar && <EmojiAvatar avatar={props.avatar} />}
    </div>
  );
}

export function EmojiAvatar(props: { avatar: string; size?: number }) {
  return (
    <Emoji
      unified={props.avatar}
      size={props.size ?? 18}
      getEmojiUrl={getEmojiUrl}
    />
  );
}
