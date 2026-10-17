import Head from "next/head";
import { ChangeEvent, FormEvent, ReactNode, useCallback, useEffect, useState } from "react";

import {
  DEFAULT_SCREEN_ID,
  FONT_OPTIONS,
  LLM_SUGGESTIONS,
  ScreenConfig,
  VOICE_SUGGESTIONS,
  defaultScreen,
  isValidScreenId,
} from "@/lib/screen";

// /admin -- configure each avatar screen (appearance, layout, AI). Settings
// are saved through /api/admin/* and picked up by the screen on its next
// page load / call. Styled with the app's dark-first gray classes and shown
// in the light palette (data-theme="light").

type Status = { kind: "ok" | "error"; text: string } | null;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

export default function AdminPage() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    document.documentElement.dataset.theme = "light";
    fetch("/api/admin/login")
      .then(async (r) => {
        if (r.status === 503) setConfigured(false);
        const b = await r.json().catch(() => ({}));
        setLoggedIn(!!b.loggedIn);
      })
      .catch(() => setLoggedIn(false));
  }, []);

  return (
    <>
      <Head>
        <title>Avatar screens — Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="min-h-screen bg-gray-900 text-gray-200 text-sm">
        {!configured ? (
          <Centered>
            <p>ADMIN_PASSWORD is not set on the server. Set it and restart / redeploy.</p>
          </Centered>
        ) : loggedIn === null ? (
          <Centered>Loading…</Centered>
        ) : loggedIn ? (
          <Dashboard onLogout={() => setLoggedIn(false)} />
        ) : (
          <Login onLogin={() => setLoggedIn(true)} />
        )}
      </div>
    </>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center p-6">{children}</div>;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      onLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Centered>
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-gray-950 border border-gray-800 rounded-md p-6 flex flex-col gap-4 shadow-sm"
      >
        <h1 className="text-lg font-semibold text-gray-100">Avatar screens — Admin</h1>
        <label className="flex flex-col gap-1">
          <span className="text-gray-400">Password / كلمة المرور</span>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border border-gray-800 rounded px-3 py-2 bg-gray-950"
          />
        </label>
        {error && <p className="text-red-600">{error}</p>}
        <button
          disabled={busy || !password}
          className="bg-blue-600 text-[#fff] rounded px-3 py-2 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </Centered>
  );
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [screens, setScreens] = useState<ScreenConfig[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [storage, setStorage] = useState("");
  const [current, setCurrent] = useState<ScreenConfig>(defaultScreen());
  const [isNew, setIsNew] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (selectId?: string) => {
    try {
      const { screens, storage } = await api<{ screens: ScreenConfig[]; storage: string }>(
        "/api/admin/screens",
      );
      // The main screen ("/") is always listed, even before it's first saved.
      const all = screens.some((s) => s.id === DEFAULT_SCREEN_ID)
        ? screens
        : [defaultScreen(), ...screens];
      setScreens(all);
      setSavedIds(screens.map((s) => s.id));
      setStorage(storage);
      const pick = all.find((s) => s.id === selectId) ?? all[0];
      setCurrent(pick);
      setIsNew(!screens.some((s) => s.id === pick.id));
    } catch (e) {
      if ((e as Error).message.includes("Not logged in")) onLogout();
      else setStatus({ kind: "error", text: (e as Error).message });
    }
  }, [onLogout]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const set = <K extends keyof ScreenConfig>(key: K, value: ScreenConfig[K]) =>
    setCurrent((c) => ({ ...c, [key]: value }));

  const save = async () => {
    if (!isValidScreenId(current.id)) {
      setStatus({ kind: "error", text: "Screen ID: lowercase letters, digits and dashes only" });
      return;
    }
    if (isNew && current.id !== DEFAULT_SCREEN_ID && savedIds.includes(current.id)) {
      setStatus({ kind: "error", text: `A screen "${current.id}" already exists` });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await api(`/api/admin/screens/${current.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(current),
      });
      setStatus({ kind: "ok", text: "Saved. Reload the screen to apply. / تم الحفظ" });
      await refresh(current.id);
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (isNew) return;
    if (!window.confirm(`Delete screen "${current.id}"? Its link will fall back to default settings.`)) return;
    setBusy(true);
    try {
      await api(`/api/admin/screens/${current.id}`, { method: "DELETE" });
      setStatus({ kind: "ok", text: `Deleted "${current.id}"` });
      await refresh();
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const newScreen = () => {
    const id = window.prompt("New screen ID (e.g. lobby-1, er-kiosk):", "")?.trim().toLowerCase();
    if (!id) return;
    if (!isValidScreenId(id)) {
      window.alert("Use lowercase letters, digits and dashes only.");
      return;
    }
    if (screens.some((s) => s.id === id)) {
      // (includes the always-listed main screen)
      window.alert(`"${id}" already exists.`);
      return;
    }
    // Start from the current screen's settings, so a new kiosk is a quick copy.
    setCurrent({ ...current, id, name: id, updatedAt: undefined });
    setIsNew(true);
    setStatus(null);
  };

  const logout = async () => {
    await fetch("/api/admin/login", { method: "DELETE" });
    onLogout();
  };

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      const { url } = await api<{ url: string }>("/api/admin/upload", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      set("backgroundImage", url);
      setStatus({ kind: "ok", text: "Image uploaded — click Save to apply" });
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const screenUrl = current.id === DEFAULT_SCREEN_ID ? "/" : `/s/${current.id}`;

  return (
    <div className="flex flex-col lg:flex-row min-h-screen">
      <aside className="lg:w-64 bg-gray-950 border-b lg:border-b-0 lg:border-r border-gray-800 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="font-semibold text-gray-100">Screens / الشاشات</h1>
          <button onClick={logout} className="text-gray-500 hover:text-gray-200 text-xs">
            Log out
          </button>
        </div>
        <button onClick={newScreen} className="border border-gray-800 rounded px-3 py-2 hover:bg-gray-900 text-left">
          + New screen
        </button>
        <ul className="flex flex-col gap-1">
          {screens.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => {
                  setCurrent(s);
                  setIsNew(!savedIds.includes(s.id));
                  setStatus(null);
                }}
                className={`w-full text-left rounded px-3 py-2 ${
                  s.id === current.id && !isNew ? "bg-blue-600 text-[#fff]" : "hover:bg-gray-900"
                }`}
              >
                <div className="font-medium">{s.id === DEFAULT_SCREEN_ID ? "Main screen / الرئيسية" : s.name}</div>
                <div className="text-xs opacity-70">{s.id === DEFAULT_SCREEN_ID ? "/" : `/s/${s.id}`}</div>
              </button>
            </li>
          ))}
          {screens.length === 0 && <li className="text-gray-500 text-xs">No saved screens yet.</li>}
        </ul>
        <p className="mt-auto text-xs text-gray-500">Storage: {storage || "…"}</p>
      </aside>

      <main className="flex-1 p-4 lg:p-8 flex flex-col gap-6 max-w-5xl">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold text-gray-100">
            {current.name} {isNew && <span className="text-xs text-amber-600">(not saved yet)</span>}
          </h2>
          <a href={screenUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline text-xs">
            Open screen ↗
          </a>
          <div className="ml-auto flex gap-2">
            {!isNew && current.id !== DEFAULT_SCREEN_ID && (
              <button onClick={remove} disabled={busy} className="border border-red-600 text-red-600 rounded px-3 py-2">
                Delete
              </button>
            )}
            <button
              onClick={save}
              disabled={busy}
              className="bg-blue-600 text-[#fff] rounded px-4 py-2 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save / حفظ"}
            </button>
          </div>
        </div>
        {status && (
          <p className={status.kind === "ok" ? "text-green-700" : "text-red-600"}>{status.text}</p>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="General / عام">
            <Field label="Screen ID (link)">
              <input value={current.id} disabled className={inputClass + " opacity-60"} />
            </Field>
            <Field label="Name (admin only)">
              <input value={current.name} onChange={(e) => set("name", e.target.value)} className={inputClass} />
            </Field>
            <Field label="Page title / عنوان الصفحة">
              <input value={current.title} onChange={(e) => set("title", e.target.value)} className={inputClass} />
            </Field>
          </Section>

          <Section title="Appearance / المظهر">
            <Field label="Mode / الوضع">
              <Segmented
                value={current.theme}
                options={[
                  ["dark", "Dark / داكن"],
                  ["light", "Light / فاتح"],
                ]}
                onChange={(v) => set("theme", v as ScreenConfig["theme"])}
              />
            </Field>
            <Field label={`${current.fontSize}px — Chat font size / حجم الخط`}>
              <input
                type="range"
                min={12}
                max={40}
                value={current.fontSize}
                onChange={(e) => set("fontSize", Number(e.target.value))}
              />
            </Field>
            <Field label="Font / نوع الخط">
              <select value={current.fontFamily} onChange={(e) => set("fontFamily", e.target.value)} className={inputClass}>
                {FONT_OPTIONS.map((f) => (
                  <option key={f.label} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <p style={{ fontFamily: current.fontFamily, fontSize: current.fontSize }} className="mt-1" dir="rtl">
                مرحبا معك المساعد الذكي
              </p>
            </Field>
            <Field label="Background image / صورة الخلفية">
              <div className="flex gap-2">
                <input
                  value={current.backgroundImage}
                  placeholder="(default hospital photo)"
                  onChange={(e) => set("backgroundImage", e.target.value)}
                  className={inputClass}
                />
                <label className="border border-gray-800 rounded px-3 py-2 cursor-pointer hover:bg-gray-900 whitespace-nowrap">
                  Upload
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} className="hidden" />
                </label>
              </div>
            </Field>
            <Field label={`${Math.round(current.backgroundOverlay * 100)}% — Background dimming / تعتيم الخلفية`}>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(current.backgroundOverlay * 100)}
                onChange={(e) => set("backgroundOverlay", Number(e.target.value) / 100)}
              />
            </Field>
          </Section>

          <Section title="Layout / تقسيم الشاشة">
            <Field label={`Video ${current.videoPercent}% · Chat ${100 - current.videoPercent}%`}>
              <input
                type="range"
                min={30}
                max={85}
                value={current.videoPercent}
                onChange={(e) => set("videoPercent", Number(e.target.value))}
              />
            </Field>
            <Field label="Chat position / مكان الشات">
              <Segmented
                value={current.chatPosition}
                options={[
                  ["left", "Left / يسار"],
                  ["right", "Right / يمين"],
                ]}
                onChange={(v) => set("chatPosition", v as ScreenConfig["chatPosition"])}
              />
            </Field>
            <Field label="Doctor card position / مكان بطاقة الطبيب">
              <select
                value={current.cardPosition}
                onChange={(e) => set("cardPosition", e.target.value as ScreenConfig["cardPosition"])}
                className={inputClass}
              >
                <option value="bottom-left">Bottom left</option>
                <option value="bottom-right">Bottom right</option>
                <option value="top-left">Top left</option>
                <option value="top-right">Top right</option>
              </select>
            </Field>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={current.showSettingsButton}
                onChange={(e) => set("showSettingsButton", e.target.checked)}
              />
              Show the &quot;Show settings&quot; button on the screen
            </label>
            <LayoutPreview screen={current} />
          </Section>

          <Section title="AI / الذكاء الاصطناعي">
            <p className="text-xs text-gray-500">Leave a field empty to use the agent&apos;s default.</p>
            <Field label="AI agent ID / معرّف الوكيل">
              <input
                value={current.agentId}
                placeholder="e.g. alsalam"
                onChange={(e) => set("agentId", e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Avatar ID (HeyGen LiveAvatar)">
              <input value={current.avatarId} onChange={(e) => set("avatarId", e.target.value)} className={inputClass} />
            </Field>
            <Field label="AI model / نموذج الذكاء الاصطناعي">
              <input
                list="llm-models"
                value={current.llmModel}
                placeholder="default: google/gemma-4-31b-it"
                onChange={(e) => set("llmModel", e.target.value)}
                className={inputClass}
              />
              <datalist id="llm-models">
                {LLM_SUGGESTIONS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>
            <Field label="Voice / الصوت">
              <select
                value={VOICE_SUGGESTIONS.some((v) => v.value === current.ttsVoice) ? current.ttsVoice : ""}
                onChange={(e) => e.target.value && set("ttsVoice", e.target.value)}
                className={inputClass}
              >
                <option value="">Pick a voice…</option>
                {VOICE_SUGGESTIONS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
              <input
                value={current.ttsVoice}
                placeholder="or paste any Cartesia voice ID (empty = default)"
                onChange={(e) => set("ttsVoice", e.target.value)}
                className={inputClass + " mt-1"}
              />
            </Field>
            <Field label="Voice model (TTS)">
              <input
                value={current.ttsModel}
                placeholder="default: cartesia/sonic-3"
                onChange={(e) => set("ttsModel", e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Speech language (STT)">
              <input
                value={current.sttLanguage}
                placeholder="default: ar_en (Arabic + English)"
                onChange={(e) => set("sttLanguage", e.target.value)}
                className={inputClass}
              />
            </Field>
          </Section>
        </div>
      </main>
    </div>
  );
}

const inputClass = "w-full border border-gray-800 rounded px-3 py-2 bg-gray-950";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-gray-950 border border-gray-800 rounded-md p-4 flex flex-col gap-4 shadow-sm">
      <h3 className="font-semibold text-gray-100">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-gray-400 text-xs">{label}</span>
      {children}
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex rounded border border-gray-800 overflow-hidden w-fit">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 ${value === v ? "bg-blue-600 text-[#fff]" : "hover:bg-gray-900"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Miniature of the screen: video/chat split, chat side and card corner.
function LayoutPreview({ screen }: { screen: ScreenConfig }) {
  const dark = screen.theme === "dark";
  const corner: Record<string, string> = {
    "bottom-left": "bottom-1 left-1",
    "bottom-right": "bottom-1 right-1",
    "top-left": "top-1 left-1",
    "top-right": "top-1 right-1",
  };
  return (
    <div
      className="flex gap-1 p-1 rounded h-28 text-[10px]"
      style={{ background: dark ? "#111" : "#eee", flexDirection: screen.chatPosition === "left" ? "row-reverse" : "row" }}
    >
      <div
        className="relative rounded flex items-center justify-center"
        style={{ flexBasis: `${screen.videoPercent}%`, background: dark ? "#333" : "#ccc", color: dark ? "#ddd" : "#333" }}
      >
        Video
        <span
          className={`absolute ${corner[screen.cardPosition]} rounded px-1`}
          style={{ background: dark ? "#555" : "#fff", color: dark ? "#fff" : "#333" }}
        >
          card
        </span>
      </div>
      <div
        className="rounded flex items-center justify-center"
        style={{ flexBasis: `${100 - screen.videoPercent}%`, background: dark ? "#222" : "#ddd", color: dark ? "#ddd" : "#333" }}
      >
        Chat
      </div>
    </div>
  );
}
