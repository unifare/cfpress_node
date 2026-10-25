/**
 * The extensions domain: uploading plugin/theme packages, their settings,
 * and the theme uninstall that drops every table and file keyed by it.
 *
 * Extracted from `src/api.ts` (refactor plan §5).
 */
import { Env } from "../shared/types";
import { activity, now, ok } from "../shared/repo";
import { randomId } from "../shared/crypto";
import { unzipSync } from "fflate";
import { safeZipPath, sha256 } from "../extensions/security";
import { validateManifest } from "../extensions/contract/validation";
import { inspectExtension } from "../extensions/contract/doctor";
import { CAPABILITIES } from "../extensions/contract/capabilities";
import { parseSettingOptions } from "../extensions/theme/capabilities";
import { clearOwnerMenusAllSites } from "../platform/admin-menus";
import { BUNDLED_THEMES, bundledThemeFile } from "../shared/bundled";
import { clearPluginMenus, registerPluginMenus, registerPluginTables } from "../extensions/plugin/menus";
import { bootPluginRuntime, capabilityList, pluginRuntimeStatus, resetPluginRuntime, seedBundledExtensions } from "../extensions/plugin/runtime";
import { copyTheme, deleteThemeFile, exportThemeZip, listThemeFiles, readThemeFile, writeThemeFile } from "../extensions/theme/assets";
import { deleteThemeFilesFromD1, getMaxBinarySizeLimitBytes, isBinaryAsset, saveThemeFileToD1 } from "../extensions/theme/d1-store";
import { applyThemeCapabilities, clearThemeCapabilities, listFieldDefs, listPostTypes, listRoutes, listTaxonomies, listThemeAdminMenus, listThemeBlocks, themeSettings } from "../extensions/theme/capabilities";
import { activeTheme } from "../extensions/theme/runtime-declarative";
import { deriveSlug, resolveTableForSite, tableAggregate, tableBySlug, tableDelete, tableList, tableSave } from "../extensions/theme/table-facade";
import { listOwnerTableDefs } from "../extensions/theme/tables";
import { listAdminMenuGroups } from "../platform/admin-menus";
import { createSnapshot, deleteSnapshot, exportSiteBackup, getSnapshot, inspectBackup, listSnapshots, restoreSiteBackup } from "../platform/backup";
import { siteDefaultLocale } from "../platform/i18n/locale-registry";
import { loadUiPacks, resolveUiLocale } from "../platform/i18n/packs";
import { mergePacks } from "../platform/i18n/translate";
import { accessibleSiteIds, can, requirePermission } from "../platform/permissions";
import { bumpContentCache } from "../shared/cache";
import { CTBLOG_MENUS } from "../shared/demo-content";
import { jsonBody } from "../shared/repo";
import { SessionUser } from "../shared/types";
import { requireSiteAccess } from "./core";

