export interface NodeKVNamespace {
  get(key: string, options?: any): Promise<any | null>;
  put(key: string, value: any, options?: { expirationTtl?: number; expiration?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list?(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<any>;
}

interface KVItem {
  value: string;
  expiresAt: number | null;
}

/**
 * Creates an in-memory KVNamespace adapter with TTL expiration support.
 */
export function createMemoryKV(): NodeKVNamespace {
  const store = new Map<string, KVItem>();

  function cleanup() {
    const now = Date.now();
    for (const [k, item] of store.entries()) {
      if (item.expiresAt !== null && item.expiresAt <= now) {
        store.delete(k);
      }
    }
  }

  return {
    async get(key: string, type?: "text" | "json" | "arrayBuffer"): Promise<any | null> {
      const item = store.get(key);
      if (!item) return null;

      if (item.expiresAt !== null && item.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }

      if (type === "json") {
        try {
          return JSON.parse(item.value);
        } catch {
          return null;
        }
      }
      return item.value;
    },

    async put(key: string, value: any, options?: { expirationTtl?: number; expiration?: number }): Promise<void> {
      let expiresAt: number | null = null;
      const now = Date.now();

      if (options?.expirationTtl) {
        expiresAt = now + options.expirationTtl * 1000;
      } else if (options?.expiration) {
        expiresAt = options.expiration * 1000;
      }

      let strVal = typeof value === "string" ? value : JSON.stringify(value);
      store.set(key, { value: strVal, expiresAt });

      // Periodic check if map gets large
      if (store.size > 2000) cleanup();
    },

    async delete(key: string): Promise<void> {
      store.delete(key);
    },

    async list(options = {}) {
      cleanup();
      const prefix = options.prefix || "";
      const limit = options.limit || 1000;

      const keys: { name: string; expiration?: number }[] = [];
      for (const [k, item] of store.entries()) {
        if (k.startsWith(prefix)) {
          keys.push({
            name: k,
            expiration: item.expiresAt ? Math.floor(item.expiresAt / 1000) : undefined,
          });
          if (keys.length >= limit) break;
        }
      }

      return {
        keys,
        list_complete: true,
        cursor: "",
      };
    },
  };
}
