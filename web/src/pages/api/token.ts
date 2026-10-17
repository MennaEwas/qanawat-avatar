import { NextApiRequest, NextApiResponse } from "next";

import { TokenSourceRequestPayload } from "livekit-client";
import { AccessToken } from "livekit-server-sdk";
import { RoomConfiguration } from "@livekit/protocol";

const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;
// Optional: dispatch a specific named agent deployment (e.g. the LiveKit
// Cloud one, "alsalam-concierge") into every room. Leave unset to use
// automatic dispatch -- which is what a local `uv run src/agent.py dev`
// worker registers for, so local testing reaches your local agent.
const agentName = process.env.LIVEKIT_AGENT_NAME?.trim();

type TokenRequest = {
  room_name: string;
  participant_identity: string;
  participant_name?: string;
  participant_metadata?: string;
  participant_attributes?: Record<string, string>;
  room_config?: ReturnType<RoomConfiguration["toJson"]>;
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
  if (request.room_config) {
    at.roomConfig = RoomConfiguration.fromJson(request.room_config);
  } else if (agentName) {
    at.roomConfig = new RoomConfiguration({ agents: [{ agentName }] });
  }

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
    // Shown verbatim in the browser by the token fetch -- say how to fix it.
    res.statusMessage = "Environment variables aren't set up correctly";
    res.status(500).json({
      message:
        "LIVEKIT_API_KEY / LIVEKIT_API_SECRET are not set. For local dev, " +
        "put them (and NEXT_PUBLIC_LIVEKIT_URL) in web/.env.local and " +
        "restart `npm run dev`.",
    });
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
    res.status(200).json({
      server_url: process.env.NEXT_PUBLIC_LIVEKIT_URL,
      participant_token: await createToken(options),
    });
  } catch (err) {
    console.error("Error generating token:", err);
    res.status(500).send({ message: "Generating token failed" });
  }
}
