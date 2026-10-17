// Server-only storage for screen configs and uploaded background images.
//
// Two interchangeable backends. SCREEN_STORAGE=filesystem|blob forces one;
// otherwise it's picked automatically:
//  - Vercel Blob, when BLOB_READ_WRITE_TOKEN is set (the Vercel deployment).
//  - A plain folder on disk otherwise (SCREEN_DATA_DIR, default ./data) --
//    for self-hosting on the client's own servers with a mounted volume.
//    Uploaded images are then served by /api/media/[file].

import { promises as fs } from "fs";
import path from "path";
import { del, get, list, put } from "@vercel/blob";

import { ScreenConfig, defaultScreen, isValidScreenId, sanitizeScreen } from "./screen";

const useBlob =
  process.env.SCREEN_STORAGE === "filesystem"
    ? false
    : process.env.SCREEN_STORAGE === "blob" || !!process.env.BLOB_READ_WRITE_TOKEN;
const DATA_DIR = path.resolve(process.env.SCREEN_DATA_DIR || path.join(process.cwd(), "data"));
const SCREENS_DIR = path.join(DATA_DIR, "screens");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

const screenPath = (id: string) => `screens/${id}.json`;

export function storageBackend(): "vercel-blob" | "filesystem" {
  return useBlob ? "vercel-blob" : "filesystem";
}

/** The stored config for `id`, or null if none was saved yet. */
export async function readScreen(id: string): Promise<ScreenConfig | null> {
  if (!isValidScreenId(id)) return null;
  try {
    if (useBlob) {
      const res = await get(screenPath(id), { access: "public", useCache: false });
      if (!res || !("stream" in res) || !res.stream) return null;
      return sanitizeScreen(JSON.parse(await new Response(res.stream).text()), id);
    }
    const raw = await fs.readFile(path.join(SCREENS_DIR, `${id}.json`), "utf8");
    return sanitizeScreen(JSON.parse(raw), id);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.error(`readScreen(${id}) failed:`, e);
    }
    return null;
  }
}

/** The config to render for `id`: stored one, else defaults. */
export async function getScreen(id: string): Promise<ScreenConfig> {
  return (await readScreen(id)) ?? defaultScreen(id);
}

export async function listScreens(): Promise<ScreenConfig[]> {
  let ids: string[] = [];
  if (useBlob) {
    const { blobs } = await list({ prefix: "screens/" });
    ids = blobs.map((b) => b.pathname.replace(/^screens\//, "").replace(/\.json$/, ""));
  } else {
    try {
      ids = (await fs.readdir(SCREENS_DIR))
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""));
    } catch {
      ids = [];
    }
  }
  const screens = await Promise.all(ids.filter(isValidScreenId).map((id) => readScreen(id)));
  return screens.filter((s): s is ScreenConfig => !!s).sort((a, b) => a.id.localeCompare(b.id));
}

export async function saveScreen(input: unknown, id: string): Promise<ScreenConfig> {
  if (!isValidScreenId(id)) throw new Error("invalid screen id");
  const screen = { ...sanitizeScreen(input, id), updatedAt: new Date().toISOString() };
  const body = JSON.stringify(screen, null, 2);
  if (useBlob) {
    await put(screenPath(id), body, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
    });
  } else {
    await fs.mkdir(SCREENS_DIR, { recursive: true });
    const tmp = path.join(SCREENS_DIR, `.${id}.json.tmp`);
    await fs.writeFile(tmp, body, "utf8");
    await fs.rename(tmp, path.join(SCREENS_DIR, `${id}.json`));
  }
  return screen;
}

export async function deleteScreen(id: string): Promise<void> {
  if (!isValidScreenId(id)) return;
  if (useBlob) {
    await del(screenPath(id));
  } else {
    await fs.rm(path.join(SCREENS_DIR, `${id}.json`), { force: true });
  }
}

export const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Store an uploaded background image; returns the URL to put in a config. */
export async function saveUpload(data: Buffer, contentType: string): Promise<string> {
  const ext = IMAGE_TYPES[contentType];
  if (!ext) throw new Error("unsupported image type");
  const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  if (useBlob) {
    const res = await put(`uploads/${name}`, data, {
      access: "public",
      addRandomSuffix: false,
      contentType,
    });
    return res.url;
  }
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOADS_DIR, name), data);
  return `/api/media/${name}`;
}
