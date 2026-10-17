import type { NextApiRequest, NextApiResponse } from "next";

import {
  adminConfigured,
  checkPassword,
  clearSessionCookie,
  isAdmin,
  setSessionCookie,
} from "@/lib/adminAuth";

// POST {password} -> logs in; DELETE -> logs out; GET -> {loggedIn}.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!adminConfigured()) {
    return res.status(503).json({ error: "ADMIN_PASSWORD is not configured on the server" });
  }
  if (req.method === "GET") {
    return res.status(200).json({ loggedIn: isAdmin(req) });
  }
  if (req.method === "DELETE") {
    clearSessionCookie(res);
    return res.status(200).json({ loggedIn: false });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).end();
  }
  if (!checkPassword(req.body?.password)) {
    // Slow down password guessing.
    await new Promise((r) => setTimeout(r, 800));
    return res.status(401).json({ error: "Wrong password" });
  }
  setSessionCookie(res);
  return res.status(200).json({ loggedIn: true });
}
