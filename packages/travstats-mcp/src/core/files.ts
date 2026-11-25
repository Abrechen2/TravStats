import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { ToolFailure } from "./errors";

export type FileKind = "pdf" | "image" | "eml" | "text";

export interface LoadedFile {
  /** The file's base name inside the files directory. */
  name: string;
  kind: FileKind;
  mimeType: string;
  bytes: Buffer;
}

const MB = 1024 * 1024;
/** The server's own per-format limits (documentFormats.ts); a larger file would be refused there anyway. */
export const SIZE_LIMITS: Record<FileKind, number> = {
  pdf: 10 * MB,
  image: 10 * MB,
  eml: 2 * MB,
  text: 2 * MB,
};

const startsWith = (b: Buffer, bytes: number[], offset = 0): boolean =>
  b.length >= offset + bytes.length && bytes.every((v, i) => b[offset + i] === v);
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** What the BYTES say, never the file name: a `.pdf` that is not a PDF is refused. */
export function sniff(bytes: Buffer, name: string): { kind: FileKind; mimeType: string } | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "image", mimeType: "image/jpeg" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { kind: "image", mimeType: "image/png" };
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8))
    return { kind: "image", mimeType: "image/webp" };
  if (startsWith(bytes, ascii("%PDF-"))) return { kind: "pdf", mimeType: "application/pdf" };
  // Text has no magic number; it must at least be text (no NUL in the first 64 KB) and say what it is by name.
  if (!bytes.subarray(0, 64 * 1024).includes(0)) {
    const lower = name.toLowerCase();
    if (lower.endsWith(".eml")) return { kind: "eml", mimeType: "message/rfc822" };
    if (lower.endsWith(".txt")) return { kind: "text", mimeType: "text/plain" };
  }
  return null;
}

const inside = (root: string, target: string): boolean => {
  const rel = path.relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/**
 * Reads one file from the configured directory and from nowhere else. The directory comes from
 * configuration, never from a tool argument; the name is the only thing a prompt can steer, so it
 * is resolved against the directory's real path, may not leave it (a `..` or a symlink out), may
 * not itself be a symlink, must be a regular file, and must be what its bytes say within the
 * server's size limit for that kind.
 */
export async function loadFile(filesDir: string | null, fileName: string): Promise<LoadedFile> {
  if (!filesDir)
    throw new ToolFailure(
      "config",
      "File tools are off: set TRAVSTATS_MCP_FILES_DIR to the folder the files may be read from."
    );
  if (!fileName || fileName.includes("\0"))
    throw new ToolFailure("invalid_input", "fileName is empty or contains a NUL byte.");
  let root: string;
  try {
    root = await realpath(filesDir);
  } catch {
    throw new ToolFailure("config", "TRAVSTATS_MCP_FILES_DIR does not exist.");
  }
  const wanted = path.resolve(root, fileName);
  if (!inside(root, wanted))
    throw new ToolFailure("invalid_input", "fileName must name a file inside the files directory.");
  let real: string;
  try {
    real = await realpath(wanted);
  } catch {
    throw new ToolFailure("not_found", "No such file in the files directory.");
  }
  if (!inside(root, real))
    throw new ToolFailure(
      "invalid_input",
      "fileName resolves to a place outside the files directory (a symlink?). Refused."
    );
  // O_NOFOLLOW: a last-moment swap of the file for a symlink fails at open instead of being followed.
  let handle;
  try {
    handle = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new ToolFailure("invalid_input", "The file could not be opened (is it a symlink?).");
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new ToolFailure("invalid_input", "fileName is not a regular file.");
    const ceiling = Math.max(...Object.values(SIZE_LIMITS));
    if (stat.size > ceiling)
      throw new ToolFailure("invalid_input", `The file is larger than ${ceiling / MB} MB.`);
    const bytes = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(bytes, 0, stat.size, 0);
    const content = bytes.subarray(0, bytesRead);
    const base = path.basename(real);
    const kind = sniff(content, base);
    if (!kind)
      throw new ToolFailure(
        "invalid_input",
        "The file is not a PDF, JPEG, PNG or WebP image, .eml or .txt (judged by its content, not its name)."
      );
    if (content.length > SIZE_LIMITS[kind.kind])
      throw new ToolFailure(
        "invalid_input",
        `A ${kind.kind} file may be at most ${SIZE_LIMITS[kind.kind] / MB} MB.`
      );
    return { name: base, kind: kind.kind, mimeType: kind.mimeType, bytes: content };
  } finally {
    await handle.close();
  }
}
