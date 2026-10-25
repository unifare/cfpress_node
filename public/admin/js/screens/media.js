/**
 * Screen: media library — files for the current site.
 *
 * Three things shape this screen:
 *
 *  1. **It is the library's own view, so it must show the same objects the
 *     picker does.** `mediaUrl()` / `mediaItem()` come from `media-picker.js`
 *     rather than being re-derived here: the read path checks the key's tenant
 *     before serving (rule 60), so a second way of building the URL is a second
 *     way to build a 404. `architecture.test.mjs` enforces it.
 *
 *  2. **The list endpoint already paginates, searches and filters by MIME
 *     prefix.** `page` / `limit` / `q` / `type` were all there; the screen was
 *     showing the first page and nothing else, which meant a library of 60 files
 *     silently looked like a library of 50.
 *
 *  3. **Alt text is the one field worth editing in place.** It is what a screen
 *     reader announces and what the picker offers as a default, and making the
 *     author open a dialog to fix one word is how alt text stays empty.
 *
 * The view state (`view`) is deliberately screen-local: it describes what this
 * screen is currently showing, and it survives a re-render so that uploading a
 * file does not throw you back to page one of an unfiltered list.
 */
import { api, scoped, state } from "../state.js";
import { pageHead, render } from "../shell.js";
import { icon } from "../../icons.js";
import { mediaItem, mediaUrl } from "../media-picker.js";
import { t } from "../i18n.js";
import { allAt, fieldsAll, closestBtn, closestField, evtField, fieldAt, elAt, closestEl, attr, confirmDialog, esc, toast } from "../../ui.js";

/** How many tiles per request. The endpoint caps `limit` at 100. */
export const MEDIA_PAGE_LIMIT = 24;

let view = {
  q: "",
  type: "",
  page: 1,
  items: [],
  total: 0,
  sort: "newest",
  layout: "grid",
  storage: { provider: "r2", imgbbKey: false, postimagesKey: false },
};

/** The query string the list endpoint understands.
 *
 *  Exported so the shape is checkable without a browser — the one thing that
 *  must not drift is that `type` is a MIME **prefix** (`image/`), because the
 *  server matches it with `LIKE 'image/%'`. */
export function mediaQuery({ q = "", type = "", page = 1, limit = MEDIA_PAGE_LIMIT } = {}) {
  const parts = [`page=${Math.max(1, Number(page) || 1)}`, `limit=${limit}`];
  if (q) parts.push(`q=${encodeURIComponent(q)}`);
  if (type) parts.push(`type=${encodeURIComponent(type)}`);
  return parts.join("&");
}

/** Pagination facts from a list payload — the arithmetic lives in one place so
 *  "is there another page" cannot disagree with "how many are there". */
export function mediaPageInfo(payload) {
  const page = Math.max(1, Number(payload?.page) || 1);
  const limit = Math.max(1, Number(payload?.limit) || MEDIA_PAGE_LIMIT);
  const total = Math.max(0, Number(payload?.total) || 0);
  return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)), hasMore: page * limit < total };
}

function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function sortedItems(items, sortKey) {
  const list = [...(items || [])];
  if (sortKey === "oldest") {
    list.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  } else if (sortKey === "name_asc") {
    list.sort((a, b) => String(a.filename || a.title || "").localeCompare(String(b.filename || b.title || ""), undefined, { sensitivity: "base" }));
  } else if (sortKey === "size_desc") {
    list.sort((a, b) => (Number(b.file_size) || 0) - (Number(a.file_size) || 0));
  }
  return list;
}

/** One tile. The tile IS the thumbnail: the picture fills a square, the three
 *  actions ride in a glass overlay that fades in on hover/focus, and the
 *  metadata is two quiet lines under the picture. Rows are what the API
 *  returns, so `mediaItem()` normalises them (and refuses a row it cannot
 *  name, rather than rendering a broken tile). */
