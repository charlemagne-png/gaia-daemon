// Pasted-file attachment helpers shared by the upload/serve routes, the room
// service, and the harness translators. Files live under <room>/files/ with a
// server-issued id as the on-disk name; clients only ever reference
// attachments by that id, never by path (the daemon re-resolves inside the
// room dir, so a request can't reach elsewhere).

import { readFile } from "node:fs/promises";
import { resizeImage } from "@earendil-works/pi-coding-agent";
import type { MessageAttachment } from "./types.js";

/** Largest single pasted file the upload route accepts (25 MiB). */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** Keep the original filename readable on disk but shell/path-safe: strip
 * directories, replace anything exotic, never a dotfile, bounded length. */
export function sanitizeAttachmentName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^[._]+/, "");
  return (safe || "file").slice(0, 80);
}

const ATTACHMENT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};

/** Content type by extension; unknown extensions serve as octet-stream. */
export function attachmentMime(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot >= 0 ? ATTACHMENT_MIME[name.slice(dot).toLowerCase()] : undefined) ?? "application/octet-stream";
}

/** The image formats every provider's native image channel accepts (anthropic
 * image blocks, pi ImageContent, codex localImage). Anything else stays a
 * path breadcrumb the agent can open with its file tools. */
const NATIVE_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** The attachments a harness should feed its native image channel. */
export function nativeImageAttachments(attachments: MessageAttachment[] | undefined): MessageAttachment[] {
  return (attachments ?? []).filter((file) => NATIVE_IMAGE_MIMES.has(file.mime));
}

/** Native images with their bytes base64-loaded (pi/claude inline them).
 * Oversized images are downscaled ONCE here — Anthropic 400s any inline
 * image with a side >2000px on many-image requests, so the cap lives at
 * this shared layer and every harness inherits it uniformly. The resizer
 * may transcode (png↔jpeg for the byte budget), so callers must use the
 * returned `mime`, not attachment.mime. Resize failure (undecodable bytes)
 * falls back to the raw file; an unreadable file is skipped, never fatal —
 * its breadcrumb still points at the path. */
export async function loadNativeImages(
  attachments: MessageAttachment[] | undefined,
): Promise<{ attachment: MessageAttachment; base64: string; mime: string }[]> {
  const images: { attachment: MessageAttachment; base64: string; mime: string }[] = [];
  for (const attachment of nativeImageAttachments(attachments)) {
    try {
      const bytes = await readFile(attachment.path);
      const resized = await resizeImage(new Uint8Array(bytes), attachment.mime).catch(() => null);
      images.push(
        resized
          ? { attachment, base64: resized.data, mime: resized.mimeType }
          : { attachment, base64: bytes.toString("base64"), mime: attachment.mime },
      );
    } catch {
      // Breadcrumb-only fallback.
    }
  }
  return images;
}
