import type { NextApiRequest, NextApiResponse } from "next";

import { isAdmin } from "@/lib/adminAuth";
import { listScreens, storageBackend } from "@/lib/screenStore";

// GET -> every saved screen config (admin only).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isAdmin(req)) return res.status(401).json({ error: "Not logged in" });
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ screens: await listScreens(), storage: storageBackend() });
  } catch (e) {
    console.error("list screens failed:", e);
    return res.status(500).json({ error: "Couldn't load screens" });
  }
}