export function mediaTileHtml(row) {
  const m = mediaItem(row);
  if (!m) return "";
  const isImg = m.mimeType.startsWith("image/");
  const name = m.filename || m.url;
  const label = (k, d) => attr(t(k, d));
  const storageBadge = row.storage && row.storage !== "r2"
    ? `<span class="badge sm" style="font-size:0.6875rem;padding:0.125rem 0.375rem;opacity:0.85">${esc(row.storage)}</span>`
    : "";
  return `<figure class="media-tile" data-media-row="${attr(m.id)}">
    <div class="media-thumb">${isImg
      ? `<img src="${attr(m.url)}" alt="${attr(m.alt)}" loading="lazy">`
      : `<span class="media-file">${icon("file-text")}</span>`}
      <div class="media-actions">
        <button type="button" class="icon-btn" data-copy="${attr(m.url)}" title="${label("core.media.copyUrl", "URL")}" aria-label="${label("core.media.copyUrl", "URL")}">${icon("copy")}</button>
        <a class="icon-btn" href="${attr(m.url)}" target="_blank" rel="noopener" title="${label("core.media.open", "Open")}" aria-label="${label("core.media.open", "Open")}">${icon("external")}</a>
        <button type="button" class="icon-btn danger" data-media-del="${attr(m.id)}|${attr(name)}" title="${label("core.action.delete", "Delete")}" aria-label="${label("core.action.delete", "Delete")}">${icon("trash")}</button>
      </div>
    </div>
    <figcaption class="media-meta">
      <div class="media-name" title="${attr(name)}">${esc(name)}</div>
      <div class="media-sub" style="display:flex;align-items:center;gap:0.375rem">${esc(formatBytes(m.size))} · ${esc(m.mimeType || "—")}${storageBadge}</div>
    </figcaption>
    <input class="media-alt" data-media-alt="${attr(m.id)}" value="${attr(m.alt)}"
      placeholder="${attr(t("core.media.altPlaceholder", "alt text"))}"
      aria-label="${attr(t("core.media.alt", "Alt text"))}">
  </figure>`;
}

export function mediaGridHtml(items) {
  const list = items ?? [];
  if (!list.length) {
    return `<div class="media-empty">${icon("image")}
      <div>${esc(t("core.media.empty", "No media uploaded yet."))}</div>
      <span class="text-sm">${esc(t("core.media.dropHint", "Drop files here to upload"))}</span>
    </div>`;
  }
  return list.map(mediaTileHtml).join("");
}

/** The grid + its footer, as one string — used both for the first paint and for
 *  "load more", so the two can never disagree about the footer's arithmetic.
 *  The upload tile is a first-class grid member: the affordance to add more
 *  lives where the files are, not only in the header. */
export function mediaBodyHtml(items, info) {
  const isList = view.layout === "list";
  const list = sortedItems(items, view.sort);
  const shown = (list ?? []).length;
  const add = t("core.media.addMedia", "Upload files");
  return `<div id="media-grid" class="media-grid${isList ? " is-list-view" : ""}">
    <button type="button" class="media-tile media-upload-tile" data-media-upload="1" title="${attr(add)}" aria-label="${attr(add)}">${icon("upload")}<span>${esc(add)}</span></button>
    ${mediaGridHtml(list)}
  </div>
  <div class="toolbar" style="margin-top:1rem;align-items:center">
    <span class="muted text-sm">${esc(t("core.media.showing", "Showing {shown} of {total}", { shown, total: info?.total ?? shown }))}</span>
    ${info?.hasMore
      ? `<button type="button" class="btn outline sm" data-media-more="1">${esc(t("core.media.loadMore", "Load more"))}</button>`
      : ""}
  </div>`;
}

/** Fetch one page and fold it into the view. `append` is what "load more" does. */
async function load({ append = false } = {}) {
  const page = append ? view.page + 1 : 1;
  const d = await api(scoped(`media?${mediaQuery({ q: view.q, type: view.type, page })}`));
  const items = d.items || [];
  const info = mediaPageInfo({ ...d, page });
  view = {
    ...view,
    page: info.page,
    total: info.total,
    items: append ? [...view.items, ...items] : items,
    storage: d.storage ?? { provider: "r2", imgbbKey: false, postimagesKey: false },
  };
  return info;
}