export async function uploadExtension(env:Env,userId:string,request:Request,type:"plugin"|"theme"){
  const form=await request.formData();
  const file=form.get("file");
  if(!(file instanceof File))return ok({error:"file required"},400);
  if(file.size>10*1024*1024)return ok({error:"extension package max size is 10MB"},413);
  let files:Record<string,Uint8Array>;
  try{files=unzipSync(new Uint8Array(await file.arrayBuffer())) as Record<string,Uint8Array>}catch{return ok({error:"invalid ZIP package"},400)}
  const entries=Object.entries(files);
  if(entries.length===0||entries.length>100)return ok({error:"invalid package file count"},400);
  let total=0;for(const [name,bytes] of entries){if(!safeZipPath(name))return ok({error:`unsafe path: ${name}`},400);total+=bytes.byteLength;if(total>20*1024*1024)return ok({error:"uncompressed package exceeds 20MB"},413)}
  const manifestEntry=entries.find(([n])=>n.split("/").at(-1)===(type==="plugin"?"plugin.json":"theme.json"));
  if(!manifestEntry)return ok({error:`${type}.json not found`},400);
  let manifest: any;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestEntry[1]));
  } catch {
    return ok({ error: "invalid manifest JSON" }, 400);
  }

  const inspection = inspectExtension(manifest, type, files, { isUpload: true });
  if (!inspection.valid) {
    const primary = inspection.diagnostics.find((d) => d.level === "error");
    return ok({
      error: `Package inspection failed: ${primary?.message || "Invalid package contract"}`,
      report: inspection,
    }, 400);
  }

  let meta: any;
  try {
    meta = validateManifest(manifest, type);
  } catch (e: any) {
    return ok({ error: e?.message || "invalid manifest", report: inspection }, 400);
  }
  // A bundled theme's files ship inside the worker assets, and the assets copy
  // is the authority: `bundledThemeFile` is consulted on every R2 miss, so an
  // uploaded override would be silently shadowed while the registry claimed
  // the upload had won. Refuse rather than pretend — the fork should ship under
  // its own name.
  if(type==="theme"&&(BUNDLED_THEMES as readonly string[]).includes(String(meta.name)))return ok({error:`"${meta.name}" ships with the product; upload your variant under a different name`},400);
  const checksum=await sha256(await file.arrayBuffer());
  const packageKey=`extensions/${type}s/${meta.name}/${meta.version}/${checksum}.zip`;
  if(env.MEDIA){
    await env.MEDIA.put(packageKey,file.stream(),{httpMetadata:{contentType:"application/zip",cacheControl:"private, max-age=0"},customMetadata:{type,name:meta.name,version:meta.version}});
  }
  if(type==="theme") {
    const maxBinaryLimit = await getMaxBinarySizeLimitBytes(env);
    for(const [entry,bytes] of entries) {
      if(entry.endsWith("/") || entry.length>200) continue;
      const isBin = isBinaryAsset(entry);
      if(isBin && bytes.byteLength > maxBinaryLimit) {
        const sizeKb = (bytes.byteLength / 1024).toFixed(1);
        const limitKb = (maxBinaryLimit / 1024).toFixed(0);
        return ok({
          error: `Binary file "${entry}" (${sizeKb} KB) exceeds the configured limit of ${limitKb} KB (theme.max_binary_size_kb)`
        }, 400);
      }
    }

    for(const [entry,bytes] of entries) {
      if(entry.endsWith("/") || entry.length>200) continue;
      try {
        await saveThemeFileToD1(env, meta.name, meta.version, entry, bytes, maxBinaryLimit);
      } catch (err: any) {
        await deleteThemeFilesFromD1(env, meta.name).catch(()=>{});
        return ok({error: err?.message || "Failed to save theme file to database"}, 400);
      }
    }

    if(env.MEDIA){
      for(const [entry,bytes] of entries) {
        if(entry.endsWith("/") || entry.length>200) continue;
        const normalized=entry.replace(/^\.\//,"");
        const key=`extensions/themes/${meta.name}/${meta.version}/files/${normalized}`;
        const contentType=normalized.endsWith(".html")?"text/html;charset=UTF-8":normalized.endsWith(".css")?"text/css;charset=UTF-8":normalized.endsWith(".json")?"application/json":normalized.endsWith(".js")?"text/javascript;charset=UTF-8":"application/octet-stream";
        await env.MEDIA.put(key,bytes,{httpMetadata:{contentType,cacheControl:"public,max-age=300"}});
      }
    }
  }
  const nowTs=now();
  await env.DB.prepare("INSERT OR IGNORE INTO extension_versions(id,extension_type,extension_name,version,package_key,checksum,manifest,installed_at) VALUES(?,?,?,?,?,?,?,?)")
    .bind(await randomId(),type,meta.name,meta.version,packageKey,checksum,JSON.stringify(manifest),nowTs).run();
  if(type==="plugin"){
    const curPlugin = await env.DB.prepare("SELECT enabled FROM plugin_installs WHERE name=? LIMIT 1").bind(meta.name).first<any>();
    const keepEnabled = curPlugin ? (curPlugin.enabled ? 1 : 0) : 0;
    await env.DB.prepare(`INSERT INTO plugin_installs(id,name,title,version,enabled,manifest,installed_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(name) DO UPDATE SET title=excluded.title,version=excluded.version,manifest=excluded.manifest,updated_at=excluded.updated_at`)
      .bind(`plugin_${meta.name}`,meta.name,meta.title,meta.version,keepEnabled,JSON.stringify(manifest),nowTs,nowTs).run();
    if (keepEnabled) {
      await registerPluginMenus(env, meta.name, manifest.adminMenus);
      await registerPluginTables(env, meta.name, manifest);
      resetPluginRuntime();
      await bootPluginRuntime(env);
    }
  }else{
    // Installing a theme must never change what any site is currently using.
    // `active` here only records that the package is installed and usable.
    await env.DB.prepare(`INSERT INTO theme_installs(id,name,title,version,active,manifest,installed_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(name) DO UPDATE SET title=excluded.title,version=excluded.version,manifest=excluded.manifest,updated_at=excluded.updated_at`)
      .bind(`theme_${meta.name}`,meta.name,meta.title,meta.version,0,JSON.stringify(manifest),nowTs,nowTs).run();
  }
  const perms=Array.isArray(manifest.permissions)?manifest.permissions:[];
  for(const cap of perms.filter((x:string)=>(CAPABILITIES as readonly string[]).includes(x))) await env.DB.prepare("INSERT OR REPLACE INTO extension_capabilities(extension_type,extension_name,capability,enabled) VALUES(?,?,?,1)").bind(type,meta.name,cap).run();
  if(type==="plugin" && Array.isArray(manifest.settings)) {
    for(const def of manifest.settings) {
      if(!def?.key) continue;
      await env.DB.prepare("INSERT OR REPLACE INTO plugin_setting_defs(plugin_name,key,label,type,default_value,options) VALUES(?,?,?,?,?,?)").bind(meta.name,String(def.key),String(def.label||def.key),String(def.type||"text"),String(def.default??""),Array.isArray(def.options)?JSON.stringify(def.options):null).run();
    }
  }
  await activity(env,userId,"install",type,meta.name,{version:meta.version,checksum});
  return ok({ok:true,type,name:meta.name,title:meta.title,version:meta.version,checksum,files:entries.length,report:inspection},201);
}

export async function pluginSettings(env:Env,name:string){
  const defs=await env.DB.prepare("SELECT * FROM plugin_setting_defs WHERE plugin_name=? ORDER BY key").bind(name).all();
  const vals=await env.DB.prepare("SELECT key,value FROM plugin_settings WHERE plugin_id=(SELECT id FROM plugin_installs WHERE name=? LIMIT 1)").bind(name).all();
  const map=Object.fromEntries((vals.results as any[]).map(x=>[x.key,x.value]));
  return ok({items:(defs.results as any[]).map(x=>({...x,value:map[x.key]??x.default_value??"",options:parseSettingOptions(x.options)}))});
}
export async function savePluginSetting(env:Env,userId:string,name:string,b:any){
  const row=await env.DB.prepare("SELECT id FROM plugin_installs WHERE name=? LIMIT 1").bind(name).first<any>();
  if(!row)return ok({error:"plugin not found"},404);
  const allowed=await env.DB.prepare("SELECT key FROM plugin_setting_defs WHERE plugin_name=? AND key=?").bind(name,String(b.key||"")).first<any>();
  if(!allowed)return ok({error:"setting not declared"},400);
  await env.DB.prepare("INSERT INTO plugin_settings(plugin_id,key,value) VALUES(?,?,?) ON CONFLICT(plugin_id,key) DO UPDATE SET value=excluded.value").bind(row.id,String(b.key),String(b.value??"")).run();
  await activity(env,userId,"update","plugin_setting",name,{key:b.key});
  return ok({ok:true});
}

