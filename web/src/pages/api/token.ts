import { NextApiRequest, NextApiResponse } from "next";

import { TokenSourceRequestPayload } from "livekit-client";
import { AccessToken } from "livekit-server-sdk";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";

import { DEFAULT_SCREEN_ID, agentRoomMetadata, isValidScreenId } from "@/lib/screen";
import { getScreen } from "@/lib/screenStore";

const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;

// Every room explicitly dispatches the voice agent registered under this name
// (agent/src/agent.py AGENT_NAME), so unnamed workers left running elsewhere
// on the same LiveKit project never pick up calls.
const AGENT_NAME = process.env.AGENT_NAME || "alsalam-concierge";

type TokenRequest = {
  room_name: string;
  participant_identity: string;
  participant_name?: string;
  participant_metadata?: string;
  participant_attributes?: Record<string, string>;
  room_config?: ReturnType<RoomConfiguration["toJson"]>;
  // Set by this handler from the screen's admin config (see agentRoomMetadata).
  room_metadata?: string;
};

// This route handler creates a token for a given room and participant
// it's compatible with LiveKit's TokenSourceEndpoint API
async function createToken(request: TokenRequest) {
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    {
      identity: request.participant_identity,
      // Token to expire after 10 minutes
      ttl: "10m",
    },
  );

  // Token permissions can be added here based on the
  // desired capabilities of the participant
  at.addGrant({
    roomJoin: true,
    room: request.room_name,
    canUpdateOwnMetadata: true,
  });

  if (request.participant_name) {
    at.name = request.participant_name;
  }
  if (request.participant_identity) {
    at.identity = request.participant_identity;
  }
  if (request.participant_metadata) {
    at.metadata = request.participant_metadata;
  }
  if (request.participant_attributes) {
    at.attributes = request.participant_attributes;
  }
  const roomConfig = request.room_config
    ? RoomConfiguration.fromJson(request.room_config)
    : new RoomConfiguration();
  // The playground may send an agent entry with an empty name; that would
  // mean "any unnamed worker", which is exactly what we're avoiding.
  roomConfig.agents = roomConfig.agents.filter((a) => a.agentName);
  if (roomConfig.agents.length === 0) {
    roomConfig.agents = [new RoomAgentDispatch({ agentName: AGENT_NAME })];
  }
  // Always the server-side screen settings, never client-supplied metadata.
  roomConfig.metadata = request.room_metadata ?? "";
  at.roomConfig = roomConfig;

  return at.toJwt();
}

export default async function handleToken(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).end("Method Not Allowed");
    return;
  }
  if (!apiKey || !apiSecret) {
    res.statusMessage = "Environment variables aren't set up correctly";
    res.status(500).end();
    return;
  }

  const options = req.body ?? {};
  const suffix = crypto.randomUUID().substring(0, 8);

  // `?agent=<ai_agent_ns>` (or body.agent) picks which alexa360 AI agent the voice
  // worker should load. Encoded into the room name as `a360-<ns>-<suffix>`; the
  // agent parses it back out. No agent param => the worker uses its default agent.
  const qs = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v ?? "").toString().trim();

  // `?agent=<ai_agent_ns>` picks which alexa360 AI agent to load.
  const agentNs = (qs(req.query.agent) || options.agent || "").replace(
    /[^a-zA-Z0-9]/g,
    "",
  );
  // `?avatar=<anam avatarId>` picks which video avatar face to show.
  const avatarId = (qs(req.query.avatar) || options.avatar || "").replace(
    /[^a-zA-Z0-9-]/g,
    "",
  );

  options.room_name =
    options.room_name ??
    options.roomName ??
    (agentNs ? `a360-${agentNs}-${suffix}` : `room-${suffix}`);
  options.participant_identity =
    options.participant_identity ?? options.participantName ?? `user-${suffix}`;

  const attrs: Record<string, string> = { ...(options.participant_attributes ?? {}) };
  if (agentNs) attrs.agent = agentNs;
  if (avatarId) attrs.avatar = avatarId;
  if (Object.keys(attrs).length) options.participant_attributes = attrs;

  try {
    // `?screen=<id>` (default: the "default" screen) -> that screen's AI
    // settings from /admin go to the agent via the room metadata. Explicit
    // ?agent= / ?avatar= URL params still win.
    const screenId = (qs(req.query.screen) || DEFAULT_SCREEN_ID).toLowerCase();
    const screen = isValidScreenId(screenId) ? await getScreen(screenId) : null;
    const meta = screen ? agentRoomMetadata(screen) : {};
    if (agentNs) meta.ai_agent_ns = agentNs;
    if (avatarId) meta.avatar_id = avatarId;
    options.room_metadata = Object.keys(meta).length ? JSON.stringify(meta) : "";


    res.status(200).json({
      server_url: process.env.NEXT_PUBLIC_LIVEKIT_URL,
      participant_token: await createToken(options),
    });
  } catch (err) {
    console.error("Error generating token:", err);
    res.status(500).send({ message: "Generating token failed" });
  }
}
