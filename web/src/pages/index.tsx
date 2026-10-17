import { AnimatePresence, motion } from "framer-motion";
import { Inter } from "next/font/google";
import Head from "next/head";
import { useEffect, useState } from "react";

import { PlaygroundConnect } from "@/components/PlaygroundConnect";
import Playground from "@/components/playground/Playground";
import { PlaygroundToast, ToastType } from "@/components/toast/PlaygroundToast";
import { ConfigProvider, useConfig } from "@/hooks/useConfig";
import { ToastProvider, useToast } from "@/components/toast/ToasterProvider";
import { TokenSourceConfigurable, TokenSource } from "livekit-client";
import type { GetServerSideProps } from "next";

import { ScreenProvider, useScreen } from "@/hooks/useScreen";
import { loadScreenProps } from "@/lib/loadScreen";
import { DEFAULT_SCREEN_ID, ScreenConfig } from "@/lib/screen";

const themeColors = [
  "blue",
  "cyan",
  "violet",
  "teal",
  "green",
  "amber",
  "rose",
  "pink",
  "qanawat",
];

const Alexa360Logo = () => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src="/logo.png" alt="alexa360" className="h-8 w-auto" />
);

// Optional avatar picker. Set NEXT_PUBLIC_AVATARS to a JSON array like
// [{"id":"<anam avatarId>","name":"Mia"}, ...] to show a dropdown.
type AvatarOption = { id: string; name: string };
function readAvatarOptions(): AvatarOption[] {
  try {
    const raw = process.env.NEXT_PUBLIC_AVATARS;
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? list.filter((a) => a && a.id && a.name)
      : [];
  } catch {
    return [];
  }
}
const avatarOptions = readAvatarOptions();

function buildTokenEndpoint(screenId: string, agent: string | null, avatar: string | null) {
  const p = new URLSearchParams();
  p.set("screen", screenId);
  if (agent) p.set("agent", agent);
  if (avatar) p.set("avatar", avatar);
  const q = p.toString();
  return q ? `/api/token?${q}` : "/api/token";
}

const inter = Inter({ subsets: ["latin"] });

// Loads the screen's admin config server-side: "/" renders the "default"
// screen, /s/<id> (pages/s/[id].tsx) renders that one.
export const getServerSideProps: GetServerSideProps = async () => loadScreenProps(DEFAULT_SCREEN_ID);

export default function Home({ screen }: { screen: ScreenConfig }) {
  return (
    <ScreenProvider screen={screen}>
      <ToastProvider>
        <ConfigProvider>
          <HomeInner />
        </ConfigProvider>
      </ToastProvider>
    </ScreenProvider>
  );
}

export function HomeInner() {
  const { config } = useConfig();
  const screen = useScreen();

  // Dark/light per screen: globals.css switches the palette on this attribute.
  useEffect(() => {
    document.documentElement.dataset.theme = screen.theme;
  }, [screen.theme]);
  const { toastMessage, setToastMessage } = useToast();
  const [autoConnect, setAutoConnect] = useState(false);
  const [tokenSource, setTokenSource] = useState<
    TokenSourceConfigurable | undefined
  >(() =>
    process.env.NEXT_PUBLIC_LIVEKIT_URL
      ? TokenSource.endpoint(buildTokenEndpoint(screen.id, null, null))
      : undefined,
  );

  // `?agent=` picks the alexa360 AI agent, `?avatar=` picks the video face.
  // Read after mount (URL params aren't available during SSR/hydration).
  const [urlAgent, setUrlAgent] = useState<string | null>(null);
  const [avatarId, setAvatarId] = useState<string | null>(null);
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_LIVEKIT_URL) return;
    const params = new URLSearchParams(window.location.search);
    const agent = params.get("agent");
    const avatar =
      params.get("avatar") ||
      (avatarOptions.length ? avatarOptions[0].id : null);
    setUrlAgent(agent);
    setAvatarId(avatar);
    setTokenSource(TokenSource.endpoint(buildTokenEndpoint(screen.id, agent, avatar)));
  }, [screen.id]);

  const pickAvatar = (id: string) => {
    setAvatarId(id);
    setTokenSource(TokenSource.endpoint(buildTokenEndpoint(screen.id, urlAgent, id)));
  };

  const overlay =
    screen.theme === "light"
      ? `rgba(255,255,255,${screen.backgroundOverlay})`
      : `rgba(0,0,0,${screen.backgroundOverlay})`;

  return (
    <>
      <Head>
        <title>{screen.title || config.title}</title>
        <meta name="description" content={config.description} />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black" />
        <link rel="icon" type="image/png" href="/favicon.png" />
      </Head>
      <main
        className="relative flex flex-col justify-center px-4 items-center h-full w-full bg-black bg-cover bg-center"
        style={{
          // Screen's background image (default: hospital photo), washed
          // toward the theme's base color so the panels stay readable.
          backgroundImage: `linear-gradient(${overlay}, ${overlay}), url('${
            screen.backgroundImage || "/hospital-bg.webp"
          }')`,
        }}
      >
        {avatarOptions.length > 1 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 text-xs text-white/80">
            <span>Avatar</span>
            <select
              value={avatarId ?? ""}
              onChange={(e) => pickAvatar(e.target.value)}
              className="bg-black border border-white/20 rounded px-2 py-1 text-white"
            >
              {avatarOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <AnimatePresence>
          {toastMessage && (
            <motion.div
              className="left-0 right-0 top-0 absolute z-10"
              initial={{ opacity: 0, translateY: -50 }}
              animate={{ opacity: 1, translateY: 0 }}
              exit={{ opacity: 0, translateY: -50 }}
            >
              <PlaygroundToast />
            </motion.div>
          )}
        </AnimatePresence>
        {tokenSource ? (
          <Playground
            logo={<Alexa360Logo />}
            themeColors={themeColors}
            tokenSource={tokenSource}
            autoConnect={autoConnect}
            agentOptions={
              config.settings.agent
                ? { agentName: config.settings.agent }
                : config.agent_dispatch
            }
          />
        ) : (
          <PlaygroundConnect
            accentColor={themeColors[0]}
            onConnectClicked={(tokenSource, shouldAutoConnect) => {
              setTokenSource(tokenSource);
              if (shouldAutoConnect) {
                setAutoConnect(true);
              }
            }}
          />
        )}
      </main>
    </>
  );
}