/**
 * Uninstall a theme: everything keyed by it, plus its R2 files.
 *
 * "Everything" is the whole set, not just the obvious three: the registry row,
 * the generated-table mapping and the tables themselves, the capability rows
 * applied on any site, the theme's rows in the shared admin-menu registry, and
 * its setting definitions and saved values. A theme is the one case where
 * "deactivation keeps your data so switching back restores the site" does not
 * apply — there is no switching back — so anything left behind is orphaned
 * rather than dormant.
 *
 * Refuses while any site still selects it — uninstalling the theme that renders
 * a live site takes the site down with it, and the 409 names the sites so the
 * operator knows what to switch first. `active` on `theme_installs` cannot
 * answer that (it is a global recomputed flag); `settings.theme.active` is the
 * per-site truth. The refusal is the authority for the *unforced* call; a
 * `?force=1` DELETE is the operator's way out — it deactivates the theme on
 * every occupying site (they fall back to the bundled default, which rule 66
 * keeps renderable everywhere) and then removes it. A refusal without an exit
 * is how "this theme cannot be deleted" gets believed.
 *
 * Order matters the same way it does for media: the registry row is what names
 * the generated tables, so the tables are dropped **while the mapping is still
 * readable**, and only then is the row removed. R2 files go last — a theme that
 * is half-uninstalled (row gone, files left) is at least visible in the admin's
 * next listing, whereas files gone with the row still present is a theme the
 * admin believes exists and cannot load.
 */
export async function uninstallTheme(env: Env, userId: string, name: string, force: boolean) {
  // A bundled theme has no R2 package to remove and its files come back with
  // the next deploy anyway; uninstalling it would only pretend to work.
  if((BUNDLED_THEMES as readonly string[]).includes(name)) return ok({error:`"${name}" ships with the product and cannot be uninstalled`},400);
  const row=await env.DB.prepare("SELECT name,version FROM theme_installs WHERE name=?").bind(name).first<any>();
  if(!row) return ok({error:"theme not found"},404);
  const active=await env.DB.prepare("SELECT site_id FROM settings WHERE key='theme.active' AND value=?").bind(name).all();
  const sites=((active.results as any[])??[]).map(r=>String(r.site_id));
  if(sites.length && !force) return ok({error:`still active on: ${sites.join(", ")}`},409);
  if(sites.length){
    // Forced: the operator has said this theme goes. Repoint every occupying
    // site to the bundled default — rule 66 keeps it installed and renderable
    // everywhere, so the fallback is a site that still renders. Capability
    // rows, menus, settings and generated tables are cleaned for *all* sites
    // by the uninstall below; only the per-site selection needs a write here.
    for(const s of sites){
      await env.DB.prepare("UPDATE settings SET value='default' WHERE site_id=? AND key='theme.active'").bind(s).run().catch(()=>{});
    }
  }

  const defs=await env.DB.prepare("SELECT table_name, i18n_table FROM theme_table_defs WHERE owner_type='theme' AND owner_name=?").bind(name).all();
  for(const d of ((defs.results as any[])??[])){
    for(const t of [d.table_name, d.i18n_table]){
      if(t) await env.DB.prepare(`DROP TABLE IF EXISTS ${t}`).run().catch(()=>{});
    }
  }
  await env.DB.prepare("DELETE FROM theme_table_defs WHERE owner_type='theme' AND owner_name=?").bind(name).run();

  // Capability rows applied on any site. An inactive theme's rows are normally
  // gone already (deactivation clears them), but an interrupted activation
  // would leave some behind — and the theme is going away entirely, so every
  // site's leftovers go with it.
  for(const table of ["post_types","taxonomies","field_defs","theme_routes","theme_blocks"]){
    await env.DB.prepare(`DELETE FROM ${table} WHERE declared_by_theme=?`).bind(name).run().catch(()=>{});
  }

  // Admin menus are the same leftovers, but they live in the shared registry
  // and are therefore cleared through its API rather than a raw DELETE here —
  // the ownership predicate stays in one place, exactly as it does on the
  // deactivation path. Deactivation only clears the site it ran on, so a theme
  // whose activation was interrupted keeps menus pointing at the tables just
  // dropped above: the admin still sees the nav entry and the click 404s.
  await clearOwnerMenusAllSites(env,"theme",name);

  // Setting definitions and the values saved against them are keyed by theme
  // name. Deactivation deliberately keeps both (switching away and back must
  // not lose the site's configuration), so uninstalling is the only place they
  // can be removed — and once the theme is gone nothing reads them, so they
  // would sit in the admin forever as a theme that no longer exists.
  await env.DB.prepare("DELETE FROM theme_setting_defs WHERE theme_name=?").bind(name).run().catch(()=>{});
  await env.DB.prepare("DELETE FROM theme_settings WHERE theme_name=?").bind(name).run().catch(()=>{});

  // Capability grants are keyed by extension name and are what the runtime
  // consults before letting an extension act. The package is leaving the
  // install, so its grants must not outlive it.
  await env.DB.prepare("DELETE FROM extension_capabilities WHERE extension_type='theme' AND extension_name=?").bind(name).run().catch(()=>{});

  // R2 files: every version, not only the installed one — re-uploading a theme
  // leaves the previous version's prefix behind, and an uninstall that keeps
  // those bytes is a leak nobody can list. Without a binding there is nothing
  // to list, so the loop below is skipped whole (not half-guarded per key).
  let files=0;
  let cursor: string|undefined;
  if(env.MEDIA){
  do {
    const list=await env.MEDIA.list({prefix:`extensions/themes/${name}/`,cursor});
    for(const o of list.objects){ await env.MEDIA.delete(o.key).catch(()=>{}); files++; }
    cursor=list.truncated?list.cursor:undefined;
  } while(cursor);
  }
  await deleteThemeFilesFromD1(env, name).catch(()=>{});

  await env.DB.prepare("DELETE FROM theme_installs WHERE name=?").bind(name).run();
  await env.DB.prepare("DELETE FROM extension_versions WHERE extension_type='theme' AND extension_name=?").bind(name).run().catch(()=>{});
  await activity(env,userId,"uninstall","theme",name,{files,tables:((defs.results as any[])??[]).length});
  return ok({ok:true,name,files,tables:((defs.results as any[])??[]).length});
}

