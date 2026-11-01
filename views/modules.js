// Optional modules. Usage: await dv.view("Meta/views/modules")
// Each module is a set of standard notes and folders you may not need. Remove shows the exact list first and
// moves everything to the vault's .trash folder after you confirm. The layout remembers what went where (and any
// tab it took), so a removed module's card offers Restore, which puts it all back and can be undone once.
const MODULES = [
  { id: "wiki", label: "Research wiki (claude-obsidian)", desc: "The optional add-on where Claude Code files saved answers and researched sources. EX3C Agenda does not use it.",
    paths: ["wiki", "Inbox (uncategorised)", ".raw", ".claude-obsidian.json", "Guide/15 claude-obsidian.md", "scripts/template/defaults/wiki"],
    after: "CLAUDE.md still mentions the add-on; remove those lines when you edit it next." },
  { id: "retreats", label: "Personal retreats", desc: "The quarterly retreat notes, their template, guide and AI prompts.",
    paths: ["02 Retreats", "Templates/Personal Retreat.md", "Guide/04 Workflow - Personal Retreat.md", "Prompts/04 Retreat Prep.md", "Prompts/05 Retreat Facilitation.md"],
    after: "The Life areas widget and the Retreat buttons will show nothing to open; take them off in Configure." },
  { id: "writing", label: "Writing boards", desc: "Posts, Video scripts and Reviews: their folders, boards, templates, guide and prompt.",
    paths: ["06 Writing", "Templates/Post.md", "Templates/Video Script.md", "Templates/Review.md", "Guide/09 Workflow - Writing.md", "00 Dashboards/Boards.md", "Prompts/10 Writing Pipeline.md"],
    plugins: ["obsidian-kanban"], follows: true,
    after: "The Ideas and Create notes widgets (Widgets panel) will have no boards to write to. Kanban is switched off with it (only the Writing boards use it); Restore switches it back on." },
  { id: "ai", label: "Prompts and the AI page", desc: "The prompt library, the Assistant dashboard, the AI guides and the AI tab.",
    paths: ["Prompts", "00 Dashboards/Assistant.md", "Guide/14 Agent Client and Claude Code.md", "Guide/19 Obsidian MCP Bridge.md", "Guide/20 Prompt Library.md"],
    tabs: ["ai"], plugins: ["agent-client", "obsidian-local-rest-api"], strip: true, after: "Every AI button in your notes and templates, the links to the Assistant page and the AI setup keys are taken out too. Restore puts each one back where it was." },
  { id: "examples", label: "Example notes", desc: "Seed notes tagged example (sample journal days, the example project and person, the sample retreat and book).",
    dynamic: () => dv.pages().where(p => (p.file.tags ?? []).includes("#example")).file.path.array() },
];
const obs = (() => { try { return require("obsidian"); } catch (e) { return {}; } })();
const notify = m => (obs.Notice ? new obs.Notice(m) : console.warn(m));
const life = app.plugins.plugins["ex3c-agenda"];
function h(tag, attrs = {}, parent, text) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "class") el.className = v; else if (k === "style") el.style.cssText = v; else el.setAttribute(k, v); }
  if (text !== undefined) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}
