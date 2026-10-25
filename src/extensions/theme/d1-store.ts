/**
 * Database-backed storage for theme templates & assets.
 * Used when object storage is not configured, or as a lightweight SQL storage alternative.
 */
import { Env } from "../../shared/types";
import { safeZipPath } from "../security";
import { getDb, platformSettings, themeFiles, eq, and, asc } from "../../shared/db";

export interface D1ThemeFile {
  id: string;
  themeName: string;
  themeVersion: string;
  filePath: string;
  contentType: string;
  content: string;
  isBinary: boolean;
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
}

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tiff",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".zip", ".tar", ".gz", ".pdf",
  ".mp4", ".webm", ".mp3", ".wav", ".ogg"
]);

export function isBinaryAsset(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return false;
  return BINARY_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

export function resolveThemeContentType(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  const ext = dot !== -1 ? filePath.slice(dot).toLowerCase() : "";
  switch (ext) {
    case ".html": case ".htm": return "text/html;charset=UTF-8";
    case ".css": return "text/css;charset=UTF-8";
    case ".js": case ".mjs": return "text/javascript;charset=UTF-8";
    case ".json": return "application/json;charset=UTF-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".ico": return "image/x-icon";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    case ".ttf": return "font/ttf";
    case ".otf": return "font/otf";
    case ".eot": return "application/vnd.ms-fontobject";
    case ".txt": case ".md": return "text/plain;charset=UTF-8";
    default: return "application/octet-stream";
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Read the configured binary size limit in bytes (from platform setting theme.max_binary_size_kb).
 * Defaults to 512 KB (512 * 1024 bytes).
 */
export async function getMaxBinarySizeLimitBytes(env: Env): Promise<number> {
  const row = await getDb(env)
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, "theme.max_binary_size_kb"))
    .limit(1)
    .get();
  const parsed = parseInt(String(row?.value || "512"), 10);
  const kb = isNaN(parsed) || parsed < 0 ? 512 : parsed;
  return kb * 1024;
}

/**
 * Save a single file into theme_files table.
 * If the file is binary and exceeds maxBinaryLimitBytes, throws an Error.
 */
export async function saveThemeFileToD1(
  env: Env,
  themeName: string,
  version: string,
  relPath: string,
  bytes: Uint8Array,
  maxBinaryLimitBytes: number
): Promise<void> {
  const norm = relPath.replace(/^\.\//, "").replace(/\\/g, "/");
  if (!safeZipPath(norm)) throw new Error(`Unsafe file path: "${norm}"`);

  const isBin = isBinaryAsset(norm);
  if (isBin && bytes.byteLength > maxBinaryLimitBytes) {
    const sizeKb = (bytes.byteLength / 1024).toFixed(1);
    const limitKb = (maxBinaryLimitBytes / 1024).toFixed(0);
    throw new Error(
      `Binary file "${norm}" (${sizeKb} KB) exceeds the configured limit of ${limitKb} KB (theme.max_binary_size_kb)`
    );
  }

  const contentType = resolveThemeContentType(norm);
  let contentStr: string;
  if (isBin) {
    contentStr = bytesToBase64(bytes);
  } else {
    contentStr = new TextDecoder("utf-8").decode(bytes);
  }

  const id = `${themeName}:${norm}`;
  const nowTs = Math.floor(Date.now() / 1000);

  await env.DB.prepare(`
    INSERT INTO theme_files (id, theme_name, theme_version, file_path, content_type, content, is_binary, size_bytes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(theme_name, file_path) DO UPDATE SET
      theme_version = excluded.theme_version,
      content_type = excluded.content_type,
      content = excluded.content,
      is_binary = excluded.is_binary,
      size_bytes = excluded.size_bytes,
      updated_at = excluded.updated_at
  `).bind(
    id,
    themeName,
    version,
    norm,
    contentType,
    contentStr,
    isBin ? 1 : 0,
    bytes.byteLength,
    nowTs,
    nowTs
  ).run();
}

/**
 * Read text content of a theme file from database.
 * Returns null if not found or if the file is binary.
 */
export async function getThemeFileTextFromD1(
  env: Env,
  themeName: string,
  relPath: string
): Promise<string | null> {
  const norm = relPath.replace(/^\.\//, "").replace(/\\/g, "/");
  const row = await getDb(env)
    .select({ content: themeFiles.content, is_binary: themeFiles.is_binary })
    .from(themeFiles)
    .where(and(eq(themeFiles.theme_name, themeName), eq(themeFiles.file_path, norm)))
    .limit(1)
    .get();

  if (!row) return null;
  if (row.is_binary === 1) return null;
  return String(row.content);
}

/**
 * Read full entry of a theme file from database.
 */
export async function getThemeFileEntryFromD1(
  env: Env,
  themeName: string,
  relPath: string
): Promise<{ content: string; contentType: string; isBinary: boolean; size: number } | null> {
  const norm = relPath.replace(/^\.\//, "").replace(/\\/g, "/");
  const row = await getDb(env)
    .select({
      content: themeFiles.content,
      content_type: themeFiles.content_type,
      is_binary: themeFiles.is_binary,
      size_bytes: themeFiles.size_bytes,
    })
    .from(themeFiles)
    .where(and(eq(themeFiles.theme_name, themeName), eq(themeFiles.file_path, norm)))
    .limit(1)
    .get();

  if (!row) return null;
  return {
    content: String(row.content),
    contentType: String(row.content_type),
    isBinary: row.is_binary === 1,
    size: Number(row.size_bytes),
  };
}

/**
 * Check whether a theme has any files stored in database.
 */
export async function hasThemeFilesInD1(env: Env, themeName: string): Promise<boolean> {
  const row = await getDb(env)
    .select({ id: themeFiles.id })
    .from(themeFiles)
    .where(eq(themeFiles.theme_name, themeName))
    .limit(1)
    .get();
  return !!row;
}

/**
 * Delete all files or a specific file of a theme from database.
 */
export async function deleteThemeFilesFromD1(
  env: Env,
  themeName: string,
  relPath?: string
): Promise<void> {
  const db = getDb(env);
  if (relPath) {
    const norm = relPath.replace(/^\.\//, "").replace(/\\/g, "/");
    await db
      .delete(themeFiles)
      .where(and(eq(themeFiles.theme_name, themeName), eq(themeFiles.file_path, norm)));
  } else {
    await db.delete(themeFiles).where(eq(themeFiles.theme_name, themeName));
  }
}

/**
 * List all files stored in database for a theme.
 */
export async function listThemeFilesFromD1(
  env: Env,
  themeName: string
): Promise<Array<{ path: string; size: number; isBinary: boolean; contentType: string }>> {
  const rows = await getDb(env)
    .select({
      file_path: themeFiles.file_path,
      size_bytes: themeFiles.size_bytes,
      is_binary: themeFiles.is_binary,
      content_type: themeFiles.content_type,
    })
    .from(themeFiles)
    .where(eq(themeFiles.theme_name, themeName))
    .orderBy(asc(themeFiles.file_path))
    .all();

  return (rows || []).map((r) => ({
    path: String(r.file_path),
    size: Number(r.size_bytes),
    isBinary: r.is_binary === 1,
    contentType: String(r.content_type),
  }));
}