/**
 * Uninstall a plugin: clear its menus, drop its custom tables, delete its
 * settings and capabilities, remove its install row, and reload plugin runtime.
 */
export async function uninstallPlugin(env: Env, userId: string, name: string) {
  const row = await env.DB.prepare("SELECT id, name, version FROM plugin_installs WHERE name=?").bind(name).first<any>();
  if (!row) return ok({ error: "plugin not found" }, 404);

  await clearPluginMenus(env, name);

  const defs = await env.DB.prepare("SELECT table_name, i18n_table FROM theme_table_defs WHERE owner_type='plugin' AND owner_name=?").bind(name).all();
  for (const d of ((defs.results as any[]) ?? [])) {
    for (const t of [d.table_name, d.i18n_table]) {
      if (t) await env.DB.prepare(`DROP TABLE IF EXISTS ${t}`).run().catch(() => {});
    }
  }
  await env.DB.prepare("DELETE FROM theme_table_defs WHERE owner_type='plugin' AND owner_name=?").bind(name).run();

  await env.DB.prepare("DELETE FROM plugin_setting_defs WHERE plugin_name=?").bind(name).run().catch(() => {});
  await env.DB.prepare("DELETE FROM plugin_settings WHERE plugin_id=?").bind(row.id).run().catch(() => {});
  await env.DB.prepare("DELETE FROM extension_capabilities WHERE extension_type='plugin' AND extension_name=?").bind(name).run().catch(() => {});

  let files = 0;
  let cursor: string | undefined;
  if (env.MEDIA) {
    do {
      const list = await env.MEDIA.list({ prefix: `extensions/plugins/${name}/`, cursor });
      for (const o of list.objects) { await env.MEDIA.delete(o.key).catch(() => {}); files++; }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
  }

  await env.DB.prepare("DELETE FROM plugin_installs WHERE name=?").bind(name).run();
  await env.DB.prepare("DELETE FROM extension_versions WHERE extension_type='plugin' AND extension_name=?").bind(name).run().catch(() => {});
  resetPluginRuntime();
  await bootPluginRuntime(env);

  await activity(env, userId, "uninstall", "plugin", name, { files, tables: ((defs.results as any[]) ?? []).length });
  return ok({ ok: true, name, files, tables: ((defs.results as any[]) ?? []).length });
}

export async function dispatchThemeTableAdminRoutes(
  env: Env,
  request: Request,
  user: SessionUser,
  siteId: string,
  path: string,
  method: string,
  url: URL
): Promise<Response | null> {
  // -- Extension-owned tables (L3) ----------------------------------------
  if ((path === "theme-tables" || path === "tables") && method === "GET") {
    const theme = await activeTheme(env, siteId).catch(() => null);
    const defs = await listOwnerTableDefs(env, siteId);
    const enabledPlugins = new Set(
      (await bootPluginRuntime(env).catch(() => [])).map((p) => p.name)
    );
    return ok({
      site: siteId,
      active_theme: theme?.name ?? null,
      items: defs.map((d) => ({
        ...d,
        active:
          d.owner_type === "theme"
            ? d.owner_name === theme?.name
            : enabledPlugins.has(d.owner_name),
      })),
    });
  }
  const ttMatch = path.match(/^(?:theme-tables|tables)\/([a-z][a-z0-9_]{0,63})$/);
  if (ttMatch) {
    const def = await resolveTableForSite(env, siteId, ttMatch[1]);
    if (!def) return ok({ error: `no table "${ttMatch[1]}" is declared for this site` }, 404);
    const locale = String(url.searchParams.get("locale") ?? "").trim() || (await siteDefaultLocale(env, siteId));
    if (method === "GET") {
      const agg = url.searchParams.get("aggregate");
      if (agg) {
        const result = await tableAggregate(env, def, {
          aggregate: agg,
          field: url.searchParams.get("field"),
          groupBy: url.searchParams.get("groupBy"),
          status: url.searchParams.get("status"),
        });
        if (!result) {
          return ok({ error: `cannot compute aggregate "${agg}" for table "${ttMatch[1]}"` }, 400);
        }
        return ok({ def, locale, ...result });
      }
      const items = await tableList(env, def, {
        locale,
        limit: Number(url.searchParams.get("limit") ?? 50),
        offset: Number(url.searchParams.get("offset") ?? 0),
        status: url.searchParams.get("status"),
      });
      return ok({ def, locale, items });
    }
    if (method === "POST" || method === "PUT") {
      if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
      const body = await jsonBody(request);
      try {
        const withSlug = body?.slug || method === "PUT" ? body : { ...body, slug: deriveSlug(def, body) };
        const row = await tableSave(env, def, withSlug, locale);
        return ok({ ok: true, locale, row }, 201);
      } catch (e: any) {
        return ok({ error: e?.message || "save failed" }, 400);
      }
    }
  }
  const ttRowMatch = path.match(/^(?:theme-tables|tables)\/([a-z][a-z0-9_]{0,63})\/([^/]+)$/);
  if (ttRowMatch) {
    const def = await resolveTableForSite(env, siteId, ttRowMatch[1]);
    if (!def) return ok({ error: `no table "${ttRowMatch[1]}" is declared for this site` }, 404);
    const locale = String(url.searchParams.get("locale") ?? "").trim() || (await siteDefaultLocale(env, siteId));
    const slug = decodeURIComponent(ttRowMatch[2]);
    if (method === "GET") {
      const row = await tableBySlug(env, def, slug, locale);
      return row ? ok({ def, locale, row }) : ok({ error: "not found" }, 404);
    }
    if (method === "PUT" || method === "POST") {
      if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
      const body = await jsonBody(request);
      try {
        const withSlug = { ...body, slug: body?.slug || slug };
        const row = await tableSave(env, def, withSlug, locale);
        return ok({ ok: true, locale, row });
      } catch (e: any) {
        return ok({ error: e?.message || "save failed" }, 400);
      }
    }
    if (method === "DELETE") {
      if (!(await requirePermission(env, user, "content.write", siteId))) return ok({ error: "Forbidden" }, 403);
      const row = await tableBySlug(env, def, slug, locale);
      if (!row) return ok({ error: "not found" }, 404);
      await tableDelete(env, def, String(row.id));
      return ok({ ok: true });
    }
  }

  return null;
}

export async function dispatchBackupAdminRoutes(
  env: Env,
  request: Request,
  user: SessionUser,
  siteId: string,
  path: string,
  method: string,
  url: URL
): Promise<Response | null> {
  if (path === "backup/export" && method === "POST") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const backup = await exportSiteBackup(env, siteId);
    const filename = `cfpress-backup-${siteId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await activity(env, user.id, "export", "backup", siteId, { summary: backup.summary });
    return ok({ ok: true, filename, backup });
  }

  if (path === "backup/inspect" && method === "POST") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    const res = await inspectBackup(env, siteId, b.payload || b);
    return ok(res);
  }

  if (path === "backup/restore" && method === "POST") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    const payload = b.payload || b;
    const opts = (b.options && typeof b.options === "object") ? b.options : {};
    const mode = (opts.mode || b.mode) === "clean" ? "clean" : "merge";
    const autoSnapshot = (opts.autoSnapshot !== undefined ? opts.autoSnapshot : b.autoSnapshot) !== false;
    const res = await restoreSiteBackup(env, siteId, payload, {
      mode,
      autoSnapshot,
      name: (opts.name || b.name) ? String(opts.name || b.name) : undefined,
    });
    await activity(env, user.id, "restore", "backup", siteId, { mode, restored: res.restored, snapshot_id: res.snapshot_id });
    return ok(res);
  }

  if (path === "backup/snapshots" && method === "GET") {
    if (!(await requireSiteAccess(env, user, siteId))) return ok({ error: "Forbidden" }, 403);
    const items = await listSnapshots(env, siteId);
    return ok({ items, site: siteId });
  }

  if (path === "backup/snapshots" && method === "POST") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    const name = String(b.name || "").trim() || "手动安全快照";
    const snap = await createSnapshot(env, siteId, name, "manual");
    await activity(env, user.id, "create", "snapshot", snap.id, { siteId, name });
    return ok({ ok: true, snapshot: snap }, 201);
  }

  const snapRestMatch = path.match(/^backup\/snapshots\/([^/]+)\/restore$/);
  if (snapRestMatch && method === "POST") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const snapId = decodeURIComponent(snapRestMatch[1]);
    const snapData = await getSnapshot(env, siteId, snapId);
    if (!snapData) return ok({ error: "Snapshot not found" }, 404);
    const res = await restoreSiteBackup(env, siteId, snapData, {
      mode: "clean",
      autoSnapshot: true,
      name: `回滚快照前自动备份 (${snapId})`,
    });
    await activity(env, user.id, "rollback", "snapshot", snapId, { siteId });
    return ok(res);
  }

  const snapDelMatch = path.match(/^backup\/snapshots\/([^/]+)$/);
  if (snapDelMatch && method === "DELETE") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const snapId = decodeURIComponent(snapDelMatch[1]);
    const success = await deleteSnapshot(env, siteId, snapId);
    if (!success) return ok({ error: "Snapshot not found" }, 404);
    await activity(env, user.id, "delete", "snapshot", snapId, { siteId });
    return ok({ ok: true });
  }

  const snapDlMatch = path.match(/^backup\/snapshots\/([^/]+)\/download$/);
  if (snapDlMatch && method === "GET") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const snapId = decodeURIComponent(snapDlMatch[1]);
    const snapData = await getSnapshot(env, siteId, snapId);
    if (!snapData) return ok({ error: "Snapshot not found" }, 404);
    const filename = `cfpress-snapshot-${siteId}-${snapId}.json`;
    return ok({ ok: true, filename, backup: snapData });
  }

  return null;
}

export async function dispatchExtensionAdminRoutes(
  env: Env,
  request: Request,
  user: SessionUser,
  siteId: string,
  path: string,
  method: string,
  url: URL
): Promise<Response | null> {
  if (path === "extensions/bootstrap" && method === "POST") {
    if (!(await requirePermission(env, user, "extensions.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    await seedBundledExtensions(env);
    return ok({ ok: true });
  }
  if (path === "extensions/plugins" && method === "GET") {
    if (!(await requireSiteAccess(env, user, siteId))) return ok({ error: "Forbidden" }, 403);
    const rows = await env.DB.prepare("SELECT * FROM plugin_installs ORDER BY title").all();
    const runtime = await pluginRuntimeStatus(env).catch(() => []);
    const wired = Object.fromEntries(runtime.map(r => [r.name, r.hooks]));
    return ok({ items: ((rows.results as any[]) ?? []).map(r => {
      let m: any = {};
      try { m = JSON.parse(String(r.manifest || "{}")); } catch {}
      return {
        ...r,
        manifest: m,
        adminPages: Array.isArray(m.adminPages) ? m.adminPages : [],
        channels: Array.isArray(m.channels) ? m.channels : [],
        hooks_wired: wired[r.name] ?? []
      };
    }) });
  }
  const pm = path.match(/^extensions\/plugins\/([^/]+)\/(enable|disable|toggle)$/);
  if (pm && method === "POST") {
    if (!(await requirePermission(env, user, "extensions.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const pluginName = pm[1];
    let action = pm[2];
    if (action === "toggle") {
      const cur = await env.DB.prepare("SELECT enabled FROM plugin_installs WHERE name=? LIMIT 1").bind(pluginName).first<any>();
      action = cur?.enabled ? "disable" : "enable";
    }
    await env.DB.prepare("UPDATE plugin_installs SET enabled=?,updated_at=? WHERE name=?").bind(action === "enable" ? 1 : 0, now(), pluginName).run();
    if (action === "disable") {
      await clearPluginMenus(env, pluginName);
    }
    resetPluginRuntime();
    await bootPluginRuntime(env);
    await activity(env, user.id, action, "plugin", pluginName);
    return ok({ ok: true, action, enabled: action === "enable" ? 1 : 0 });
  }
  const pd = path.match(/^extensions\/plugins\/([^/]+)$/);
  if (pd && method === "DELETE") {
    if (!(await requirePermission(env, user, "extensions.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    return uninstallPlugin(env, user.id, decodeURIComponent(pd[1]));
  }
  if (path === "extensions/themes" && method === "GET") {
    if (!(await requireSiteAccess(env, user, siteId))) return ok({ error: "Forbidden" }, 403);
    const rows = await env.DB.prepare("SELECT * FROM theme_installs ORDER BY title").all();
    const active = await env.DB.prepare("SELECT site_id,value FROM settings WHERE key='theme.active'").all();
    const fullBySite = Object.fromEntries(((active.results as any[]) ?? []).map(r => [r.site_id, r.value]));
    const allowedSites = await accessibleSiteIds(env, user);
    const bySite = allowedSites === null ? fullBySite
      : Object.fromEntries(Object.entries(fullBySite).filter(([sid]) => (allowedSites as string[]).includes(String(sid))));
    const activeForSite = bySite[siteId] ?? "";
    return ok({
      items: ((rows.results as any[]) ?? []).map(r => {
        let m: any = {};
        try { m = JSON.parse(String(r.manifest || "{}")); } catch {}
        return {
          ...r,
          manifest: m,
          active: r.name === activeForSite ? 1 : 0,
          bundled: (BUNDLED_THEMES as readonly string[]).includes(String(r.name)) ? 1 : 0,
        };
      }),
      active: activeForSite,
      active_by_site: bySite,
      site: siteId,
    });
  }
  const tm = path.match(/^extensions\/themes\/([^/]+)\/activate$/);
  if (tm && method === "POST") {
    if (!(await requirePermission(env, user, "extensions.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const target = tm[1];
    try {
      const res = await activateThemeForSite(env, target, siteId, user.id);
      return ok(res);
    } catch (err: any) {
      if (err.message === "theme not found") return ok({ error: "theme not found" }, 404);
      return ok({ error: err.message }, 400);
    }
  }

  const td = path.match(/^extensions\/themes\/([^/]+)$/);
  if (td && method === "DELETE") {
    if (!(await requirePermission(env, user, "extensions.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    return uninstallTheme(env, user.id, decodeURIComponent(td[1]), url.searchParams.get("force") === "1");
  }

  const tfl = path.match(/^extensions\/themes\/([^/]+)\/files$/);
  if (tfl && method === "GET") {
    if (!(await requirePermission(env, user, "extensions.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const res = await listThemeFiles(env, decodeURIComponent(tfl[1])).catch((e) => ({ error: e.message }));
    if ("error" in res) return ok({ error: res.error }, 400);
    return ok(res);
  }

  const tfile = path.match(/^extensions\/themes\/([^/]+)\/file$/);
  if (tfile && method === "GET") {
    if (!(await requirePermission(env, user, "extensions.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const rel = url.searchParams.get("path") || "";
    const res = await readThemeFile(env, decodeURIComponent(tfile[1]), rel).catch((e) => ({ error: e.message }));
    if ("error" in res) return ok({ error: res.error }, 400);
    return ok(res);
  }
  if (tfile && method === "PUT") {
    if (!(await requirePermission(env, user, "extensions.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const body = await jsonBody(request);
    const target = decodeURIComponent(tfile[1]);
    const res = await writeThemeFile(env, target, String(body.path || ""), String(body.content ?? "")).catch((e) => ({ error: e.message }));
    if ("error" in res) return ok({ error: res.error }, 400);
    await bumpContentCache(env, siteId);
    await activity(env, user.id, "update_theme_file", "theme", target, { path: body.path });
    return ok(res);
  }
  if (tfile && method === "DELETE") {
    if (!(await requirePermission(env, user, "extensions.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const rel = url.searchParams.get("path") || "";
    const target = decodeURIComponent(tfile[1]);
    const res = await deleteThemeFile(env, target, rel).catch((e) => ({ error: e.message }));
    if ("error" in res) return ok({ error: res.error }, 400);
    await bumpContentCache(env, siteId);
    await activity(env, user.id, "delete_theme_file", "theme", target, { path: rel });
    return ok(res);
  }

  const tcopy = path.match(/^extensions\/themes\/([^/]+)\/copy$/);
  if (tcopy && method === "POST") {
    if (!(await requirePermission(env, user, "extensions.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const body = await jsonBody(request);
    const src = decodeURIComponent(tcopy[1]);
    const res = await copyTheme(env, src, String(body.name || ""), String(body.title || ""), user.id).catch((e) => ({ error: e.message }));
    if ("error" in res) return ok({ error: res.error }, 400);
    await activity(env, user.id, "copy", "theme", res.name, { from: src });
    return ok(res, 201);
  }

  const texp = path.match(/^extensions\/themes\/([^/]+)\/export$/);
  if (texp && method === "GET") {
    if (!(await requirePermission(env, user, "extensions.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const target = decodeURIComponent(texp[1]);
    try {
      const zipBytes = await exportThemeZip(env, target);
      return new Response(zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) as ArrayBuffer, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(target)}.zip"`,
          "Cache-Control": "private, max-age=0",
        },
      });
    } catch (e: any) {
      return ok({ error: e.message || "Export failed" }, 400);
    }
  }

  if (path === "theme/post-types" && method === "GET") return ok({ items: await listPostTypes(env, siteId), site: siteId });
  if (path === "theme/templates" && method === "GET") {
    const t = await activeTheme(env, siteId).catch(() => null);
    const themeName = t?.name || "default";
    let templates: string[] = [];
    if (Array.isArray(t?.manifest?.templates) && t.manifest.templates.length > 0) {
      templates = [...t.manifest.templates];
    } else {
      const filesRes = await listThemeFiles(env, themeName).catch(() => ({ files: [] }));
      const files = "files" in filesRes ? filesRes.files : [];
      templates = files
        .filter((f: any) => f.path.startsWith("templates/") && !f.path.startsWith("templates/parts/") && f.path.endsWith(".html"))
        .map((f: any) => f.path.slice("templates/".length, -".html".length));
    }
    const unique = Array.from(new Set(templates)).sort();
    return ok({ items: unique, theme: themeName, site: siteId });
  }
  if (path === "theme/menu-locations" && method === "GET") {
    const t = await activeTheme(env, siteId).catch(() => null);
    const locs = t?.manifest?.menuLocations?.length ? t.manifest.menuLocations : [{ id: "header" }];
    const themeName = t?.name || "ctblog";
    const themeTitle = t?.manifest?.title || themeName;
    return ok({ items: locs, site: siteId, theme: themeName, themeTitle });
  }
  if (path === "theme/seed-menus" && method === "POST") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const t = await activeTheme(env, siteId).catch(() => null);
    const themeName = t?.name || "ctblog";
    const b = (await jsonBody(request).catch(() => ({}))) as any;
    const targetTheme = String(b.theme || themeName);

    if (targetTheme === "ctblog") {
      const createdIds: string[] = [];
      for (const m of CTBLOG_MENUS) {
        const menuId = `ctblog_${m.id}_${siteId}`;
        createdIds.push(menuId);
        await env.DB.prepare(
          "INSERT INTO menus (id,site_id,name,location,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(site_id,id) DO UPDATE SET name=excluded.name,location=excluded.location,updated_at=excluded.updated_at"
        ).bind(menuId, siteId, m.name, m.location, now(), now()).run();

        await env.DB.prepare("DELETE FROM menu_items WHERE site_id=? AND menu_id=?").bind(siteId, menuId).run();
        let mOrder = 0;
        for (const it of m.items) {
          const itemId = `${menuId}_${mOrder}`;
          await env.DB.prepare(
            "INSERT INTO menu_items (id,site_id,menu_id,parent_id,title,url,target,sort_order,locale,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
          ).bind(itemId, siteId, menuId, null, it.title, it.url, null, mOrder++, it.locale ?? "", now(), now()).run();
        }
      }

      await bumpContentCache(env, siteId);
      await activity(env, user.id, "create", "menus", createdIds[0] || "", { theme: "ctblog" });
      return ok({ ok: true, theme: "ctblog", created: createdIds, site: siteId });
    }

    return ok({ ok: true, theme: targetTheme, created: [], site: siteId });
  }
  if (path === "theme/sidebars" && method === "GET") {
    const t = await activeTheme(env, siteId).catch(() => null);
    const declaredAreas = t?.manifest?.widgets?.areas?.map((a: any) => ({ id: a.id, label: a.label || a.name || a.id }));
    const sbs = t?.manifest?.sidebars?.length ? t.manifest.sidebars : (declaredAreas?.length ? declaredAreas : [{ id: "sidebar" }, { id: "footer" }]);
    return ok({ items: sbs, site: siteId });
  }
  if (path === "theme/routes" && method === "GET") return ok({ items: await listRoutes(env, siteId), site: siteId });
  if (path === "theme/menus" && method === "GET") return ok({ items: await listThemeAdminMenus(env, siteId), site: siteId });

  if (path === "admin-menus" && method === "GET") {
    const memo = new Map<string, boolean>();
    const canView = async (capability: string) => {
      if (memo.has(capability)) return memo.get(capability)!;
      const allowed = await can(env, user, capability, siteId).catch(() => false);
      memo.set(capability, allowed);
      return allowed;
    };
    const curTheme = await activeTheme(env, siteId).catch(() => null);
    const groups = await listAdminMenuGroups(env, siteId, { can: canView, activeTheme: curTheme?.name });
    const uiLocale = await resolveUiLocale(env, siteId, {
      userLang: (user as any).ui_lang ?? null,
      defaultLocale: await siteDefaultLocale(env, siteId),
    });
    const dict = mergePacks(await loadUiPacks(env, siteId, uiLocale)) as Record<string, unknown>;
    const translated = groups.map(g => ({ ...g, items: g.items.map(m => {
      let label = m.label;
      if (m.label_key) {
        const v = dict[m.label_key];
        if (typeof v === "string" && v) label = v;
      }
      return { ...m, label };
    }) }));
    return ok({ site: siteId, ui_locale: uiLocale, groups: translated, items: translated.flatMap(g => g.items) });
  }
  if (path === "theme/blocks" && method === "GET") return ok({ items: await listThemeBlocks(env, siteId), site: siteId });
  if (path === "theme/fields" && method === "GET") return ok({ items: await listFieldDefs(env, siteId), site: siteId });
  if (path === "theme/taxonomies" && method === "GET") return ok({ items: await listTaxonomies(env, siteId), site: siteId });

  const tsm = path.match(/^theme\/([^/]+)\/settings$/);
  if (tsm && method === "GET") return ok({ items: await themeSettings(env, tsm[1]) });
  if (tsm && method === "POST") {
    if (!(await requirePermission(env, user, "settings.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const b = await jsonBody(request);
    const def = await env.DB.prepare("SELECT key FROM theme_setting_defs WHERE theme_name=? AND key=?").bind(tsm[1], String(b.key || "")).first<any>();
    if (!def) return ok({ error: "setting not declared" }, 400);
    await env.DB.prepare("INSERT INTO theme_settings(theme_name,key,value,updated_at) VALUES(?,?,?,?) ON CONFLICT(theme_name,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
      .bind(tsm[1], String(b.key), String(b.value ?? ""), now()).run();
    await activity(env, user.id, "update", "theme_setting", tsm[1], { key: b.key });
    return ok({ ok: true });
  }
  const psm = path.match(/^extensions\/plugins\/([^/]+)\/settings$/);
  if (psm && method === "GET") {
    if (!(await requirePermission(env, user, "extensions.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    return pluginSettings(env, psm[1]);
  }
  if (psm && method === "POST") {
    if (!(await requirePermission(env, user, "extensions.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    return savePluginSetting(env, user.id, psm[1], await jsonBody(request));
  }

  const uploadMatch = path.match(/^extensions\/(plugins|themes)\/upload$/);
  if (uploadMatch && method === "POST") {
    if (!(await requirePermission(env, user, "extensions.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    return uploadExtension(env, user.id, request, uploadMatch[1] === "plugins" ? "plugin" : "theme");
  }

  if (path === "extensions/inspect" && method === "POST") {
    if (!(await requirePermission(env, user, "extensions.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const ctype = request.headers.get("content-type") || "";
    if (ctype.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const extType = (form.get("type") === "plugin" ? "plugin" : "theme") as "plugin" | "theme";
      if (!(file instanceof File)) return ok({ error: "file required" }, 400);
      let files: Record<string, Uint8Array>;
      try { files = unzipSync(new Uint8Array(await file.arrayBuffer())) as Record<string, Uint8Array>; }
      catch { return ok({ error: "invalid ZIP package" }, 400); }
      const manifestEntry = Object.entries(files).find(([n]) => n.split("/").at(-1) === (extType === "plugin" ? "plugin.json" : "theme.json"));
      if (!manifestEntry) return ok({ error: `${extType}.json not found in package` }, 400);
      let manifest: any;
      try { manifest = JSON.parse(new TextDecoder().decode(manifestEntry[1])); }
      catch { return ok({ error: "invalid manifest JSON" }, 400); }
      const report = inspectExtension(manifest, extType, files);
      return ok({ ok: true, report });
    } else {
      const body = await jsonBody(request);
      const extType = (body.type === "plugin" ? "plugin" : "theme") as "plugin" | "theme";
      let manifest = body.manifest;
      let filesMap: Map<string, any> | undefined;

      if (body.name && !manifest) {
        if (extType === "theme") {
          try {
            const listRes = await listThemeFiles(env, body.name);
            const row = await env.DB.prepare("SELECT manifest FROM theme_installs WHERE name=? LIMIT 1").bind(body.name).first<any>();
            if (row?.manifest) {
              try { manifest = JSON.parse(row.manifest); } catch {}
            }
            if (!manifest && (BUNDLED_THEMES as readonly string[]).includes(body.name)) {
              const raw = await bundledThemeFile(env, body.name, "theme.json");
              if (raw) manifest = JSON.parse(raw);
            }
            filesMap = new Map();
            for (const f of listRes.files) {
              try {
                const fRes = await readThemeFile(env, body.name, f.path);
                if (fRes?.content) filesMap.set(f.path, fRes.content);
              } catch {}
            }
          } catch {}
        } else {
          try {
            const pRow = await env.DB.prepare("SELECT manifest FROM plugin_installs WHERE name=? LIMIT 1").bind(body.name).first<any>();
            if (pRow?.manifest) {
              manifest = JSON.parse(pRow.manifest);
            }
          } catch {}
        }
      }
      if (!manifest) manifest = body.manifest || body;
      const report = inspectExtension(manifest, extType, filesMap, { isUpload: false });
      return ok({ ok: true, report });
    }
  }
  if (path === "extensions/versions" && method === "GET") {
    if (!(await requirePermission(env, user, "extensions.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    const type = url.searchParams.get("type");
    const name = url.searchParams.get("name");
    const r = type && name
      ? await env.DB.prepare("SELECT * FROM extension_versions WHERE extension_type=? AND extension_name=? ORDER BY installed_at DESC").bind(type, name).all()
      : await env.DB.prepare("SELECT * FROM extension_versions ORDER BY installed_at DESC LIMIT 200").all();
    return ok({ items: r.results });
  }
  const capm = path.match(/^extensions\/(plugins|themes)\/([^/]+)\/capabilities$/);
  if (capm && method === "GET") {
    if (!(await requirePermission(env, user, "extensions.manage", siteId))) return ok({ error: "Forbidden" }, 403);
    return ok({ items: await capabilityList(env, capm[1] === "plugins" ? "plugin" : "theme", capm[2]) });
  }

  return null;
}

export async function activateThemeForSite(env: Env, target: string, siteId: string, userId?: string) {
  const row = await env.DB.prepare("SELECT name,version,manifest FROM theme_installs WHERE name=? LIMIT 1").bind(target).first<any>();
  if (!row) throw new Error("theme not found");
  let manifest: any;
  try { manifest = JSON.parse(String(row.manifest || "{}")); } catch { manifest = { name: target, version: row.version }; }

  const previousRow = await env.DB.prepare("SELECT value FROM settings WHERE site_id=? AND key='theme.active'").bind(siteId).first<any>();
  const previous = previousRow?.value ? String(previousRow.value) : null;
  if (previous && previous !== target) {
    await clearThemeCapabilities(env, previous, siteId);
  }
  await env.DB.prepare("INSERT INTO settings(id,site_id,key,value,autoload) VALUES(?,?,?,?,1) ON CONFLICT(site_id,key) DO UPDATE SET value=excluded.value")
    .bind(`theme-active-${siteId}`, siteId, "theme.active", target).run();
  await env.DB.prepare("UPDATE theme_installs SET active=0").run();
  await env.DB.prepare("UPDATE theme_installs SET active=1, updated_at=? WHERE name IN (SELECT value FROM settings WHERE key='theme.active')").bind(now()).run();

  const applied = await applyThemeCapabilities(env, target, manifest, siteId);
  await bumpContentCache(env, siteId);
  if (userId) {
    await activity(env, userId, "activate", "theme", target, { previous, siteId, ...applied });
  }
  return { ok: true, theme: target, site: siteId, previous, applied };
}
