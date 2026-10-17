import { AttachmentButton } from "@/components/chat/AttachmentButton";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { ChatMessageInput } from "@/components/chat/ChatMessageInput";
import { useScreen } from "@/hooks/useScreen";
import { FONT_OPTIONS } from "@/lib/screen";
import { ReceivedMessage } from "@livekit/components-react";
import { CSSProperties, useEffect, useRef, useState } from "react";

const inputHeight = 56;

// A-/A+ bounds and step, in px. The starting size and font come from the
// screen's admin config.
const MIN_SIZE = 12;
const MAX_SIZE = 40;
const STEP = 2;

type Prefs = { size: number; font: string };

// A visitor's own A-/A+ and font choice, kept per screen in this browser. The
// key includes the config's updatedAt, so when an admin changes the screen
// every device starts again from the admin's new defaults.
function prefsKey(screenId: string, updatedAt?: string) {
  return `chat_prefs:${screenId}:${updatedAt ?? ""}`;
}
function loadPrefs(key: string): Partial<Prefs> {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
  } catch {
    return {};
  }
}
function savePrefs(key: string, prefs: Prefs) {
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {}
}

type ChatTileProps = {
  messages: ReceivedMessage[];
  accentColor: string;
  onSend?: (message: string) => Promise<ReceivedMessage>;
};

export const ChatTile = ({ messages, accentColor, onSend }: ChatTileProps) => {
  const screen = useScreen();
  const key = prefsKey(screen.id, screen.updatedAt);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(screen.fontSize);
  const [font, setFont] = useState(screen.fontFamily);

  useEffect(() => {
    const saved = loadPrefs(key);
    const savedSize = Number(saved.size);
    setSize(
      Number.isFinite(savedSize) && savedSize >= MIN_SIZE && savedSize <= MAX_SIZE
        ? savedSize
        : screen.fontSize,
    );
    setFont(
      FONT_OPTIONS.some((f) => f.value === saved.font) ? (saved.font as string) : screen.fontFamily,
    );
  }, [key, screen.fontSize, screen.fontFamily]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [containerRef, messages, size, font]);

  const changeSize = (delta: number) => {
    const next = Math.max(MIN_SIZE, Math.min(MAX_SIZE, size + delta));
    setSize(next);
    savePrefs(key, { size: next, font });
  };
  const changeFont = (next: string) => {
    setFont(next);
    savePrefs(key, { size, font: next });
  };

  const textStyle: CSSProperties = { fontSize: `${size}px`, lineHeight: 1.6, fontFamily: font };
  const buttonClass =
    "px-2 py-1 rounded-sm border border-gray-800 text-gray-300 hover:bg-gray-900 disabled:opacity-30";

  return (
    <div className="flex flex-col gap-2 w-full h-full">
      <div className="flex items-center justify-end gap-2 text-xs">
        <button
          type="button"
          className={buttonClass}
          onClick={() => changeSize(-STEP)}
          disabled={size <= MIN_SIZE}
          aria-label="Smaller text"
          title="تصغير الخط"
        >
          A−
        </button>
        <button
          type="button"
          className={`${buttonClass} text-sm`}
          onClick={() => changeSize(STEP)}
          disabled={size >= MAX_SIZE}
          aria-label="Larger text"
          title="تكبير الخط"
        >
          A+
        </button>
        <select
          value={font}
          onChange={(e) => changeFont(e.target.value)}
          className="bg-gray-950 border border-gray-800 text-gray-300 rounded-sm px-1 py-1"
          aria-label="Font"
          title="نوع الخط"
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f.label} value={f.value} style={{ fontFamily: f.value }}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <div
        ref={containerRef}
        className="overflow-y-auto"
        style={{
          height: `calc(100% - ${inputHeight + 40}px)`,
        }}
      >
        <div className="flex flex-col min-h-full justify-end">
          {messages.map((message, index, allMsg) => {
            const hideName =
              index >= 1 && allMsg[index - 1].from === message.from;

            return (
              <ChatMessage
                key={index}
                hideName={hideName}
                name={message.from?.name ?? ""}
                message={message.message}
                isSelf={message.from?.isLocal ?? false}
                accentColor={accentColor}
                textStyle={textStyle}
              />
            );
          })}
        </div>
      </div>
      <ChatMessageInput
        height={inputHeight}
        placeholder="اكتب رسالتك هنا"
        accentColor={accentColor}
        onSend={onSend}
        extraButton={<AttachmentButton accentColor={accentColor} />}
        textStyle={textStyle}
      />
    </div>
  );
};
