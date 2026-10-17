import { CSSProperties } from "react";

type ChatMessageProps = {
  message: string;
  accentColor: string;
  name: string;
  isSelf: boolean;
  hideName?: boolean;
  // Font size/family chosen in the chat toolbar (ChatTile).
  textStyle?: CSSProperties;
};

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export const ChatMessage = ({
  name,
  message,
  accentColor,
  isSelf,
  hideName,
  textStyle,
}: ChatMessageProps) => {
  // The whole block (sender name + text + padding) follows the message's
  // language, so Arabic messages sit fully right-aligned, not just the text.
  const rtl = ARABIC.test(message);
  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      className={`flex flex-col gap-1 px-2 ${rtl ? "text-right" : "text-left"} ${
        hideName ? "pt-0" : "pt-6"
      }`}
    >
      {!hideName && (
        <div
          className={`text-${
            isSelf ? "gray-700" : accentColor + "-800 text-ts-" + accentColor
          } uppercase text-xs`}
        >
          {name}
        </div>
      )}
      <div
        // No glow drop-shadow and a darker accent shade: on the light theme
        // the glow blurred the text and the 500 shade was low-contrast.
        className={`text-${
          isSelf ? "gray-300" : accentColor + "-700"
        } whitespace-pre-line`}
        style={textStyle}
      >
        {message}
      </div>
    </div>
  );
};
