"use client";

import { LoadingSVG } from "@/components/button/LoadingSVG";
import { ChatTile } from "@/components/chat/ChatTile";
import { ColorPicker } from "@/components/colorPicker/ColorPicker";
import { AttributesInspector } from "@/components/config/AttributesInspector";
import { AudioInputTile } from "@/components/config/AudioInputTile";
import { ConfigurationPanelItem } from "@/components/config/ConfigurationPanelItem";
import {
  EditableNameValueRow,
  NameValueRow,
} from "@/components/config/NameValueRow";
import { DebugPanel } from "@/components/debug";
import { ChromaKeyVideo } from "@/components/playground/ChromaKeyVideo";
import { DoctorCard } from "@/components/playground/DoctorCard";
import { WhatsAppHandoffCard } from "@/components/playground/WhatsAppHandoffCard";
import { PlaygroundHeader } from "@/components/playground/PlaygroundHeader";
import {
  PlaygroundTab,
  PlaygroundTabbedTile,
  PlaygroundTile,
} from "@/components/playground/PlaygroundTile";
import { useRemoteSession } from "@/hooks/useRemoteSession";
import { useConfig } from "@/hooks/useConfig";
import { useToast } from "@/components/toast/ToasterProvider";
import { useUplinkLatency } from "@/hooks/useUplinkLatency";
import { AttributeItem } from "@/lib/types";
import { PartialMessage } from "@bufbuild/protobuf";
import {
  BarVisualizer,
  RoomAudioRenderer,
  SessionProvider,
  StartAudio,
  VideoTrack,
  useAgent,
  useParticipantAttributes,
  useSession,
  useSessionMessages,
} from "@livekit/components-react";
import {
  ConnectionState,
  TokenSourceConfigurable,
  TokenSourceFetchOptions,
  Track,
} from "livekit-client";
import { RoomAgentDispatch } from "livekit-server-sdk";
import { QRCodeSVG } from "qrcode.react";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import tailwindTheme from "../../lib/tailwindTheme.preval";
import { RpcPanel } from "./RpcPanel";

export interface PlaygroundMeta {
  name: string;
  value: string;
}

export interface PlaygroundProps {
  logo?: ReactNode;
  themeColors: string[];
  tokenSource: TokenSourceConfigurable;
  agentOptions?: PartialMessage<RoomAgentDispatch>;
  autoConnect?: boolean;
}

const headerHeight = 56;

function generateRandomRoomName() {
  return `room-${Math.random().toString(36).substring(2, 10)}`;
}