export default async function media(c) {
  let info;
  try {
    info = await load();
  } catch (e) {
    c.innerHTML = `${pageHead({ title: t("core.media.title", "Media") })}
      <div class="panel"><div class="muted">${esc(e.message)}</div></div>`;
    return;
  }

  const filter = (value, label) =>
    `<option value="${attr(value)}"${view.type === value ? " selected" : ""}>${esc(label)}</option>`;

  const chip = (val, label, iconName) => {
    const active = view.type === val;
    return `<button type="button" class="media-filter-chip${active ? " active" : ""}" data-filter-type="${attr(val)}">
      ${icon(iconName)}<span>${esc(label)}</span>
    </button>`;
  };

  c.innerHTML = `${pageHead({
    title: t("core.media.title", "Media"),
    sub: t(info.total === 1 ? "core.media.subOne" : "core.media.subMany", "{n} files in this site's library", { n: info.total }),
    actions: `<label class="btn primary">${icon("upload")}${esc(t("core.media.upload", "Upload"))}<input id="upload" type="file" multiple hidden></label>`,
    crumbs: [{ label: t("core.nav.content", "Content") }, { label: t("core.media.title", "Media") }],
  })}
  <div class="media-toolbar-card">
    <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap">
      <div style="position:relative;flex:1;min-width:180px">
        <span style="position:absolute;left:0.625rem;top:50%;transform:translateY(-50%);color:var(--muted-foreground);pointer-events:none;display:inline-flex;align-items:center;width:1rem;height:1rem">
          ${icon("search")}
        </span>
        <input id="media-q" value="${attr(view.q)}" placeholder="${attr(t("core.msg.searchPlaceholder", "Search…"))}"
          style="padding-left:2.125rem;padding-right:${view.q ? "2rem" : "0.75rem"};width:100%" class="input">
        ${view.q ? `<button type="button" data-action="clear-media-search" style="position:absolute;right:0.5rem;top:50%;transform:translateY(-50%);border:0;background:none;cursor:pointer;color:var(--muted-foreground);padding:0.25rem;display:inline-flex" title="${attr(t("core.media.searchClear", "Clear search"))}">${icon("x")}</button>` : ""}
      </div>

      <select id="media-type" style="display:none">
        ${filter("", t("core.media.filterAll", "All types"))}
        ${filter("image/", t("core.media.filterImages", "Images"))}
        ${filter("audio/", t("core.media.filterAudio", "Audio"))}
        ${filter("video/", t("core.media.filterVideo", "Video"))}
        ${filter("application/", t("core.media.filterDocuments", "Documents"))}
        ${filter("application/zip", t("core.media.filterArchives", "Archives"))}
      </select>

      <div style="display:flex;gap:0.5rem;align-items:center">
        <select id="media-sort" class="control sm" style="width:auto;height:2.25rem">
          <option value="newest"${view.sort === "newest" ? " selected" : ""}>${esc(t("core.media.sortNewest", "Newest first"))}</option>
          <option value="oldest"${view.sort === "oldest" ? " selected" : ""}>${esc(t("core.media.sortOldest", "Oldest first"))}</option>
          <option value="name_asc"${view.sort === "name_asc" ? " selected" : ""}>${esc(t("core.media.sortNameAsc", "Name (A–Z)"))}</option>
          <option value="size_desc"${view.sort === "size_desc" ? " selected" : ""}>${esc(t("core.media.sortSizeDesc", "Largest first"))}</option>
        </select>
        <div style="display:inline-flex;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">
          <button type="button" class="btn sm icon-btn ${view.layout !== "list" ? "primary" : "ghost"}" data-media-layout="grid" title="${attr(t("core.media.viewGrid", "Grid view"))}" style="border:0;border-radius:0;height:2.125rem;width:2.25rem">${icon("grid")}</button>
          <button type="button" class="btn sm icon-btn ${view.layout === "list" ? "primary" : "ghost"}" data-media-layout="list" title="${attr(t("core.media.viewList", "List view"))}" style="border:0;border-radius:0;height:2.125rem;width:2.25rem">${icon("list")}</button>
        </div>
      </div>
    </div>

    <div class="media-filter-chips" style="display:flex;gap:0.375rem;margin-top:0.75rem;flex-wrap:wrap;align-items:center">
      <span class="muted text-xs" style="margin-right:0.25rem;font-weight:500">${esc(t("core.media.filterAll", "All types"))}:</span>
      ${chip("", t("core.media.filterAll", "All types"), "files")}
      ${chip("image/", t("core.media.filterImages", "Images"), "image")}
      ${chip("audio/", t("core.media.filterAudio", "Audio"), "music")}
      ${chip("video/", t("core.media.filterVideo", "Video"), "film")}
      ${chip("application/", t("core.media.filterDocuments", "Documents"), "file-text")}
      ${chip("application/zip", t("core.media.filterArchives", "Archives"), "package")}
    </div>
  </div>

  <div id="media-drop" class="media-drop">
    <div class="media-drop-hint muted text-sm">${esc(t("core.media.dropHint", "Drop files here to upload"))}</div>
    ${mediaBodyHtml(view.items, info)}
  </div>`;

  const uploadInput = elAt("#upload");
  if (uploadInput) uploadInput.onchange = (e) => uploadFiles([...evtField(e).files]);

  const drop = elAt("#media-drop");
  if (drop) {
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      uploadFiles([...(e.dataTransfer?.files ?? [])]);
    });
  }

  let searchTimer = null;
  const requery = () => { view = { ...view, page: 1 }; render(); };
  const q = fieldAt("#media-q");
  if (q) q.addEventListener("input", () => { view = { ...view, q: q.value.trim() }; clearTimeout(searchTimer); searchTimer = setTimeout(requery, 250); });
  const type = fieldAt("#media-type");
  if (type) type.addEventListener("change", () => { view = { ...view, type: type.value }; requery(); });
  const sort = fieldAt("#media-sort");
  if (sort) sort.addEventListener("change", () => { view = { ...view, sort: sort.value }; render(); });
}

