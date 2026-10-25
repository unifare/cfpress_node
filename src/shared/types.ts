declare global {
  export interface D1Result<T = unknown> {
    results: T[];
    success: boolean;
    meta: Record<string, any>;
    error?: string;
  }

  export interface D1PreparedStatement {
    bind(...values: any[]): D1PreparedStatement;
    first<T = unknown>(colName: string): Promise<T | null>;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
    all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
    raw<T = unknown[]>(): Promise<T[]>;
  }

  export interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
    exec(query: string): Promise<{ count?: number; duration?: number; success?: boolean }>;
  }

  export interface R2HttpMetadata {
    contentType?: string;
    contentLanguage?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    cacheControl?: string;
    cacheExpiry?: Date;
  }

  export interface R2Object {
    key: string;
    size: number;
    etag: string;
    httpEtag: string;
    uploaded: Date;
    httpMetadata?: R2HttpMetadata;
    customMetadata?: Record<string, string>;
    writeHttpMetadata(headers: Headers): void;
  }

  export interface R2ObjectBody extends R2Object {
    body: ReadableStream<any>;
    bodyUsed?: boolean;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
    json<T = unknown>(): Promise<T>;
    blob(): Promise<Blob>;
  }

  export interface R2Objects {
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
    delimitedPrefixes: string[];
  }

  export interface R2ListOptions {
    limit?: number;
    prefix?: string;
    cursor?: string;
    delimiter?: string;
    startAfter?: string;
    include?: ("httpMetadata" | "customMetadata")[];
  }

  export interface R2Bucket {
    head?(key: string): Promise<R2Object | null>;
    get(key: string, options?: any): Promise<R2ObjectBody | null>;
    put(
      key: string,
      value: ReadableStream<any> | ArrayBuffer | ArrayBufferView | string | null | Blob | any,
      options?: {
        httpMetadata?: R2HttpMetadata | Headers;
        customMetadata?: Record<string, string>;
      }
    ): Promise<R2Object>;
    delete(keys: string | string[]): Promise<void>;
    list(options?: R2ListOptions): Promise<R2Objects>;
  }

  export interface KVNamespace {
    get(key: string, options?: any): Promise<any>;
    put(
      key: string,
      value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
      options?: { expiration?: number; expirationTtl?: number; metadata?: any }
    ): Promise<void>;
    delete(key: string): Promise<void>;
    list?(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
      keys: { name: string; expiration?: number; metadata?: unknown }[];
      list_complete: boolean;
      cursor?: string;
    }>;
  }

  export interface Fetcher {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  }

  export interface ExecutionContext {
    waitUntil(promise: Promise<any>): void;
    passThroughOnException(): void;
  }

  export interface ScheduledController {
    scheduledTime: number;
    cron: string;
    noRetry?(): void;
  }
}

export interface Env {
  DB: D1Database;
  db?: import("./db").DrizzleDb;
  DB_DIALECT?: "sqlite" | "postgres" | "mysql";
  /**
   * This install's object bucket. **Optional**: an install without local/object media
   * storage serves third-party-hosted media and bundled themes only. Every reader already
   * treats a miss as "fall through to the next source" (bundled assets), so
   * `?.` slots into the existing shape — but every *writer* must refuse
   * loudly instead (see `mediaUpload` / `uploadExtension`): silently dropping
   * bytes the row claims exist is the defect this repo keeps paying for.
   */
  MEDIA?: R2Bucket;
  CACHE: KVNamespace;
  ASSETS: Fetcher;

  /**
   * Deploy-time fallback for the platform feature switches. Optional — an
   * unset var means "no deploy-time opinion", which is *not* the same as
   * `"false"`: the per-site admin setting sits above this layer, and the
   * declared default sits below it. See `src/shared/features.ts`.
   *
   * These names are the `varName` fields of `FEATURE_SWITCHES`
   * (`shared/features.ts`). They are spelled out here rather than
   * derived because `Env` is an interface — it has no way to be computed from
   * data — and `tests/suites/architecture.test.mjs` cross-checks the two so a
   * rename cannot silently desynchronise them.
   */
  CFPRESS_CACHE_MIRROR_KV?: string;
  CFPRESS_UI_LOCALE_FOLLOW_SITE?: string;

  /**
   * Third-party image-host ("图床") API keys, one per vendor for the whole
   * install — exactly like the R2 bucket they replace is install-wide. They
   * are the *fallback*: a site key entered on the Media screen
   * (`cfpress.media.imgbb_key` / `cfpress.media.postimages_key`) wins for
   * that site, because one operator's key must not be every site's key.
   * A key in a site `settings` row would be readable by every site member
   * (`GET settings` returns raw values to anyone passing the site gate), so
   * the read path redacts sensitive values and the write path keeps a blank
   * write — see `sensitive` in `platform/setting-defs.ts`.
   *
   * Configure locally in `.dev.vars` (gitignored), in production with
   * `wrangler secret put IMGBB_API_KEY` / `wrangler secret put
   * POSTIMAGES_API_KEY`. Deliberately **not** in `wrangler.jsonc` `vars`:
   * that file is committed, and `architecture.test.mjs` fails a var no
   * switch declares. Absent means "that provider is not configured" — an
   * upload naming it answers 400 naming the missing secret, never a 500.
   */
  IMGBB_API_KEY?: string;
  POSTIMAGES_API_KEY?: string;
}
export interface User {
  id: string;
  username: string;
  email?: string | null;
  role: string;
  status: string;
}

export interface SessionUser extends User {
  sessionId: string;
  apiKeyId?: string;
  scopes?: string[];
  sites?: string[];
}

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
