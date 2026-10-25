import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";

export interface NodeR2HttpMetadata {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}

export interface NodeR2ObjectMeta {
  key: string;
  size: number;
  etag?: string;
  httpEtag?: string;
  uploaded: Date;
  httpMetadata?: NodeR2HttpMetadata;
  customMetadata?: Record<string, string>;
}

export interface NodeR2ObjectBody extends NodeR2ObjectMeta {
  body: ReadableStream<Uint8Array>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  writeHttpMetadata(headers: Headers): void;
}

export interface NodeR2Bucket {
  get(key: string): Promise<NodeR2ObjectBody | null>;
  put(
    key: string,
    value: any,
    options?: {
      httpMetadata?: NodeR2HttpMetadata;
      customMetadata?: Record<string, string>;
    }
  ): Promise<NodeR2ObjectMeta>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    delimiter?: string;
  }): Promise<{
    objects: NodeR2ObjectMeta[];
    truncated: boolean;
    cursor?: string;
    delimitedPrefixes: string[];
  }>;
}

/**
 * Creates a local disk-backed R2Bucket compatibility adapter.
 */
export function createLocalR2Bucket(rootDir: string): NodeR2Bucket {
  const absRoot = resolve(rootDir);
  if (!existsSync(absRoot)) {
    mkdirSync(absRoot, { recursive: true });
  }

  function resolvePath(key: string): { dataPath: string; metaPath: string } | null {
    // Normalise and prevent path traversal
    const safeKey = key.replace(/\\/g, "/").replace(/^\/+/, "");
    const dataPath = resolve(absRoot, safeKey);
    if (!dataPath.startsWith(absRoot + sep) && dataPath !== absRoot) {
      return null;
    }
    const metaPath = dataPath + ".__meta__.json";
    return { dataPath, metaPath };
  }

  return {
    async get(key: string): Promise<NodeR2ObjectBody | null> {
      const paths = resolvePath(key);
      if (!paths || !existsSync(paths.dataPath)) {
        return null;
      }

      const st = statSync(paths.dataPath);
      if (!st.isFile()) return null;

      let meta: { httpMetadata?: NodeR2HttpMetadata; customMetadata?: Record<string, string> } = {};
      if (existsSync(paths.metaPath)) {
        try {
          meta = JSON.parse(readFileSync(paths.metaPath, "utf8"));
        } catch {}
      }

      const etag = `"${st.mtimeMs.toString(16)}-${st.size.toString(16)}"`;

      return {
        key,
        size: st.size,
        etag,
        httpEtag: etag,
        uploaded: st.mtime,
        httpMetadata: meta.httpMetadata,
        customMetadata: meta.customMetadata,
        get body() {
          const buf = readFileSync(paths.dataPath);
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(buf));
              controller.close();
            },
          });
        },
        async text() {
          return readFileSync(paths.dataPath, "utf8");
        },
        async arrayBuffer() {
          const buf = readFileSync(paths.dataPath);
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        },
        writeHttpMetadata(headers: Headers) {
          if (!meta.httpMetadata) return;
          const hm = meta.httpMetadata;
          if (hm.contentType) headers.set("content-type", hm.contentType);
          if (hm.cacheControl) headers.set("cache-control", hm.cacheControl);
          if (hm.contentDisposition) headers.set("content-disposition", hm.contentDisposition);
          if (hm.contentEncoding) headers.set("content-encoding", hm.contentEncoding);
          if (hm.contentLanguage) headers.set("content-language", hm.contentLanguage);
        },
      };
    },

    async put(key: string, value: any, options = {}) {
      const paths = resolvePath(key);
      if (!paths) throw new Error("Invalid key outside storage root");

      mkdirSync(dirname(paths.dataPath), { recursive: true });

      // Convert value into Uint8Array / Buffer
      let bytes: Uint8Array;
      if (typeof value === "string") {
        bytes = new Uint8Array(Buffer.from(value, "utf8"));
      } else if (value instanceof Uint8Array) {
        bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      } else if (value instanceof ArrayBuffer) {
        bytes = new Uint8Array(value);
      } else if (value && typeof value.arrayBuffer === "function") {
        bytes = new Uint8Array(await value.arrayBuffer());
      } else if (value && typeof value.getReader === "function") {
        const reader = value.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          chunks.push(chunk);
          total += chunk.length;
        }
        bytes = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          bytes.set(c, offset);
          offset += c.length;
        }
      } else {
        bytes = new Uint8Array(Buffer.from(String(value ?? "")));
      }

      writeFileSync(paths.dataPath, bytes);

      const meta = {
        httpMetadata: options.httpMetadata,
        customMetadata: options.customMetadata,
      };
      writeFileSync(paths.metaPath, JSON.stringify(meta), "utf8");

      return {
        key,
        size: bytes.length,
        uploaded: new Date(),
        httpMetadata: options.httpMetadata,
        customMetadata: options.customMetadata,
      };
    },

    async delete(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) {
        const paths = resolvePath(k);
        if (!paths) continue;
        if (existsSync(paths.dataPath)) {
          try { unlinkSync(paths.dataPath); } catch {}
        }
        if (existsSync(paths.metaPath)) {
          try { unlinkSync(paths.metaPath); } catch {}
        }
      }
    },

    async list(options = {}) {
      const prefix = options.prefix || "";
      const limit = options.limit || 1000;
      const allFiles: string[] = [];

      function walkDir(dir: string) {
        if (!existsSync(dir)) return;
        for (const ent of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, ent.name);
          if (ent.isDirectory()) {
            walkDir(full);
          } else if (ent.isFile() && !ent.name.endsWith(".__meta__.json")) {
            const relKey = relative(absRoot, full).split(sep).join("/");
            allFiles.push(relKey);
          }
        }
      }

      walkDir(absRoot);

      const filtered = allFiles
        .filter((k) => k.startsWith(prefix))
        .sort()
        .slice(0, limit);

      const objects: NodeR2ObjectMeta[] = [];
      for (const key of filtered) {
        const paths = resolvePath(key);
        if (!paths || !existsSync(paths.dataPath)) continue;
        const st = statSync(paths.dataPath);
        let meta: any = {};
        if (existsSync(paths.metaPath)) {
          try { meta = JSON.parse(readFileSync(paths.metaPath, "utf8")); } catch {}
        }
        objects.push({
          key,
          size: st.size,
          uploaded: st.mtime,
          httpMetadata: meta.httpMetadata,
          customMetadata: meta.customMetadata,
        });
      }

      return {
        objects,
        truncated: false,
        delimitedPrefixes: [],
      };
    },
  };
}
