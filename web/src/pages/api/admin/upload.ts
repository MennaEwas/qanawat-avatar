import type { NextApiRequest, NextApiResponse } from "next";

import { isAdmin } from "@/lib/adminAuth";
import { IMAGE_TYPES, saveUpload } from "@/lib/screenStore";

// POST raw image bytes (Content-Type image/jpeg|png|webp) -> {url}.
// Body parsing is off so the image arrives as-is.
export const config = { api: { bodyParser: false } };

// Vercel caps request bodies at ~4.5 MB; keep below it.
const MAX_BYTES = 4 * 1024 * 1024;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isAdmin(req)) return res.status(401).json({ error: "Not logged in" });
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  const contentType = String(req.headers["content-type"] || "").split(";")[0].trim();
  if (!IMAGE_TYPES[contentType]) {
    return res.status(415).json({ error: "Use a JPG, PNG or WebP image" });
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) {
      return res.status(413).json({ error: "Image is larger than 4 MB" });
    }
    chunks.push(chunk as Buffer);
  }
  try {
    const url = await saveUpload(Buffer.concat(chunks), contentType);
    return res.status(200).json({ url });
  } catch (e) {
    console.error("upload failed:", e);
    return res.status(500).json({ error: "Upload failed" });
  }
}
