/**
 * CFPress Admin SPA — Extensible Slots System.
 *
 * Provides extension points (slots) throughout the admin interface.
 * Third-party plugins, themes, and core extensions can register custom
 * markup and lifecycle-aware mounts into pre-designated slot areas
 * (e.g., 'editor:sidebar', 'dashboard:widgets', 'header:actions').
 *
 * Designed for zero-build ESM environments with safe fault-isolation.
 */

/** @typedef {{ id: string, priority?: number, render?: (ctx: any) => string, mount?: (el: HTMLElement, ctx: any) => (void | Function | { unmount: Function }) }} SlotExtension */

/** @type {Map<string, SlotExtension[]>} */
const slotRegistry = new Map();

/**
 * Register an extension into a named slot.
 *
 * @param {string} slotId Target slot identifier (e.g. 'editor:sidebar')
 * @param {SlotExtension} extension Extension definition
 */
export function registerSlot(slotId, extension) {
  if (!slotId || typeof slotId !== "string") {
    throw new TypeError("registerSlot requires a valid slotId string");
  }
  if (!extension || typeof extension !== "object" || !extension.id) {
    throw new TypeError("registerSlot requires an extension object with a unique 'id'");
  }

  const list = slotRegistry.get(slotId) || [];
  const existingIdx = list.findIndex((item) => item.id === extension.id);
  const entry = {
    priority: 10,
    ...extension,
  };

  if (existingIdx !== -1) {
    list[existingIdx] = entry;
  } else {
    list.push(entry);
  }

  list.sort((a, b) => (a.priority ?? 10) - (b.priority ?? 10));
  slotRegistry.set(slotId, list);
}

/**
 * Unregister an extension from a slot by id.
 *
 * @param {string} slotId Target slot identifier
 * @param {string} extensionId ID of the extension to remove
 */
export function unregisterSlot(slotId, extensionId) {
  const list = slotRegistry.get(slotId);
  if (!list) return;
  const filtered = list.filter((item) => item.id !== extensionId);
  if (filtered.length) {
    slotRegistry.set(slotId, filtered);
  } else {
    slotRegistry.delete(slotId);
  }
}

/**
 * Return a copy of all extensions registered for a slot, sorted by priority.
 *
 * @param {string} slotId Target slot identifier
 * @returns {SlotExtension[]}
 */
export function getSlotExtensions(slotId) {
  return [...(slotRegistry.get(slotId) || [])];
}

/**
 * Synchronously render HTML markup for all registered extensions in a slot.
 * Wrap each item with `data-slot-item="<id>"` for subsequent lifecycle mounting.
 *
 * @param {string} slotId Target slot identifier
 * @param {any} [context] Context object passed to extension render() methods
 * @returns {string} Rendered HTML string
 */
export function renderSlot(slotId, context = {}) {
  const extensions = slotRegistry.get(slotId);
  if (!extensions || extensions.length === 0) return "";

  let html = "";
  for (const ext of extensions) {
    if (typeof ext.render !== "function") continue;
    try {
      const fragment = ext.render(context);
      if (typeof fragment === "string" && fragment.trim()) {
        html += `<div class="cfp-slot-item" data-slot-id="${escapeAttr(slotId)}" data-slot-item="${escapeAttr(ext.id)}">${fragment}</div>`;
      }
    } catch (err) {
      console.error(`[CFP-Slots] Error rendering extension '${ext.id}' in slot '${slotId}':`, err);
    }
  }
  return html;
}

/**
 * Mount all registered extensions found in the container.
 * Invokes each extension's `mount(element, context)` hook if defined.
 *
 * @param {HTMLElement} container The DOM element containing rendered slot items
 * @param {any} [context] Context object passed to extension mount() methods
 * @returns {Promise<() => void>} Combined unmount callback that cleans up all mounted items
 */
export async function mountSlots(container, context = {}) {
  if (!container || typeof container.querySelectorAll !== "function") {
    return () => {};
  }

  const unmountFns = [];
  const items = container.querySelectorAll("[data-slot-item]");

  for (const el of items) {
    const slotId = el.getAttribute("data-slot-id");
    const itemId = el.getAttribute("data-slot-item");
    if (!slotId || !itemId) continue;

    const extensions = slotRegistry.get(slotId);
    const ext = extensions?.find((e) => e.id === itemId);
    if (!ext || typeof ext.mount !== "function") continue;

    try {
      const cleanup = await ext.mount(/** @type {HTMLElement} */ (el), context);
      if (typeof cleanup === "function") {
        unmountFns.push(cleanup);
      } else if (cleanup && typeof cleanup.unmount === "function") {
        unmountFns.push(() => cleanup.unmount());
      }
    } catch (err) {
      console.error(`[CFP-Slots] Error mounting extension '${itemId}' in slot '${slotId}':`, err);
    }
  }

  return async () => {
    for (const fn of unmountFns) {
      try {
        await fn();
      } catch (err) {
        console.error("[CFP-Slots] Error unmounting slot extension:", err);
      }
    }
  };
}

/**
 * Reset all slots or a specific slot. Primarily used in testing.
 *
 * @param {string} [slotId]
 */
export function clearSlots(slotId) {
  if (slotId) {
    slotRegistry.delete(slotId);
  } else {
    slotRegistry.clear();
  }
}

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
