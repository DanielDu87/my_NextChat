import React from "react";
import NextImage from "next/image";
import EmojiPicker, {
  Emoji,
  EmojiStyle,
  Theme as EmojiTheme,
} from "emoji-picker-react";

import { ModelType } from "../store";
import { getProviderIcon } from "../config/provider-icons";

export const FIXED_USER_AVATAR = "__fixed_user_avatar__";

export function getEmojiUrl(unified: string, style: EmojiStyle) {
  void style;

  const emojiText = unified
    .split("-")
    .map((code) => String.fromCodePoint(parseInt(code, 16)))
    .join("");

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="52">
        ${emojiText}
      </text>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function AvatarPicker(props: {
  onEmojiClick: (emojiId: string) => void;
}) {
  return (
    <EmojiPicker
      width={"100%"}
      lazyLoadEmojis
      theme={EmojiTheme.AUTO}
      emojiStyle={EmojiStyle.NATIVE}
      getEmojiUrl={getEmojiUrl}
      onEmojiClick={(e) => {
        props.onEmojiClick(e.unified);
      }}
    />
  );
}

export function Avatar(props: { model?: ModelType; avatar?: string }) {
  if (props.model) {
    const modelName = props.model.toLowerCase();

    const localIcon = getProviderIcon(modelName);
    if (!localIcon) {
      return (
        <div className="no-dark">
          <NextImage
            className="user-avatar"
            src="/llm-icons/default.png"
            alt="default avatar"
            width={30}
            height={30}
          />
        </div>
      );
    }

    return (
      <div className="no-dark">
        {/* eslint-disable-next-line @next/next/no-img-element */}
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
    <div
      className={
        props.avatar === FIXED_USER_AVATAR
          ? "user-avatar user-avatar-me"
          : "user-avatar"
      }
    >
      {props.avatar === FIXED_USER_AVATAR ? (
        <FixedUserAvatar />
      ) : (
        props.avatar && <EmojiAvatar avatar={props.avatar} />
      )}
    </div>
  );
}

function FixedUserAvatar() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="7.5" r="4.5" fill="currentColor" />
      <path
        d="M4.5 20C4.5 15.8579 7.85786 12.5 12 12.5C16.1421 12.5 19.5 15.8579 19.5 20"
        fill="currentColor"
      />
    </svg>
  );
}

export function EmojiAvatar(props: { avatar: string; size?: number }) {
  return (
    <Emoji
      unified={props.avatar}
      size={props.size ?? 18}
      emojiStyle={EmojiStyle.NATIVE}
      getEmojiUrl={getEmojiUrl}
    />
  );
}