export default function Playground({
  logo,
  themeColors,
  tokenSource,
  agentOptions: initialAgentOptions,
  autoConnect,
}: PlaygroundProps) {
  const { config, setUserSettings } = useConfig();
  const { setToastMessage } = useToast();

  const [rpcMethod, setRpcMethod] = useState("");
  const [rpcPayload, setRpcPayload] = useState("");
  const [hasConnected, setHasConnected] = useState(false);
  const [showSidePanel, setShowSidePanel] = useState(false);

  // User-entered room name. When empty, a random name is generated
  // in tokenFetchOptions for each session.
  const [userRoomName, setUserRoomName] = useState("");

  const [tokenFetchOptions, setTokenFetchOptions] =
    useState<TokenSourceFetchOptions>(() => {
      // Always initialize with a roomName so the SDK's token cache
      // has a non-empty key set for future equality comparisons.
      const opts: TokenSourceFetchOptions = {
        roomName: generateRandomRoomName(),
      };
      if (initialAgentOptions) {
        opts.agentName = initialAgentOptions.agentName ?? "";
        opts.agentMetadata = initialAgentOptions.metadata ?? "";
      }
      return opts;
    });

  // Store attributes as an array with stable IDs to prevent disappearing while editing
  // Initialize with one empty attribute so the inspector isn't empty on first open
  const [attributeItems, setAttributeItems] = useState<AttributeItem[]>([
    { id: `attr_initial_${Date.now()}`, key: "", value: "" },
  ]);

  const session = useSession(tokenSource, tokenFetchOptions);
  const { connectionState } = session;
  const agent = useAgent(session);
  const messages = useSessionMessages(session);

  const {
    events: clientEvents,
    overlappingSpeechEvents,
    sessionUsage,
    networkLatency,
    clearEvents,
    sendRequest,
  } = useRemoteSession(session.room);

  const uplinkLatency = useUplinkLatency(
    session.room,
    agent.internal.agentParticipant?.identity,
    sendRequest,
  );

  const localScreenTrack = session.room.localParticipant.getTrackPublication(
    Track.Source.ScreenShare,
  );

  const startSession = useCallback(() => {
    if (session.isConnected) {
      return;
    }
    // session.start() rejects when the token fetch or the room connection
    // fails; left unhandled, the mic publish just times out ~15s later with
    // the opaque "publishing rejected as engine not connected within
    // timeout". Surface the real cause instead.
    session.start().catch((e: unknown) => {
      const reason = e instanceof Error ? e.message : String(e);
      console.error("Failed to start session:", e);
      setToastMessage({
        type: "error",
        message: `Couldn't connect to the assistant: ${reason}`,
      });
    });
    setHasConnected(true);
  }, [session, setToastMessage]);

  useEffect(() => {
    if (autoConnect && !hasConnected) {
      startSession();
    }
  }, [autoConnect, hasConnected, startSession]);

  useEffect(() => {
    if (connectionState === ConnectionState.Connected) {
      session.room.localParticipant.setCameraEnabled(
        config.settings.inputs.camera,
      );
      session.room.localParticipant.setMicrophoneEnabled(
        config.settings.inputs.mic,
      );
    }
  }, [
    config.settings.inputs.camera,
    config.settings.inputs.mic,
    session.room.localParticipant,
    connectionState,
  ]);

  useEffect(() => {
    if (connectionState === ConnectionState.Disconnected) {
      clearEvents();
    }
  }, [connectionState, clearEvents]);

  const [showDebugPanel, setShowDebugPanel] = useState(false);

  useEffect(() => {
    if (connectionState === ConnectionState.Disconnected) {
      setShowDebugPanel(false);
    } else if (!showDebugPanel && clientEvents.length > 0) {
      setShowDebugPanel(true);
    }
  }, [connectionState, showDebugPanel, clientEvents.length]);

  const videoTileContent = useMemo(() => {
    const disconnectedContent = (
      <div className="flex items-center justify-center text-gray-700 text-center w-full h-full">
        No agent video track. Connect to get started.
      </div>
    );

    const loadingContent = (
      <div className="flex flex-col items-center justify-center gap-2 text-gray-700 text-center h-full w-full">
        <LoadingSVG />
        Waiting for agent video track…
      </div>
    );

    // Key out the avatar's green-screen backdrop and show the Al Salam
    // Hospital building photo through it instead of a flat color.
    const videoContent = agent.cameraTrack ? (
      <ChromaKeyVideo
        trackRef={agent.cameraTrack}
        backgroundUrl="/hospital-bg.webp"
        objectFit={config.video_fit === "cover" ? "cover" : "contain"}
      />
    ) : null;

    let content = null;
    if (connectionState === ConnectionState.Disconnected) {
      content = disconnectedContent;
    } else if (agent.cameraTrack) {
      content = videoContent;
    } else {
      content = loadingContent;
    }

    return (
      <div className="flex flex-col w-full grow text-gray-950 bg-black rounded-sm border border-gray-800 relative">
        {content}
      </div>
    );
  }, [agent.cameraTrack, config, connectionState]);

  useEffect(() => {
    document.body.style.setProperty(
      "--lk-theme-color",
      // @ts-ignore
      tailwindTheme.colors[config.settings.theme_color]["500"],
    );
    document.body.style.setProperty(
      "--lk-drop-shadow",
      `var(--lk-theme-color) 0px 0px 18px`,
    );
  }, [config.settings.theme_color]);

  const audioTileContent = useMemo(() => {
    const disconnectedContent = (
      <div className="flex flex-col items-center justify-center gap-2 text-gray-700 text-center w-full">
        No agent audio track. Connect to get started.
      </div>
    );

    const waitingContent = (
      <div className="flex flex-col items-center gap-2 text-gray-700 text-center w-full">
        <LoadingSVG />
        Waiting for agent audio track…
      </div>
    );

    const visualizerContent = (
      <div
        className={`flex items-center justify-center w-full h-48 [--lk-va-bar-width:30px] [--lk-va-bar-gap:20px] [--lk-fg:var(--lk-theme-color)]`}
      >
        <BarVisualizer
          state={agent.state}
          track={agent.microphoneTrack}
          barCount={5}
          options={{ minHeight: 20 }}
        />
      </div>
    );

    if (connectionState === ConnectionState.Disconnected) {
      return disconnectedContent;
    }

    if (!agent.microphoneTrack) {
      return waitingContent;
    }

    return visualizerContent;
  }, [agent.microphoneTrack, connectionState, agent.state]);

  const chatTileContent = useMemo(() => {
    if (agent.isConnected) {
      return (
        <ChatTile
          messages={messages.messages}
          accentColor={config.settings.theme_color}
          onSend={messages.send}
        />
      );
    }
    return <></>;
  }, [
    agent.isConnected,
    config.settings.theme_color,
    messages.messages,
    messages.send,
  ]);

  const handleRpcCall = useCallback(async () => {
    if (!agent.internal.agentParticipant) {
      throw new Error("No agent or room available");
    }

    const response = await session.room.localParticipant.performRpc({
      destinationIdentity: agent.internal.agentParticipant.identity,
      method: rpcMethod,
      payload: rpcPayload,
    });
    return response;
  }, [
    session.room.localParticipant,
    rpcMethod,
    rpcPayload,
    agent.internal.agentParticipant,
  ]);

  const handleAttributesChange = useCallback(
    (newAttributes: AttributeItem[]) => {
      // Store the full array with stable IDs to preserve attributes during editing
      setAttributeItems(newAttributes);

      // Convert to map for tokenFetchOptions, but only include non-empty keys
      // Duplicates are handled by keeping the last occurrence (later values overwrite earlier ones)
      const newAttributesMap = newAttributes.reduce(
        (acc, attr) => {
          if (attr.key && attr.key.trim() !== "") {
            acc[attr.key] = attr.value;
          }
          return acc;
        },
        {} as Record<string, string>,
      );
      setTokenFetchOptions((prev) => ({
        ...prev,
        participantAttributes: newAttributesMap,
      }));
    },
    [],
  );

  const agentAttributes = useParticipantAttributes({
    participant: agent.internal.agentParticipant ?? undefined,
  });

  const settingsTileContent = useMemo(() => {
    return (
      <div className="flex flex-col h-full w-full items-start overflow-y-auto">
        {config.description && (
          <ConfigurationPanelItem title="Description">
            {config.description}
          </ConfigurationPanelItem>
        )}

        <ConfigurationPanelItem title="Room">
          <div className="flex flex-col gap-2">
            <EditableNameValueRow
              name="Room name"
              value={
                connectionState === ConnectionState.Connected
                  ? session.room.name
                  : userRoomName
              }
              valueColor={`${config.settings.theme_color}-500`}
              onValueChange={(value) => {
                setUserRoomName(value);
                setTokenFetchOptions((prev) => ({
                  ...prev,
                  roomName: value || generateRandomRoomName(),
                }));
              }}
              placeholder="Auto"
              editable={connectionState !== ConnectionState.Connected}
            />
            <NameValueRow
              name="Status"
              value={
                connectionState === ConnectionState.Connecting ? (
                  <LoadingSVG diameter={16} strokeWidth={2} />
                ) : (
                  connectionState.charAt(0).toUpperCase() +
                  connectionState.slice(1)
                )
              }
              valueColor={
                connectionState === ConnectionState.Connected
                  ? `${config.settings.theme_color}-500`
                  : "gray-500"
              }
            />
          </div>
        </ConfigurationPanelItem>

        <ConfigurationPanelItem title="Agent">
          <div className="flex flex-col gap-2">
            <EditableNameValueRow
              name="Agent name"
              value={tokenFetchOptions?.agentName ?? ""}
              valueColor={`${config.settings.theme_color}-500`}
              onValueChange={(value) => {
                setTokenFetchOptions({
                  ...tokenFetchOptions,
                  agentName: value,
                });
              }}
              placeholder="None"
              editable={connectionState !== ConnectionState.Connected}
            />
            <NameValueRow
              name="Identity"
              value={
                agent.internal.agentParticipant ? (
                  agent.internal.agentParticipant.identity
                ) : connectionState === ConnectionState.Connected ? (
                  <LoadingSVG diameter={12} strokeWidth={2} />
                ) : (
                  "No agent connected"
                )
              }
              valueColor={
                agent.isConnected
                  ? `${config.settings.theme_color}-500`
                  : "gray-500"
              }
            />
            {connectionState === ConnectionState.Connected &&
              agent.internal.agentParticipant && (
                <AttributesInspector
                  attributes={Object.entries(
                    agentAttributes.attributes || {},
                  ).map(([key, value]) => ({
                    id: key,
                    key,
                    value: String(value),
                  }))}
                  onAttributesChange={() => {}}
                  themeColor={config.settings.theme_color}
                  disabled={true}
                />
              )}
            <p className="text-xs text-gray-500 text-right">
              Set an agent name to use{" "}
              <a
                href="https://docs.livekit.io/agents/server/agent-dispatch/#explicit"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-500 hover:text-gray-300 underline"
              >
                explicit dispatch
              </a>
              .
            </p>
          </div>
        </ConfigurationPanelItem>

        <ConfigurationPanelItem title="User">
          <div className="flex flex-col gap-2">
            <EditableNameValueRow
              name="Name"
              value={
                connectionState === ConnectionState.Connected
                  ? session.room.localParticipant.name || ""
                  : (tokenFetchOptions?.participantName ?? "")
              }
              valueColor={`${config.settings.theme_color}-500`}
              onValueChange={(value) => {
                setTokenFetchOptions({
                  ...tokenFetchOptions,
                  participantName: value,
                });
              }}
              placeholder="Auto"
              editable={connectionState !== ConnectionState.Connected}
            />
            <EditableNameValueRow
              name="Identity"
              value={
                connectionState === ConnectionState.Connected
                  ? session.room.localParticipant.identity
                  : (tokenFetchOptions?.participantIdentity ?? "")
              }
              valueColor={`${config.settings.theme_color}-500`}
              onValueChange={(value) => {
                setTokenFetchOptions({
                  ...tokenFetchOptions,
                  participantIdentity: value,
                });
              }}
              placeholder="Auto"
              editable={connectionState !== ConnectionState.Connected}
            />
            <AttributesInspector
              attributes={attributeItems}
              onAttributesChange={handleAttributesChange}
              metadata={tokenFetchOptions?.participantMetadata}
              onMetadataChange={(metadata) => {
                setTokenFetchOptions((prev) => ({
                  ...prev,
                  participantMetadata: metadata,
                }));
              }}
              themeColor={config.settings.theme_color}
              disabled={false}
              connectionState={connectionState}
            />
          </div>
        </ConfigurationPanelItem>

        {connectionState === ConnectionState.Connected &&
          config.settings.inputs.screen && (
            <ConfigurationPanelItem
              title="Screen"
              source={Track.Source.ScreenShare}
            >
              {localScreenTrack ? (
                <div className="relative">
                  <VideoTrack
                    className="rounded-sm border border-gray-800 opacity-70 w-full"
                    trackRef={
                      localScreenTrack
                        ? {
                            participant: session.room.localParticipant,
                            publication: localScreenTrack,
                            source: Track.Source.ScreenShare,
                          }
                        : undefined
                    }
                  />
                </div>
              ) : (
                <div className="flex items-center justify-center text-gray-700 text-center w-full h-full">
                  Press the button above to share your screen.
                </div>
              )}
            </ConfigurationPanelItem>
          )}
        {connectionState === ConnectionState.Connected && agent.isConnected && (
          <RpcPanel
            config={config}
            rpcMethod={rpcMethod}
            rpcPayload={rpcPayload}
            setRpcMethod={setRpcMethod}
            setRpcPayload={setRpcPayload}
            handleRpcCall={handleRpcCall}
          />
        )}
        {config.settings.inputs.camera && (
          <ConfigurationPanelItem title="Camera" source={Track.Source.Camera}>
            {session.local.cameraTrack ? (
              <div className="relative">
                <VideoTrack
                  className="rounded-sm border border-gray-800 opacity-70 w-full"
                  trackRef={session.local.cameraTrack}
                />
              </div>
            ) : null}
          </ConfigurationPanelItem>
        )}
        {config.settings.inputs.mic && (
          <ConfigurationPanelItem
            title="Microphone"
            source={Track.Source.Microphone}
          >
            {session.local.microphoneTrack ? (
              <AudioInputTile trackRef={session.local.microphoneTrack} />
            ) : null}
          </ConfigurationPanelItem>
        )}
        <div className="w-full">
          <ConfigurationPanelItem title="Color">
            <ColorPicker
              colors={themeColors}
              selectedColor={config.settings.theme_color}
              onSelect={(color) => {
                const userSettings = { ...config.settings };
                userSettings.theme_color = color;
                setUserSettings(userSettings);
              }}
            />
          </ConfigurationPanelItem>
        </div>
        {config.show_qr && (
          <div className="w-full">
            <ConfigurationPanelItem title="QR Code">
              <QRCodeSVG value={window.location.href} width="128" />
            </ConfigurationPanelItem>
          </div>
        )}
      </div>
    );
  }, [
    config,
    agent.isConnected,
    agentAttributes.attributes,
    session.room.localParticipant,
    session.room.name,
    connectionState,
    session.local.cameraTrack,
    localScreenTrack,
    session.local.microphoneTrack,
    themeColors,
    setUserSettings,
    agent.internal.agentParticipant,
    rpcMethod,
    rpcPayload,
    handleRpcCall,
    handleAttributesChange,
    attributeItems,
    tokenFetchOptions,
    setTokenFetchOptions,
    userRoomName,
  ]);

  let mobileTabs: PlaygroundTab[] = [];
  if (config.settings.outputs.video) {
    mobileTabs.push({
      title: "Video",
      content: (
        <PlaygroundTile
          className="w-full h-full grow"
          childrenClassName="justify-center"
        >
          {videoTileContent}
        </PlaygroundTile>
      ),
    });
  }

  if (config.settings.outputs.audio) {
    mobileTabs.push({
      title: "Audio",
      content: (
        <PlaygroundTile
          className="w-full h-full grow"
          childrenClassName="justify-center"
        >
          {audioTileContent}
        </PlaygroundTile>
      ),
    });
  }

  if (config.settings.chat) {
    mobileTabs.push({
      title: "Chat",
      content: chatTileContent,
    });
  }

  mobileTabs.push({
    title: "Settings",
    content: (
      <PlaygroundTile
        padding={false}
        backgroundColor="gray-950"
        className="h-full w-full basis-1/4 items-start overflow-y-auto flex"
        childrenClassName="h-full grow items-start"
      >
        {settingsTileContent}
      </PlaygroundTile>
    ),
  });

  return (
    <SessionProvider session={session}>
      <div className="flex flex-col h-full w-full">
        <PlaygroundHeader
          title={config.title}
          logo={logo}
          githubLink={config.github_link}
          height={headerHeight}
          accentColor={config.settings.theme_color}
          connectionState={connectionState}
          onConnectClicked={() => {
            if (connectionState === ConnectionState.Disconnected) {
              startSession();
            } else if (connectionState === ConnectionState.Connected) {
              session.end();
              // Generate a new random room name for next connect so the
              // SDK fetches a fresh token. User-set names are preserved.
              if (!userRoomName) {
                setTokenFetchOptions((prev) => ({
                  ...prev,
                  roomName: generateRandomRoomName(),
                }));
              }
            }
          }}
        />
        <div
          className={`flex gap-4 py-4 grow w-full overflow-hidden selection:bg-${config.settings.theme_color}-900`}
          style={{ minHeight: 0 }}
        >
          <div className="flex flex-col grow basis-1/2 gap-4 h-full lg:hidden">
            <PlaygroundTabbedTile
              className="h-full"
              tabs={mobileTabs}
              initialTab={mobileTabs.length - 1}
            />
          </div>
          {/* Split view: video on the left, chat always visible on the
              right (never hidden behind a toggle -- callers who prefer to
              type instead of speak need it in view at all times). Audio
              waveform and settings/debug stay behind the toggle popup,
              since those aren't patient-facing. */}
          {config.settings.outputs.video && (
            <div className="flex-col grow gap-4 h-full hidden lg:flex relative basis-2/3">
              <PlaygroundTile
                title="Agent Video"
                className="w-full h-full grow"
                childrenClassName="justify-center"
              >
                {videoTileContent}
              </PlaygroundTile>
              {/* Lets the caller see the system is working (searching,
                  checking availability, etc.) instead of sitting in
                  silence wondering if it's stuck. */}
              {agent.state === "thinking" && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full bg-gray-950/90 border border-gray-800 px-3 py-1.5 text-xs text-gray-200 shadow-lg backdrop-blur">
                  <span
                    className={`h-2 w-2 rounded-full bg-${config.settings.theme_color}-500 animate-pulse`}
                  />
                  جاري البحث... / Searching...
                </div>
              )}
              {/* Always visible on top of the video -- the caller should see
                  who they're booking with without an extra click. Renders
                  nothing until the agent sets a doctor_card attribute. */}
              <div className="absolute bottom-4 left-4 z-20 max-w-sm flex flex-col gap-2">
                <DoctorCard
                  rawAttribute={agentAttributes.attributes?.doctor_card}
                  themeColor={config.settings.theme_color}
                />
                <WhatsAppHandoffCard
                  rawAttribute={agentAttributes.attributes?.booking_handoff}
                  themeColor={config.settings.theme_color}
                />
                <WhatsAppHandoffCard
                  rawAttribute={agentAttributes.attributes?.reception_handoff}
                  themeColor={config.settings.theme_color}
                />
              </div>
            </div>
          )}

          {config.settings.chat && (
            <div className="hidden lg:flex flex-col h-full basis-1/3 min-w-[320px] max-w-md flex-shrink-0">
              <PlaygroundTile title="Chat" className="w-full h-full grow">
                {chatTileContent}
              </PlaygroundTile>
            </div>
          )}

          <button
            onClick={() => setShowSidePanel((v) => !v)}
            className={`hidden lg:flex fixed top-20 right-4 z-40 items-center gap-1.5 rounded-full border border-gray-800 bg-gray-950/90 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800 shadow-lg backdrop-blur`}
          >
            {showSidePanel ? "Hide" : "Show"} settings
          </button>

          {showSidePanel && (
            <>
              <div
                className="hidden lg:block fixed inset-0 z-30 bg-black/40"
                onClick={() => setShowSidePanel(false)}
              />
              <div className="hidden lg:flex flex-col gap-4 fixed top-16 right-0 bottom-0 w-full max-w-md z-40 p-4 overflow-y-auto bg-gray-950 border-l border-gray-800 shadow-2xl">
                {config.settings.outputs.audio && (
                  <PlaygroundTile
                    title="Agent Audio"
                    className="w-full flex-shrink-0"
                    childrenClassName="justify-center"
                  >
                    {audioTileContent}
                  </PlaygroundTile>
                )}
                <PlaygroundTile
                  padding={false}
                  backgroundColor="gray-950"
                  className="w-full items-start overflow-y-auto flex-shrink-0 max-h-[420px]"
                  childrenClassName="h-full grow items-start"
                >
                  {settingsTileContent}
                </PlaygroundTile>
              </div>
            </>
          )}
        </div>
        {showDebugPanel && (
          <DebugPanel
            userTrack={session.local.microphoneTrack?.publication?.track}
            agentTrack={agent.microphoneTrack?.publication?.track}
            events={clientEvents}
            overlappingSpeechEvents={overlappingSpeechEvents}
            sessionUsage={sessionUsage}
            onClearEvents={clearEvents}
            networkLatency={networkLatency}
            uplinkLatency={uplinkLatency}
          />
        )}
        <RoomAudioRenderer />
        <StartAudio label="Click to enable audio playback" />
      </div>
    </SessionProvider>
  );
}
