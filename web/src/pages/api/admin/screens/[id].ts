import type { NextApiRequest, NextApiResponse } from "next";

import { isAdmin } from "@/lib/adminAuth";
import { isValidScreenId } from "@/lib/screen";
import { deleteScreen, getScreen, saveScreen } from "@/lib/screenStore";

// GET / PUT / DELETE one screen config (admin only).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isAdmin(req)) return res.status(401).json({ error: "Not logged in" });
  const id = String(req.query.id || "").toLowerCase();
  if (!isValidScreenId(id)) {
    return res.status(400).json({
      error: "Screen ID must be lowercase letters, digits or dashes (max 48)",
    });
  }
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      return res.status(200).json({ screen: await getScreen(id) });
    }
    if (req.method === "PUT") {
      return res.status(200).json({ screen: await saveScreen(req.body, id) });
    }
    if (req.method === "DELETE") {
      await deleteScreen(id);
      return res.status(200).json({ deleted: id });
    }
  } catch (e) {
    console.error(`screen ${req.method} ${id} failed:`, e);
    return res.status(500).json({ error: "Storage operation failed" });
  }
  res.setHeader("Allow", "GET, PUT, DELETE");
  return res.status(405).end();
}
