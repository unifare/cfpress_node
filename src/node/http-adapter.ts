import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

/**
 * Converts a Node.js IncomingMessage into a Web Standard Request.
 */
export function nodeToWebRequest(req: IncomingMessage): Request {
  const host = req.headers.host || "localhost:8080";
  const protocol = (req.socket as any)?.encrypted ? "https:" : "http:";
  const url = `${protocol}//${host}${req.url}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  const method = req.method ? req.method.toUpperCase() : "GET";
  const hasBody = method !== "GET" && method !== "HEAD";

  const init: RequestInit & { duplex?: string } = {
    method,
    headers,
  };

  if (hasBody) {
    if (typeof (Readable as any).toWeb === "function") {
      init.body = (Readable as any).toWeb(req);
      init.duplex = "half";
    } else {
      // Fallback for older streams
      init.body = new ReadableStream({
        start(controller) {
          req.on("data", (chunk) => controller.enqueue(chunk));
          req.on("end", () => controller.close());
          req.on("error", (err) => controller.error(err));
        },
      });
      init.duplex = "half";
    }
  }

  return new Request(url, init);
}

/**
 * Sends a Web Standard Response through Node.js ServerResponse.
 */
export async function sendWebResponse(webRes: Response, nodeRes: ServerResponse): Promise<void> {
  nodeRes.statusCode = webRes.status;

  // Handle multi-value headers, especially Set-Cookie
  if (typeof (webRes.headers as any).getSetCookie === "function") {
    const cookies = (webRes.headers as any).getSetCookie();
    if (cookies && cookies.length > 0) {
      nodeRes.setHeader("set-cookie", cookies);
    }
  }

  webRes.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "set-cookie") {
      // Handled above via getSetCookie if available
      if (typeof (webRes.headers as any).getSetCookie !== "function") {
        nodeRes.setHeader(key, value);
      }
    } else if (lower === "content-length") {
      // Upstream Content-Length can become stale if intermediate layers rewrite the body
      // (e.g. serveAdminIndex injecting script tags while preserving headers).
      // Leaving it out allows Node.js to stream the full body via chunked encoding without truncation.
    } else {
      nodeRes.setHeader(key, value);
    }
  });

  if (webRes.status === 204 || webRes.status === 304 || !webRes.body) {
    nodeRes.end();
    return;
  }

  if (typeof (Readable as any).fromWeb === "function") {
    const nodeStream = (Readable as any).fromWeb(webRes.body);
    nodeStream.pipe(nodeRes);
  } else {
    const reader = webRes.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        nodeRes.write(value);
      }
    } finally {
      nodeRes.end();
    }
  }
}
