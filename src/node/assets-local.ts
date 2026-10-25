import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".zip": "application/zip",
};

export interface NodeAssetsFetcher {
  fetch(input: RequestInfo | URL | string, init?: RequestInit): Promise<Response>;
}

/**
 * Creates a static assets Fetcher serving files from a local directory (e.g. `./public`).
 */
export function createLocalAssets(publicDir: string): NodeAssetsFetcher {
  const publicRoot = resolve(publicDir);

  function serveFromDisk(pathname: string, req?: Request): Response | null {
    const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
    if (rel.length === 0) return null;

    const abs = resolve(publicRoot, rel);
    if (abs !== publicRoot && !abs.startsWith(publicRoot + sep)) return null;
    if (!existsSync(abs) || !statSync(abs).isFile()) return null;

    const st = statSync(abs);
    const etag = `"${st.mtimeMs.toString(16)}-${st.size.toString(16)}"`;

    if (req) {
      const ifNoneMatch = req.headers.get("if-none-match");
      if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === "*")) {
        return new Response(null, { status: 304 });
      }
    }

    const dotIndex = abs.lastIndexOf(".");
    const ext = dotIndex !== -1 ? abs.slice(dotIndex).toLowerCase() : "";
    const contentType = MIME[ext] || "application/octet-stream";

    const content = readFileSync(abs);
    return new Response(new Uint8Array(content), {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(content.byteLength),
        "etag": etag,
        "cache-control": "public, max-age=3600",
      },
    });
  }

  return {
    async fetch(input: RequestInfo | URL | string, _init?: RequestInit): Promise<Response> {
      let pathname: string;
      let req: Request | undefined;
      try {
        if (typeof input === "string") {
          pathname = new URL(input, "http://localhost").pathname;
        } else if (input instanceof URL) {
          pathname = input.pathname;
        } else {
          req = input;
          pathname = new URL(input.url).pathname;
        }
      } catch {
        return new Response("Bad request", { status: 400 });
      }

      const res = serveFromDisk(pathname, req);
      return res || new Response("Asset not found: " + pathname, { status: 404 });
    },
  };
}