/** Upload every dropped/selected file, then show the newest first. */
async function uploadFiles(files) {
  const list = files.filter(Boolean).slice(0, 20);
  if (!list.length) return;
  let ok = 0;
  const failed = [];
  for (const f of list) {
    const fd = new FormData();
    fd.append("file", f);
    try { await api(scoped("media"), { method: "POST", body: fd }); ok++; }
    catch (e) { failed.push(`${f.name}: ${e.message}`); }
  }
  if (ok) toast(t("core.media.uploaded", "Uploaded"));
  if (failed.length) toast(failed[0], "error");
  render();
}

// ---------------------------------------------------------------------------
// Delegated actions.
// ---------------------------------------------------------------------------
document.addEventListener("click", async (e) => {
  const chipBtn = closestEl(e, "[data-filter-type]");
  if (chipBtn) {
    view = { ...view, type: chipBtn.dataset.filterType, page: 1 };
    render();
    return;
  }

  const clearSearch = closestEl(e, "[data-action='clear-media-search']");
  if (clearSearch) {
    view = { ...view, q: "", page: 1 };
    render();
    return;
  }

  const layoutBtn = closestEl(e, "[data-media-layout]");
  if (layoutBtn) {
    view = { ...view, layout: layoutBtn.dataset.mediaLayout };
    render();
    return;
  }

  const up = closestEl(e, "[data-media-upload]");
  if (up) { elAt("#upload")?.click(); return; }

  const cp = closestEl(e, "[data-copy]");
  if (cp) {
    try {
      await navigator.clipboard.writeText(new URL(cp.dataset.copy, location.origin).href);
      toast(t("core.media.urlCopied", "URL copied"));
    } catch { toast(t("core.media.copyFailed", "Could not copy"), "error"); }
    return;
  }

  const more = closestBtn(e, "[data-media-more]");
  if (more) {
    more.disabled = true;
    try {
      const info = await load({ append: true });
      const body = elAt("#media-grid");
      if (body) {
        body.outerHTML = mediaBodyHtml(view.items, info);
      } else {
        render();
      }
    } catch (err) { toast(err.message, "error"); more.disabled = false; }
    return;
  }

  const del = closestEl(e, "[data-media-del]");
  if (del) {
    const [id, name] = del.dataset.mediaDel.split("|");
    const sure = await confirmDialog({
      title: t("core.media.deleteTitle", "Delete this file?"),
      description: t("core.media.deleteDesc", "The file is removed from storage as well. Anything still pointing at its URL will break."),
      confirmLabel: t("core.action.delete", "Delete"),
    });
    if (!sure) return;
    try {
      await api(scoped(`media/${encodeURIComponent(id)}`), { method: "DELETE" });
      toast(t("core.msg.deleted", "Deleted."));
      view = { ...view, items: view.items.filter((r) => String(r.id) !== String(id)), total: Math.max(0, view.total - 1) };
      render();
    } catch (err) { toast(`${name}: ${err.message}`, "error"); }
  }
});

/** Alt text saves on `change` (blur or Enter). */
document.addEventListener("change", async (e) => {
  const alt = closestField(e, "[data-media-alt]");
  if (!alt) return;
  const id = alt.dataset.mediaAlt;
  const before = view.items.find((r) => String(r.id) === String(id))?.alt_text ?? "";
  if (alt.value === before) return;
  try {
    await api(scoped(`media/${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alt_text: alt.value }),
    });
    const row = view.items.find((r) => String(r.id) === String(id));
    if (row) row.alt_text = alt.value;
    toast(t("core.media.altSaved", "Alt text saved"));
  } catch (err) {
    alt.value = before;
    toast(err.message, "error");
  }
});