function confirmBox(title, lines, yesText, note) {
  return new Promise(resolve => {
    const back = h("div", { style: "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px" }, document.body);
    const card = h("div", { style: "background:var(--background-primary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:10px;max-width:560px;width:100%;padding:14px 16px;box-shadow:var(--shadow-l)" }, back);
    h("div", { style: "font-weight:600;font-size:15px;margin-bottom:6px" }, card, `${title}?`);
    const ul = h("ul", { style: "max-height:45vh;overflow:auto;font-size:12px;margin:4px 0;padding-left:18px" }, card);
    for (const l of lines) h("li", {}, ul, l);
    h("div", { style: "color:var(--text-muted);font-size:12px;margin:6px 0 10px" }, card, note || "");
    const row = h("div", { style: "display:flex;gap:8px;justify-content:flex-end" }, card);
    const no = h("button", {}, row, "Cancel"), yes = h("button", { class: /^Restore/.test(yesText) ? "mod-cta" : "mod-warning" }, row, yesText);
    const done = v => { document.removeEventListener("keydown", key, true); back.remove(); resolve(v); };
    const key = e => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
    document.addEventListener("keydown", key, true);
    no.addEventListener("click", () => done(false)); yes.addEventListener("click", () => done(true));
    back.addEventListener("click", e => { if (e.target === back) done(false); });
    no.focus();
  });
}
// What a module would remove right now: existing files and folders (a folder counts its notes).
function contents(m) {
  const out = [];
  for (const p of m.dynamic ? m.dynamic() : m.paths) {
    const f = app.vault.getAbstractFileByPath(p);
    if (!f) continue;
    const notes = f.children ? app.vault.getFiles().filter(x => x.path.startsWith(`${p}/`)).length : 1;
    out.push({ f, label: f.children ? `${p}/ (folder, ${notes} file${notes === 1 ? "" : "s"})` : p, notes });
  }
  return out;
}
const ad = app.vault.adapter, TRASH = ".trash";
const trashNames = async () => (await ad.exists(TRASH)) ? (await ad.list(TRASH)).files.concat((await ad.list(TRASH)).folders).map(p => p.slice(TRASH.length + 1)) : [];
async function countFiles(path) {
  const st = await ad.stat(path); if (!st) return 0; if (st.type === "file") return 1;
  const l = await ad.list(path); let n = l.files.length; for (const f of l.folders) n += await countFiles(f); return n;
}
const records = () => life?.layout?.modules || {};
// Plugins a module switches off with it (AI: Agent Client and Local REST API; Writing: Kanban), and back on when restored.
// follows: the plugin is only there for this module, so while the module is in the vault the card offers to switch it on.
const PLUGIN_NAMES = { "agent-client": "Agent Client", "obsidian-local-rest-api": "Local REST API", "obsidian-kanban": "Kanban" };
const pluginsOff = m => (m.plugins || []).filter(id => app.plugins.manifests?.[id] && !app.plugins.enabledPlugins.has(id));
const pluginsOn = m => (m.plugins || []).filter(id => app.plugins.enabledPlugins.has(id));
const pluginsInstalled = m => (m.plugins || []).filter(id => app.plugins.manifests?.[id]);
// What Restore would bring back: from the record kept at removal, or (for modules removed before records existed)
// the best match by name at the top of .trash ("Prompts", "Prompts 2", ...; a folder: the one holding most files).
async function restorable(m) {
  const rec = records()[m.id], items = [], full = rec && !rec.legacy;
  if (full) {
    for (const x of rec.moved || []) if (await ad.exists(`${TRASH}/${x.to}`)) items.push({ ...x, files: await countFiles(`${TRASH}/${x.to}`), there: !!app.vault.getAbstractFileByPath(x.from) });
  } else if (!m.dynamic) {
    const names = await trashNames(), used = new Set();
    for (const p of m.paths) {
      if (app.vault.getAbstractFileByPath(p)) continue;
      const base = p.split("/").pop(), ext = base.includes(".") ? base.slice(base.lastIndexOf(".")) : "", stem = ext ? base.slice(0, -ext.length) : base;
      const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\d+)?${ext.replace(".", "\\.")}$`);
      const cands = [];
      for (const n of names.filter(n => re.test(n) && !used.has(n))) cands.push({ n, files: await countFiles(`${TRASH}/${n}`) });
      if (!cands.length) continue;
      cands.sort((a, b) => b.files - a.files || a.n.length - b.n.length);
      used.add(cands[0].n);
      items.push({ from: p, to: cands[0].n, files: cands[0].files, guessed: true, there: false });
    }
  }
  const tabs = full ? (rec.tabs || []).filter(t => !life?.layout?.tabs?.some(x => x.id === t.tab.id)) : (m.tabs || []).filter(id => !life?.layout?.tabs?.some(x => x.id === id)).map(id => ({ std: id }));
  return { rec, items, tabs };
}
async function ensureFolder(path) {
  const parts = path.split("/"); parts.pop();
  for (let i = 1; i <= parts.length; i++) { const p = parts.slice(0, i).join("/"); if (p && !app.vault.getAbstractFileByPath(p)) await app.vault.createFolder(p).catch(() => {}); }
}
// Moves one trashed file or folder back, through the vault API so Obsidian (desktop and phone) indexes it at once.
async function moveBack(src, dest) {
  const st = await ad.stat(src);
  if (st.type === "folder") {
    if (!app.vault.getAbstractFileByPath(dest)) await ensureFolder(`${dest}/x`);
    const l = await ad.list(src);
    for (const f of [...l.files, ...l.folders]) await moveBack(f, `${dest}/${f.split("/").pop()}`);
    const left = await ad.list(src);
    if (!left.files.length && !left.folders.length) await ad.rmdir(src, true).catch(e => console.error(e));
    return;
  }
  await ensureFolder(dest);
  await app.vault.createBinary(dest, await ad.readBinary(src), { ctime: st.ctime, mtime: st.mtime });
  await ad.remove(src);
}
// Moves the given vault paths to .trash and returns where each one landed.
async function toTrash(paths) {
  const moved = [];
  for (const p of paths) {
    const f = app.vault.getAbstractFileByPath(p); if (!f) continue;
    const before = new Set(await trashNames());
    try { await app.vault.trash(f, false); } catch (e) { console.error(e); continue; }
    const to = (await trashNames()).find(n => !before.has(n));
    if (to) moved.push({ from: p, to });
  }
  return moved;
}
// AI leftovers inside notes: Agent Client buttons (```agent blocks), lines linking the removed Assistant page, and
// Setup's AI keys. Removing the AI module takes them out and records each one (note, line, text) so Restore can
// put it back where it was.
const SETUP = "00 Dashboards/Setup.md", AI_KEYS = ["setup_claude_login", "setup_mcp_registered"];
async function leftovers() {
  const out = [];
  for (const f of app.vault.getMarkdownFiles()) {
    // journal and retreat notes keep their text (vault rule); their buttons stay hidden by the app while AI is off
    if (/^(\.trash|Prompts|01 Journal|02 Retreats|Meta)\//.test(f.path)) continue;
    const text = await app.vault.cachedRead(f);
    if (!/```agent|\[\[Assistant[\]|#]|%%ai%%/.test(text)) continue;
    const L = text.split("\n"), blocks = [];
    // a section that holds nothing but AI buttons and Assistant links goes as a whole, heading included
    const isHead = l => /^#{1,6}\s/.test(l);
    const removable = new Set();
    for (let i = 0; i < L.length; i++) {
      if (/^\s*```agent\s*$/.test(L[i])) { let j = i + 1; while (j < L.length && !/^\s*```\s*$/.test(L[j])) j++; for (let k = i; k <= j; k++) removable.add(k); i = j; }
      else if (/\[\[Assistant[\]|#]|%%ai%%/.test(L[i])) removable.add(i); // %%ai%% marks a line that is only about AI
    }
    for (let i = 0; i < L.length; i++) {
      if (!isHead(L[i])) continue;
      let j = i + 1; while (j < L.length && !isHead(L[j])) j++;
      const body = [...Array(j - i - 1).keys()].map(k => i + 1 + k);
      if (body.some(k => removable.has(k)) && body.every(k => removable.has(k) || L[k].trim() === "")) {
        blocks.push({ at: i, text: L.slice(i, j).join("\n"), kind: L.slice(i, j).some(l => /```agent/.test(l)) ? "button" : "link" });
        i = j - 1;
      }
    }
    const taken = new Set(blocks.flatMap(b => [...Array(b.text.split("\n").length).keys()].map(k => b.at + k)));
    for (let i = 0; i < L.length; i++) {
      if (taken.has(i)) continue;
      if (/^\s*```agent\s*$/.test(L[i])) {
        let j = i + 1; while (j < L.length && !/^\s*```\s*$/.test(L[j])) j++;
        let end = j; if (end + 1 < L.length && L[end + 1].trim() === "" && (i === 0 || L[i - 1].trim() === "")) end++; // and one blank line after it
        blocks.push({ at: i, text: L.slice(i, end + 1).join("\n"), kind: "button" }); i = end;
      } else if (/\[\[Assistant[\]|#]|%%ai%%/.test(L[i])) blocks.push({ at: i, text: L[i], kind: "link" });
    }
    if (blocks.length) out.push({ path: f.path, blocks: blocks.sort((x, y) => x.at - y.at) });
  }
  const fm = app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(SETUP) ?? {})?.frontmatter ?? {};
  const keys = AI_KEYS.filter(k => k in fm).map(k => ({ key: k, value: fm[k] }));
  return { notes: out, keys };
}
async function stripLeftovers(found) {
  const done = [];
  for (const n of found.notes) {
    const f = app.vault.getAbstractFileByPath(n.path); if (!f) continue;
    let ok = true;
    await app.vault.process(f, data => {
      const L = data.split("\n");
      // remove from the bottom up, each only if it is still exactly there
      for (const b of [...n.blocks].sort((a, c) => c.at - a.at)) {
        const len = b.text.split("\n").length;
        if (L.slice(b.at, b.at + len).join("\n") !== b.text) { ok = false; continue; }
        L.splice(b.at, len);
      }
      return L.join("\n");
    });
    done.push({ path: n.path, blocks: n.blocks, partial: !ok });
  }
  const sf = app.vault.getAbstractFileByPath(SETUP);
  if (sf && found.keys.length) await app.fileManager.processFrontMatter(sf, fm => { for (const k of found.keys) delete fm[k.key]; });
  return { notes: done, keys: found.keys };
}
async function putBackLeftovers(rec) {
  // the Setup keys first: the recorded line numbers count them
  const sf0 = app.vault.getAbstractFileByPath(SETUP);
  if (sf0 && rec?.keys?.length) await app.fileManager.processFrontMatter(sf0, fm => { for (const k of rec.keys) fm[k.key] = k.value; });
  for (const n of rec?.notes || []) {
    const f = app.vault.getAbstractFileByPath(n.path); if (!f) continue;
    await app.vault.process(f, data => {
      const L = data.split("\n");
      for (const b of [...n.blocks].sort((a, c) => a.at - c.at)) L.splice(Math.min(b.at, L.length), 0, ...b.text.split("\n"));
      return L.join("\n");
    });
  }
}
const UNDO = (window.__ex3cModulesUndo ??= {});
const root = h("div", { class: "mods" }, dv.container);
h("style", {}, root, `.mods { font-size: 13px; } .mods-card { border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 8px 10px; margin: 8px 0; background: var(--background-primary); }
.mods-card h4 { margin: 0 0 2px; } .mods-sub { color: var(--text-muted); font-size: 12px; } .mods-card details { font-size: 12px; margin: 4px 0; } .mods-card.is-gone h4 { color: var(--text-muted); }
.mods-card button { margin: 4px 6px 0 0; } .mods-undo { margin-top: 6px; padding: 4px 8px; border-radius: 6px; background: var(--background-secondary); font-size: 12px; }`);
const tabName = id => ({ ai: "AI" })[id] || id[0].toUpperCase() + id.slice(1);
const fileWord = n => `${n} file${n === 1 ? "" : "s"}`;
async function render() {
  const cards = [];
  for (const m of MODULES) {
    const items = contents(m), tabs = (m.tabs ?? []).filter(t => life?.layout?.tabs?.some(x => x.id === t));
    const back = await restorable(m);
    const left = m.strip ? await leftovers() : { notes: [], keys: [] };
    cards.push({ m, items, tabs, back, left });
  }
  root.querySelectorAll(":scope > div").forEach(e => e.remove());
  for (const { m, items, tabs, back, left } of cards) {
    const nLeft = left.notes.length + (left.keys.length ? 1 : 0);
    const present = items.length || tabs.length || nLeft, canRestore = back.items.some(x => !x.there) || back.tabs.length || (back.rec?.stripped?.notes?.length && !nLeft);
    const card = h("div", { class: `mods-card${present ? "" : " is-gone"}` }, root);
    h("h4", {}, card, present ? m.label : `${m.label} (removed)`);
    h("div", { class: "mods-sub" }, card, m.desc);
    if (present) {
      const total = items.reduce((s, x) => s + x.notes, 0);
      const det = h("details", {}, card);
      const buttons = left.notes.filter(n => n.blocks.some(b => b.kind === "button")), links = left.notes.filter(n => n.blocks.some(b => b.kind === "link"));
      const leftLines = [...(buttons.length ? [`AI buttons in ${buttons.length} note${buttons.length === 1 ? "" : "s"} and templates: ${buttons.map(n => n.path.split("/").pop().replace(/\.md$/, "")).join(", ")}`] : []),
        ...(links.length ? [`Links to the removed Assistant page in ${links.map(n => n.path.split("/").pop().replace(/\.md$/, "")).join(", ")}`] : []),
        ...(left.keys.length ? [`Setup's AI keys: ${left.keys.map(k => k.key).join(", ")}`] : [])];
      h("summary", {}, det, [total ? fileWord(total) : "", tabs.length ? `the ${tabs.map(tabName).join(", ")} tab` : "", nLeft ? `AI leftovers in ${left.notes.length} note${left.notes.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(", "));
      const ul = h("ul", {}, det); for (const x of items) h("li", {}, ul, x.label); for (const l of leftLines) h("li", {}, ul, l);
      const b = h("button", { class: "mod-warning" }, card, "Remove…");
      b.addEventListener("click", async () => {
        const lines = [...items.map(x => x.label), ...tabs.map(t => `The ${tabName(t)} tab in EX3C Agenda`), ...pluginsOn(m).map(id => `Switch off the ${PLUGIN_NAMES[id] || id} plugin`), ...leftLines];
        if (!(await confirmBox(`Remove ${m.label}`, lines, total ? `Move ${fileWord(total)} to .trash` : "Remove them", "Files go to the .trash folder in your vault; buttons and links are taken out of the notes. This card then offers Restore, which puts it all back where it was."))) return;
        const moved = await toTrash(items.map(x => x.f.path));
        const stripped = nLeft ? await stripLeftovers(left) : null;
        const tabRecs = tabs.map(id => ({ tab: JSON.parse(JSON.stringify(life.layout.tabs.find(t => t.id === id))), index: life.layout.tabs.findIndex(t => t.id === id) }));
        const old = records()[m.id];
        const offed = pluginsOn(m);
        for (const id of offed) { try { await app.plugins.disablePluginAndSave(id); } catch (e) { console.error(e); } }
        await life?.setModuleRecord?.(m.id, { removed: old?.removed || moment().format("YYYY-MM-DD HH:mm"), moved: [...(old?.moved || []), ...moved], tabs: [...(old?.tabs || []).filter(t => !tabRecs.some(x => x.tab.id === t.tab.id)), ...tabRecs], plugins: [...new Set([...(old?.plugins || []), ...offed])],
          ...(stripped || old?.stripped ? { stripped: { notes: [...(old?.stripped?.notes || []), ...(stripped?.notes || [])], keys: [...(old?.stripped?.keys || []), ...(stripped?.keys || [])] } } : {}) });
        for (const t of tabs) await life?.deleteTab?.(t);
        delete UNDO[m.id];
        notify(`${m.label}: ${fileWord(moved.length ? total : 0)} moved to .trash.${m.after ? ` ${m.after}` : ""}`);
        setTimeout(render, 400);
      });
      if (m.after) h("div", { class: "mods-sub", style: "margin-top:4px" }, card, `After removing: ${m.after}`);
      const offNow = m.follows ? pluginsOff(m) : [];
      if (offNow.length) {
        const names = offNow.map(id => PLUGIN_NAMES[id] || id);
        h("div", { class: "mods-sub", style: "margin-top:4px" }, card, `${names.join(" and ")} ${names.length === 1 ? "is" : "are"} switched off, so the boards open as plain notes.`);
        const on = h("button", { class: "mod-cta" }, card, `Switch ${names.join(" and ")} on`);
        on.addEventListener("click", async () => {
          for (const id of offNow) { try { await app.plugins.enablePluginAndSave(id); } catch (e) { console.error(e); notify(`Could not switch on ${PLUGIN_NAMES[id] || id}: ${e.message}`); } }
          notify(`${names.join(" and ")} switched on for ${m.label}.`);
          setTimeout(render, 600);
        });
      }
    }
    if (canRestore) {
      const todo = back.items.filter(x => !x.there), n = todo.reduce((s, x) => s + x.files, 0);
      h("div", { class: "mods-sub", style: "margin-top:4px" }, card, back.rec && !back.rec.legacy ? `Removed ${moment(back.rec.removed, "YYYY-MM-DD HH:mm").format("DD-MM-YYYY HH:mm")}. In .trash: ${fileWord(n)}${back.tabs.length ? ` and the ${back.tabs.map(t => t.tab?.label || tabName(t.std)).join(", ")} tab` : ""}.` : `Found in .trash: ${fileWord(n)}${back.tabs.length ? `, and the ${back.tabs.map(t => tabName(t.std)).join(", ")} page can be added back` : ""}.`);
      const r = h("button", { class: "mod-cta" }, card, "Restore…");
      r.addEventListener("click", async () => {
        const backOn = [...new Set([...(back.rec?.plugins || []), ...(m.follows ? m.plugins : [])])].filter(id => app.plugins.manifests?.[id] && !app.plugins.enabledPlugins.has(id));
        const lines = [...todo.map(x => `.trash/${x.to} → ${x.from}${x.files > 1 ? ` (${fileWord(x.files)})` : ""}`), ...(back.rec?.stripped?.notes || []).map(n => `AI buttons and links back into ${n.path}`), ...backOn.map(id => `Switch the ${PLUGIN_NAMES[id] || id} plugin back on`), ...back.tabs.map(t => `The ${t.tab?.label || tabName(t.std)} tab back in EX3C Agenda`), ...back.items.filter(x => x.there).map(x => `Skipped: ${x.from} already exists`)];
        if (!(await confirmBox(`Restore ${m.label}`, lines, `Restore ${fileWord(n)}`, back.rec && !back.rec.legacy ? "Each item goes back to where it was when you removed it." : "These were removed before Restore existed, so they were matched by name in .trash. Check the list."))) return;
        const restored = [];
        for (const x of todo) { try { await moveBack(`${TRASH}/${x.to}`, x.from); restored.push(x.from); } catch (e) { console.error(e); notify(`Could not restore ${x.from}: ${e.message}`); } }
        const addedTabs = [];
        for (const t of back.tabs) {
          if (t.std) { await life?.restoreTab?.(t.std); addedTabs.push(t.std); continue; }
          await life?.changeLayout?.(layout => { if (!layout.tabs.some(x => x.id === t.tab.id)) layout.tabs.splice(Math.min(t.index, layout.tabs.length), 0, t.tab); });
          addedTabs.push(t.tab.id);
        }
        for (const id of backOn) { try { await app.plugins.enablePluginAndSave(id); } catch (e) { console.error(e); } }
        if (back.rec?.stripped) await putBackLeftovers(back.rec.stripped);
        await life?.setModuleRecord?.(m.id, null);
        UNDO[m.id] = { paths: restored, tabs: addedTabs, plugins: backOn };
        notify(`${m.label}: ${fileWord(n)} restored.`);
        setTimeout(render, 400);
      });
    }
    if (!present && pluginsOn(m).length) {
      const names = pluginsOn(m).map(id => PLUGIN_NAMES[id] || id);
      h("div", { class: "mods-sub", style: "margin-top:4px" }, card, `${names.join(" and ")} ${names.length === 1 ? "is" : "are"} still switched on.`);
      const off = h("button", {}, card, `Switch ${names.length === 1 ? "it" : "them"} off`);
      off.addEventListener("click", async () => {
        if (!(await confirmBox(`Switch off ${names.join(" and ")}`, names.map(n => `The ${n} plugin`), "Switch off", "Restore switches them back on."))) return;
        const ids = pluginsOn(m);
        for (const id of ids) { try { await app.plugins.disablePluginAndSave(id); } catch (e) { console.error(e); } }
        const rec = records()[m.id];
        if (rec) await life?.setModuleRecord?.(m.id, { ...rec, plugins: [...new Set([...(rec.plugins || []), ...ids])] });
        else await life?.setModuleRecord?.(m.id, { removed: moment().format("YYYY-MM-DD HH:mm"), moved: [], tabs: [], plugins: ids, legacy: true });
        setTimeout(render, 400);
      });
    }
    if (canRestore) {} else if (!present) {
      h("div", { class: "mods-sub", style: "margin-top:4px" }, card, "Removed, and nothing of it is left in .trash to restore.");
    }
    const u = UNDO[m.id];
    if (u && present) {
      const box = h("div", { class: "mods-undo" }, card, `Restored ${u.paths.length} item${u.paths.length === 1 ? "" : "s"}. `);
      const ub = h("button", {}, box, "Undo restore");
      ub.addEventListener("click", async () => {
        if (!(await confirmBox(`Undo restoring ${m.label}`, [...u.paths, ...u.tabs.map(t => `The ${tabName(t)} tab`)], "Move back to .trash", "Puts these back in .trash; Restore stays available."))) return;
        const moved = await toTrash(u.paths);
        for (const id of u.plugins || []) { try { await app.plugins.disablePluginAndSave(id); } catch (e) { console.error(e); } }
        const tabRecs = u.tabs.map(id => ({ tab: JSON.parse(JSON.stringify(life.layout.tabs.find(t => t.id === id) || { id })), index: life.layout.tabs.findIndex(t => t.id === id) })).filter(t => t.index >= 0);
        await life?.setModuleRecord?.(m.id, { removed: moment().format("YYYY-MM-DD HH:mm"), moved, tabs: tabRecs, plugins: u.plugins || [] });
        for (const t of u.tabs) await life?.deleteTab?.(t);
        delete UNDO[m.id];
        setTimeout(render, 400);
      });
    }
  }
}
await render();
