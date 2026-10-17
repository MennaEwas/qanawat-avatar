// Per-screen configuration edited in /admin and applied by the screen page
// (/s/<id>, or / for the "default" screen) and by /api/token, which forwards
// the AI settings to the voice agent in the room metadata.
//
// Shared by client and server code -- no Node-only imports here.

export type ThemeMode = "dark" | "light";
export type ChatPosition = "right" | "left";
export type CardPosition = "bottom-left" | "bottom-right" | "top-left" | "top-right";

export interface ScreenConfig {
  id: string;
  name: string;
  title: string;
  theme: ThemeMode;
  fontSize: number; // chat text, px
  fontFamily: string; // one of FONT_OPTIONS values
  backgroundImage: string; // URL; "" = built-in hospital photo
  backgroundOverlay: number; // 0..1 darkening/lightening over the image
  videoPercent: number; // share of the width given to the avatar video (desktop)
  chatPosition: ChatPosition;
  cardPosition: CardPosition; // doctor / hand-off cards over the video
  showSettingsButton: boolean;
  // AI settings, forwarded to the agent; "" = the agent's own default.
  agentId: string; // ai_agent_ns, e.g. "alsalam"
  avatarId: string; // HeyGen LiveAvatar avatar id
  llmModel: string;
  ttsModel: string;
  ttsVoice: string;
  sttLanguage: string;
  updatedAt?: string;
}

export const DEFAULT_SCREEN_ID = "default";

export const FONT_OPTIONS = [
  { label: "Cairo", value: "'Cairo', sans-serif" },
  { label: "Tajawal", value: "'Tajawal', sans-serif" },
  { label: "Noto Kufi Arabic", value: "'Noto Kufi Arabic', sans-serif" },
  { label: "IBM Plex Sans Arabic", value: "'IBM Plex Sans Arabic', sans-serif" },
  { label: "System", value: "inherit" },
];

// Offered as suggestions in the admin form; free text is still accepted.
export const LLM_SUGGESTIONS = [
  "google/gemma-4-31b-it",
  "openai/gpt-4.1-mini",
  "openai/gpt-4.1",
  "google/gemini-2.5-flash",
];
export const VOICE_SUGGESTIONS = [
  { label: "Walid (Arabic male, warm)", value: "f1cdfb4a-bf7d-4e83-916e-8f0802278315" },
  { label: "Tariq (Arabic male, calm)", value: "db873303-3a70-4d9d-867a-0d70a6377195" },
  { label: "Zain (Arabic male, dynamic)", value: "40f9b5d1-bc79-43a6-b5cc-1c692b3b40d2" },
  { label: "Youssef (Arabic male, clear)", value: "9cbad5f7-fbf6-4416-a22f-1ecc75ad40a2" },
  { label: "Hassan (Arabic male, authoritative)", value: "664aec8a-64a4-4437-8a0b-a61aa4f51fe6" },
  { label: "Fatima (Arabic female, polite)", value: "731ace69-ee17-41bc-8c6f-665c9f1db95c" },
  { label: "Huda (Arabic female, natural)", value: "002622d8-19d0-4567-a16a-f99c7397c062" },
];

export function defaultScreen(id: string = DEFAULT_SCREEN_ID): ScreenConfig {
  return {
    id,
    name: id === DEFAULT_SCREEN_ID ? "Default screen" : id,
    title: "Alexa360 Voice Agent",
    theme: "dark",
    fontSize: 18,
    fontFamily: FONT_OPTIONS[0].value,
    backgroundImage: "",
    backgroundOverlay: 0.8,
    videoPercent: 67,
    chatPosition: "right",
    cardPosition: "bottom-left",
    showSettingsButton: true,
    agentId: "",
    avatarId: "",
    llmModel: "",
    ttsModel: "",
    ttsVoice: "",
    sttLanguage: "",
  };
}

export function isValidScreenId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,47}$/.test(id);
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Coerce untrusted input (admin form, stored JSON) into a valid config. */
export function sanitizeScreen(input: unknown, id: string): ScreenConfig {
  const d = defaultScreen(id);
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : Number(v) || fallback;
  const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
    options.includes(v as T) ? (v as T) : fallback;
  const bg = str(o.backgroundImage, 1000);
  return {
    id,
    name: str(o.name, 80) || d.name,
    title: str(o.title, 80) || d.title,
    theme: oneOf(o.theme, ["dark", "light"] as const, d.theme),
    fontSize: clamp(Math.round(num(o.fontSize, d.fontSize)), 12, 40),
    fontFamily: FONT_OPTIONS.some((f) => f.value === o.fontFamily)
      ? (o.fontFamily as string)
      : d.fontFamily,
    // Only http(s) or same-site paths -- never javascript:/data: URLs.
    backgroundImage: /^(https?:\/\/|\/)/.test(bg) ? bg : "",
    backgroundOverlay: clamp(num(o.backgroundOverlay, d.backgroundOverlay), 0, 1),
    videoPercent: clamp(Math.round(num(o.videoPercent, d.videoPercent)), 30, 85),
    chatPosition: oneOf(o.chatPosition, ["right", "left"] as const, d.chatPosition),
    cardPosition: oneOf(
      o.cardPosition,
      ["bottom-left", "bottom-right", "top-left", "top-right"] as const,
      d.cardPosition,
    ),
    showSettingsButton:
      typeof o.showSettingsButton === "boolean" ? o.showSettingsButton : d.showSettingsButton,
    agentId: str(o.agentId, 60).replace(/[^a-zA-Z0-9_-]/g, ""),
    avatarId: str(o.avatarId, 60).replace(/[^a-zA-Z0-9-]/g, ""),
    llmModel: str(o.llmModel, 100),
    ttsModel: str(o.ttsModel, 100),
    ttsVoice: str(o.ttsVoice, 100),
    sttLanguage: str(o.sttLanguage, 20),
    updatedAt: str(o.updatedAt, 40) || undefined,
  };
}

/** The AI part of a screen, as the agent reads it from the room metadata. */
export function agentRoomMetadata(s: ScreenConfig): Record<string, string> {
  const meta: Record<string, string> = {};
  if (s.agentId) meta.ai_agent_ns = s.agentId;
  if (s.avatarId) meta.avatar_id = s.avatarId;
  if (s.llmModel) meta.llm_model = s.llmModel;
  if (s.ttsModel) meta.tts_model = s.ttsModel;
  if (s.ttsVoice) meta.tts_voice = s.ttsVoice;
  if (s.sttLanguage) meta.stt_language = s.sttLanguage;
  return meta;
}
