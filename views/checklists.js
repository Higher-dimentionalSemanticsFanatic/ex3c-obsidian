// Reusable checklists. Usage: await dv.view("Meta/views/checklists", { folder: "09 Checklists" })
// A checklist is a note with type: checklist. Tick items in the note (or here); Reset unticks every item for next time.
// Resetting writes several lines, so it asks first (count and list) and can be undone.
const FOLDER = input?.folder ?? "09 Checklists";
const obs = (() => { try { return require("obsidian"); } catch (e) { return {}; } })();
const notify = m => (obs.Notice ? new obs.Notice(m) : console.warn(m));
const BOX = /^(\s*[-*+] )\[([^\]])\]( .*)?$/;
const UNDO = (window.__ex3cChecklistUndo ??= {});
const dmy = s => (s ? moment(s, ["YYYY-MM-DD HH:mm", "YYYY-MM-DD"]).format("DD-MM-YYYY HH:mm") : "never");
const lists = () => dv.pages().where(p => String(p.type ?? "") === "checklist" && !p.file.path.startsWith("Templates/") && !p.file.path.startsWith(".trash/")).sort(p => p.file.name).array();
function confirmBox(title, lines, yesText) {
  return new Promise(resolve => {
    const back = document.body.createEl("div", { attr: { style: "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px" } });
    const card = back.createEl("div", { attr: { style: "background:var(--background-primary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:10px;max-width:520px;width:100%;padding:14px 16px;box-shadow:var(--shadow-l)" } });
    card.createEl("div", { text: `${title}?`, attr: { style: "font-weight:600;font-size:15px;margin-bottom:6px" } });
    const ul = card.createEl("ul", { attr: { style: "max-height:45vh;overflow:auto;font-size:12px;margin:4px 0;padding-left:18px" } });
    for (const l of lines) ul.createEl("li", { text: l });
    card.createEl("div", { text: "You can undo this right after with Undo on the checklist's card.", attr: { style: "color:var(--text-muted);font-size:12px;margin:6px 0 10px" } });
    const row = card.createEl("div", { attr: { style: "display:flex;gap:8px;justify-content:flex-end" } });
    const no = row.createEl("button", { text: "Cancel" }), yes = row.createEl("button", { text: yesText, cls: "mod-cta" });
    const done = v => { document.removeEventListener("keydown", key, true); back.remove(); resolve(v); };
    const key = e => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
    document.addEventListener("keydown", key, true);
    no.addEventListener("click", () => done(false)); yes.addEventListener("click", () => done(true));
    back.addEventListener("click", e => { if (e.target === back) done(false); });
    yes.focus();
  });
}
// the note's checkbox lines, read fresh from the file (Dataview's cache can lag a tick behind)
async function items(path) {
  const f = app.vault.getAbstractFileByPath(path);
  const text = f ? await app.vault.cachedRead(f) : "";
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const off = text.length - body.length ? text.slice(0, text.length - body.length).split("\n").length - 1 : 0;
  const lr = text.match(/^---\n[\s\S]*?^last_reset:[ \t]*["']?([^"'\n]*)/m)?.[1]?.trim() || null;
  const out = body.split("\n").map((l, i) => { const m = l.match(BOX); return m ? { line: i + off, raw: l, done: m[2] !== " ", text: (m[3] ?? "").trim(), depth: (l.match(/^\s*/)[0].replace(/ {4}/g, "\t").length) } : null; }).filter(Boolean);
  out.lastReset = lr;
  return out;
}
async function reset(p) {
  const its = await items(p.file.path), ticked = its.filter(x => x.done);
  if (!ticked.length) return notify(`${p.file.name}: nothing ticked.`);
  if (ticked.length > 1 && !(await confirmBox(`Reset ${p.file.name}: untick ${ticked.length} items`, ticked.map(x => x.text), `Untick ${ticked.length}`))) return;
  const f = app.vault.getAbstractFileByPath(p.file.path), changes = [];
  await app.vault.process(f, data => {
    const L = data.split("\n");
    for (const x of ticked) { if (L[x.line] !== x.raw) continue; const next = x.raw.replace(BOX, (m, a, c, b) => `${a}[ ]${b ?? ""}`); changes.push({ line: x.line, before: x.raw, after: next }); L[x.line] = next; }
    return L.join("\n");
  });
  const prevReset = p.last_reset ?? null;
  await app.fileManager.processFrontMatter(f, fm => { fm.last_reset = moment().format("YYYY-MM-DD HH:mm"); });
  UNDO[p.file.path] = { changes, prevReset, at: Date.now() };
  notify(`${p.file.name}: ${changes.length} item${changes.length === 1 ? "" : "s"} unticked.`);
  setTimeout(render, 300);
}
async function undo(p) {
  const u = UNDO[p.file.path]; if (!u) return;
  const f = app.vault.getAbstractFileByPath(p.file.path); let back = 0, skipped = 0;
  await app.vault.process(f, data => { const L = data.split("\n"); for (const c of u.changes) { const i = L[c.line] === c.after ? c.line : L.indexOf(c.after); if (i < 0) { skipped++; continue; } L[i] = c.before; back++; } return L.join("\n"); });
  await app.fileManager.processFrontMatter(f, fm => { fm.last_reset = u.prevReset ?? null; });
  delete UNDO[p.file.path];
  notify(`Undone: ${back} item${back === 1 ? "" : "s"} ticked again${skipped ? `; ${skipped} had changed and were left alone` : ""}.`);
  setTimeout(render, 300);
}
async function toggle(path, x) {
  const f = app.vault.getAbstractFileByPath(path);
  await app.vault.process(f, data => { const L = data.split("\n"); if (L[x.line] === x.raw) L[x.line] = x.raw.replace(BOX, (m, a, c, b) => `${a}[${x.done ? " " : "x"}]${b ?? ""}`); return L.join("\n"); });
  setTimeout(render, 150);
}
async function newList() {
  const name = await new Promise(res => {
    const back = document.body.createEl("div", { attr: { style: "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px" } });
    const card = back.createEl("div", { attr: { style: "background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:10px;max-width:420px;width:100%;padding:14px 16px" } });
    card.createEl("div", { text: "Name of the new checklist", attr: { style: "font-weight:600;margin-bottom:8px" } });
    const inp = card.createEl("input", { type: "text", attr: { style: "width:100%", placeholder: "Packing list" } });
    const row = card.createEl("div", { attr: { style: "display:flex;gap:8px;justify-content:flex-end;margin-top:10px" } });
    const no = row.createEl("button", { text: "Cancel" }), yes = row.createEl("button", { text: "Create", cls: "mod-cta" });
    const done = v => { back.remove(); res(v); };
    no.addEventListener("click", () => done(null)); yes.addEventListener("click", () => done(inp.value.trim()));
    inp.addEventListener("keydown", e => { if (e.key === "Enter") done(inp.value.trim()); if (e.key === "Escape") done(null); });
    setTimeout(() => inp.focus(), 0);
  });
  if (!name) return;
  const safe = name.replace(/[\\/:*?"<>|#^[\]]/g, "").trim(), path = `${FOLDER}/${safe}.md`;
  if (app.vault.getAbstractFileByPath(path)) return notify(`${safe} already exists.`);
  if (!app.vault.getAbstractFileByPath(FOLDER)) await app.vault.createFolder(FOLDER);
  const f = await app.vault.create(path, "---\ntype: checklist\nlast_reset:\n---\n- [ ] \n");
  await app.workspace.getLeaf(false).openFile(f, { state: { mode: "source" } });
}
const root = dv.container.createEl("div", { cls: "ckl" });
root.createEl("style", { text: `.ckl-card { border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 8px 10px; margin: 8px 0; background: var(--background-primary); }
.ckl-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; } .ckl-head strong { cursor: pointer; } .ckl-sub { color: var(--text-muted); font-size: 12px; }
.ckl-bar { height: 5px; border-radius: 3px; background: var(--background-modifier-border); overflow: hidden; margin: 6px 0; } .ckl-bar > div { height: 100%; background: var(--interactive-accent); }
.ckl-items { list-style: none; padding-left: 0; margin: 4px 0; font-size: 13px; } .ckl-items li { display: flex; gap: 6px; align-items: baseline; padding: 1px 0; } .ckl-items li.is-done span { color: var(--text-faint); text-decoration: line-through; }
.ckl-tools { margin-left: auto; display: flex; gap: 6px; } .ckl button { font-size: 12px; padding: 2px 10px; height: auto; } .ckl-undo { font-size: 12px; margin-top: 4px; }` });
async function render() {
  const all = lists(), data = await Promise.all(all.map(p => items(p.file.path)));
  root.querySelectorAll(":scope > :not(style)").forEach(e => e.remove());
  const top = root.createEl("div", { cls: "ckl-head" });
  top.createEl("span", { cls: "ckl-sub", text: all.length ? `${all.length} checklist${all.length === 1 ? "" : "s"}` : `No checklists yet. New ones go in ${FOLDER}/.` });
  const nb = top.createEl("button", { text: "+ New checklist", cls: "mod-cta" }); nb.style.marginLeft = "auto"; nb.addEventListener("click", () => void newList());
  all.forEach((p, k) => {
    const its = data[k], done = its.filter(x => x.done).length;
    const card = root.createEl("div", { cls: "ckl-card" });
    const head = card.createEl("div", { cls: "ckl-head" });
    const t = head.createEl("strong", { text: p.file.name }); t.addEventListener("click", () => app.workspace.openLinkText(p.file.path, "", false));
    head.createEl("span", { cls: "ckl-sub", text: `${done} of ${its.length} ticked · last reset ${dmy(its.lastReset)}` });
    const tools = head.createEl("span", { cls: "ckl-tools" });
    const rb = tools.createEl("button", { text: "Reset" }); rb.disabled = !done; rb.addEventListener("click", () => void reset(p));
    card.createEl("div", { cls: "ckl-bar" }).createEl("div", { attr: { style: `width:${its.length ? (100 * done / its.length) : 0}%` } });
    const det = card.createEl("details"); if (done && done < its.length) det.open = true;
    det.createEl("summary", { cls: "ckl-sub", text: "Items" });
    const ul = det.createEl("ul", { cls: "ckl-items" });
    for (const x of its) {
      const li = ul.createEl("li", { cls: x.done ? "is-done" : "", attr: { style: `padding-left:${x.depth * 16}px` } });
      const cb = li.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" }); cb.checked = x.done;
      cb.addEventListener("click", e => { e.preventDefault(); void toggle(p.file.path, x); });
      li.createEl("span", { text: x.text || "(empty)" });
    }
    const u = UNDO[p.file.path];
    if (u && Date.now() - u.at < 86400000) { const ub = card.createEl("div", { cls: "ckl-undo" }); ub.appendText(`Reset ${u.changes.length} item${u.changes.length === 1 ? "" : "s"}. `); const b = ub.createEl("button", { text: "Undo" }); b.addEventListener("click", () => void undo(p)); }
  });
}
await render();
