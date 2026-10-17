import { useWindowResize } from "@/hooks/useWindowResize";
import { useCallback, useEffect, useRef, useState } from "react";

type ChatMessageInput = {
  placeholder: string;
  accentColor: string;
  height: number;
  onSend?: (message: string) => void;
  extraButton?: React.ReactNode;
  // Font size/family chosen in the chat toolbar (ChatTile).
  textStyle?: React.CSSProperties;
};

export const ChatMessageInput = ({
  placeholder,
  accentColor,
  height,
  onSend,
  extraButton,
  textStyle,
}: ChatMessageInput) => {
  const [message, setMessage] = useState("");
  const [inputTextWidth, setInputTextWidth] = useState(0);
  const [inputWidth, setInputWidth] = useState(0);
  const hiddenInputRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const windowSize = useWindowResize();
  const [isTyping, setIsTyping] = useState(false);
  const [inputHasFocus, setInputHasFocus] = useState(false);

  const handleSend = useCallback(() => {
    if (!onSend) {
      return;
    }
    if (message === "") {
      return;
    }

    onSend(message);
    setMessage("");
  }, [onSend, message]);

  useEffect(() => {
    setIsTyping(true);
    const timeout = setTimeout(() => {
      setIsTyping(false);
    }, 500);

    return () => clearTimeout(timeout);
  }, [message]);

  useEffect(() => {
    if (hiddenInputRef.current) {
      setInputTextWidth(hiddenInputRef.current.clientWidth);
    }
  }, [hiddenInputRef, message]);

  useEffect(() => {
    if (inputRef.current) {
      setInputWidth(inputRef.current.clientWidth);
    }
  }, [hiddenInputRef, message, windowSize.width]);

  return (
    <div
      className="flex flex-col gap-2 border-t border-t-gray-800"
      style={{ height: height }}
    >
      <div className="flex flex-row pt-3 gap-2 items-center relative">
        {/* Native caret instead of the playground's fake block cursor: the
            fake one is positioned left-to-right only and lands in the wrong
            place for Arabic (right-to-left) text. */}
        <input
          ref={inputRef}
          dir="auto"
          className={`w-full bg-transparent opacity-60 text-gray-200 p-2 px-3 rounded-sm border border-gray-800 focus:opacity-100 focus:outline-none focus:border-${accentColor}-700 focus:ring-1 focus:ring-${accentColor}-700`}
          style={{ ...textStyle, caretColor: "currentColor" }}
          placeholder={placeholder}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
          }}
          onFocus={() => {
            setInputHasFocus(true);
          }}
          onBlur={() => {
            setInputHasFocus(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSend();
            }
          }}
        ></input>
        <span
          ref={hiddenInputRef}
          className="absolute top-0 left-0 text-xs pl-3 text-amber-500 pointer-events-none opacity-0"
        >
          {message.replaceAll(" ", "\u00a0")}
        </span>
        {extraButton}
        <button
          disabled={message.length === 0 || !onSend}
          onClick={handleSend}
          className={`text-sm uppercase text-${accentColor}-500 hover:bg-${accentColor}-950 p-2 rounded-md opacity-${
            message.length > 0 ? 100 : 25
          } pointer-events-${message.length > 0 ? "auto" : "none"}`}
        >
          Send
        </button>
      </div>
    </div>
  );
};
