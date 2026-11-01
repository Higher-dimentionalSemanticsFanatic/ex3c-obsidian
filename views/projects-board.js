// The Projects board. Usage: await dv.view("Meta/views/projects-board", { area: null })
// One card per project note (type: project), in a column by its status property: Idea, Active, Paused, Done.
// Drag a card to another column (or pick a status on the card) to change the note's status; + Idea makes a new
// project note with status: idea. Nothing on the board is typed by hand, so it always matches the notes.
const AREA_KEYS = app.plugins?.plugins?.["ex3c-agenda"]?.areaKeys?.() ?? ["work", "study", "personal"];
const AREA = AREA_KEYS.includes(input?.area) ? input.area : null;
const FOLDER = (dv.page("Meta/EX3C Agenda Config") || {}).projects_folder || "04 Projects";
const IDEA_TEMPLATE = "Templates/Project Idea.md";
const COLS = [
  { id: "idea", label: "Idea", match: ["idea", "someday", "maybe"] },
  { id: "active", label: "Active", match: ["active", "in progress", "doing", ""] },
  { id: "paused", label: "Paused", match: ["paused", "on hold", "waiting", "blocked"] },
  { id: "done", label: "Done", match: ["done", "complete", "completed", "archived", "dropped"] },
];
const obs = (() => { try { return require("obsidian"); } catch (e) { return {}; } })();
const notify = m => (obs.Notice ? new obs.Notice(m) : console.warn(m));
const slug = n => n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const dmy = s => (s ? moment(String(s)).format("DD-MM-YYYY") : "");
const UI = (window.__ex3cProjectBoard ??= { undo: null });
UI.open ??= {};
// per device: the area filter and the sort order of the cards
const PREF_KEY = "ex3c-project-board";
const PREF = (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || "{}"); } catch (e) { return {}; } })();
const savePref = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(PREF)); } catch (e) {} };
const CARDS_SHOWN = 6;
const parseEst = s => { const v = String(s ?? "").trim().toLowerCase().replace(",", "."); if (!v) return null; if (/^\d+(\.\d+)?$/.test(v)) return parseFloat(v); let m = 0, hit = false; for (const x of v.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)(?![a-z])/g)) { hit = true; m += parseFloat(x[1]) * (x[2].startsWith("h") ? 60 : 1); } return hit ? m : null; };
const fmtEst = min => { const h = Math.floor(min / 60), m = Math.round(min - h * 60); return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ") || "0m"; };
const money = n => n.toLocaleString(undefined, { style: "currency", currency: "EUR" });
const OPEN_IDS = new Set(dv.pages().file.tasks.where(t => !t.completed && t.status !== "-").array().map(t => t.text.match(/🆔 ([\w-]+)/u)?.[1]).filter(Boolean));
const statusOf = p => String(p.status ?? "").toLowerCase().trim();
const colOf = p => (COLS.find(c => c.match.includes(statusOf(p))) ?? COLS[1]).id;
function projects() {
  return dv.pages().where(p => String(p.type ?? "") === "project" && !/^(Templates|\.trash|scripts|wiki)\//.test(p.file.path) && !/\/templates\//i.test(p.file.path) && !(p.file.tags ?? []).includes("#example")
    && (!AREA || String(p.area ?? "").toLowerCase() === AREA)).sort(p => p.file.name).array();
}
// a project's tasks: the tasks in its own note, plus tasks tagged #project/<slug> anywhere else
function tasksOf(p, tagged) {
  const own = p.file.tasks.array(), seen = new Set(own.map(t => `${t.path}:${t.line}`));
  return own.concat((tagged.get(`#project/${slug(p.file.name)}`) ?? []).filter(t => !seen.has(`${t.path}:${t.line}`)));
}
async function setStatus(p, to) {
  const f = app.vault.getAbstractFileByPath(p.file.path); if (!f) return;
  let before = null;
  await app.fileManager.processFrontMatter(f, fm => {
    before = { status: fm.status ?? null, started: fm.started ?? null, quarter: fm.quarter ?? null };
    fm.status = to;
    if (to === "active") { if (!fm.started) fm.started = moment().format("YYYY-MM-DD"); if (!fm.quarter) fm.quarter = moment().format("YYYY-[Q]Q"); }
  });
  UI.undo = { path: p.file.path, name: p.file.name, before, to, at: Date.now() };
  setTimeout(render, 250);
}
async function undo() {
  const u = UI.undo; if (!u) return; const f = app.vault.getAbstractFileByPath(u.path); if (!f) return;
  await app.fileManager.processFrontMatter(f, fm => { for (const [k, v] of Object.entries(u.before)) { if (v === null) delete fm[k]; else fm[k] = v; } });
  UI.undo = null; setTimeout(render, 250);
}
function ask(title, placeholder) {
  return new Promise(res => {
    const back = document.body.createEl("div", { attr: { style: "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px" } });
    const card = back.createEl("div", { attr: { style: "background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:10px;max-width:420px;width:100%;padding:14px 16px" } });
    card.createEl("div", { text: title, attr: { style: "font-weight:600;margin-bottom:8px" } });
    const inp = card.createEl("input", { type: "text", attr: { style: "width:100%", placeholder } });
    const row = card.createEl("div", { attr: { style: "display:flex;gap:8px;justify-content:flex-end;margin-top:10px" } });
    const no = row.createEl("button", { text: "Cancel" }), yes = row.createEl("button", { text: "Create", cls: "mod-cta" });
    const done = v => { back.remove(); res(v); };
    no.addEventListener("click", () => done(null)); yes.addEventListener("click", () => done(inp.value.trim()));
    inp.addEventListener("keydown", e => { if (e.key === "Enter") done(inp.value.trim()); if (e.key === "Escape") done(null); });
    setTimeout(() => inp.focus(), 0);
  });
}
async function newIdea() {
  const name = (await ask("New project idea", "Name of the project"))?.replace(/[\\/:*?"<>|#^[\]]/g, "").trim();
  if (!name) return;
  if (app.vault.getAbstractFileByPath(`${FOLDER}/${name}.md`)) return notify(`${name} already exists.`);
  const tpl = app.vault.getAbstractFileByPath(IDEA_TEMPLATE), templater = app.plugins.plugins["templater-obsidian"]?.templater;
  let f;
  if (tpl && templater?.create_new_note_from_template) f = await templater.create_new_note_from_template(tpl, FOLDER, name, false);
  else f = await app.vault.create(`${FOLDER}/${name}.md`, "---\ntype: project\nstatus: idea\narea:\ntags:\n  - project\n---\n");
  if (!f) return;
  await app.fileManager.processFrontMatter(f, fm => { fm.status = "idea"; if (AREA) fm.area = AREA; });
  notify(`Project idea added: ${name}.`);
  setTimeout(render, 400);
}
const root = dv.container.createEl("div", { cls: "pjb" });
root.createEl("style", { text: `
.pjb-cols { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 10px; overflow-x: auto; }
@media (max-width: 700px) { .pjb-cols { grid-template-columns: 1fr; overflow-x: visible; } .pjb-col { min-height: 0; } }
.pjb-col { background: var(--background-secondary); border-radius: 8px; padding: 6px; min-height: 80px; }
.pjb-col.is-over { outline: 2px dashed var(--interactive-accent); outline-offset: -2px; }
.pjb-head { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13px; padding: 2px 4px 6px; }
.pjb-head span { color: var(--text-muted); font-weight: 400; }
.pjb-head button { margin-left: auto; font-size: 11px; padding: 1px 8px; height: auto; }
.pjb-card { background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 6px 8px; margin: 6px 0; cursor: grab; font-size: 12px; }
.pjb-card strong { display: block; font-size: 13px; cursor: pointer; } .pjb-card strong:hover { color: var(--text-accent); }
.pjb-sub { color: var(--text-muted); } .pjb-roll { color: var(--text-muted); font-size: 11px; font-variant-numeric: tabular-nums; } .pjb-next { margin-top: 3px; }
.pjb-bar { height: 4px; border-radius: 2px; background: var(--background-modifier-border); overflow: hidden; margin: 4px 0; } .pjb-bar > div { height: 100%; background: var(--interactive-accent); }
.pjb-card select { font-size: 11px; height: auto; padding: 0 4px; margin-top: 4px; }
.pjb-chip { font-size: 10px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--background-modifier-border); margin-left: 4px; }
.pjb-undo { font-size: 12px; margin-bottom: 6px; display: flex; gap: 8px; align-items: center; }
.pjb-undo button { font-size: 11px; padding: 1px 8px; height: auto; }
.pjb-filter { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0 0 8px; font-size: 12px; }
.pjb-filter button { font-size: 11px; padding: 1px 9px; height: auto; border-radius: 10px; }
.pjb-filter button.is-on { background: var(--interactive-accent); color: var(--text-on-accent); }
.pjb-filter select { font-size: 11px; height: auto; padding: 0 4px; margin-left: auto; }
.pjb-more { width: 100%; font-size: 11px; height: auto; padding: 3px 0; margin-top: 2px; }
.pjb-col.is-empty { min-height: 0; } .pjb-col.is-empty .pjb-head { padding-bottom: 2px; }` });
function render() {
  root.querySelectorAll(":scope > :not(style)").forEach(e => e.remove());
  const all = projects();
  // the area filter (not on an area tab, which is one area already) and the sort
  const areaOf = p => String(p.area ?? "").toLowerCase();
  if (!AREA) {
    const keys = [...new Set(all.map(areaOf))].sort((a, b) => (a === "") - (b === "") || AREA_KEYS.indexOf(a) - AREA_KEYS.indexOf(b) || a.localeCompare(b));
    if (PREF.area !== undefined && PREF.area !== "all" && !keys.includes(PREF.area)) PREF.area = "all";
    const bar = root.createEl("div", { cls: "pjb-filter" });
    if (keys.length > 1) for (const k of ["all", ...keys]) {
      const n = k === "all" ? all.length : all.filter(p => areaOf(p) === k).length;
      const b = bar.createEl("button", { text: `${k === "all" ? "All" : k === "" ? "No area" : k[0].toUpperCase() + k.slice(1)} ${n}`, cls: (PREF.area ?? "all") === k ? "is-on" : "" });
      b.addEventListener("click", () => { PREF.area = k; savePref(); render(); });
    }
    const sort = bar.createEl("select", { attr: { "aria-label": "Sort the cards" } });
    for (const [v, t] of [["due", "Due date first"], ["name", "Name"], ["left", "Most time left"]]) sort.createEl("option", { text: t, value: v });
    sort.value = PREF.sort ?? "due";
    sort.addEventListener("change", () => { PREF.sort = sort.value; savePref(); render(); });
  }
  const list = all.filter(p => AREA || (PREF.area ?? "all") === "all" || areaOf(p) === PREF.area);
  const tagged = new Map();
  for (const t of dv.pages().where(p => !/^(Templates|\.trash|scripts|wiki)\//.test(p.file.path)).file.tasks.where(t => (t.tags ?? []).some(x => x.startsWith("#project/"))).array())
    for (const tag of t.tags.filter(x => x.startsWith("#project/"))) { const k = tag.split("/").slice(0, 2).join("/"); if (!tagged.has(k)) tagged.set(k, []); tagged.get(k).push(t); }
  if (UI.undo && Date.now() - UI.undo.at < 600000) {
    const u = root.createEl("div", { cls: "pjb-undo" });
    u.createEl("span", { text: `Moved ${UI.undo.name} to ${COLS.find(c => c.id === UI.undo.to)?.label ?? UI.undo.to}.` });
    const b = u.createEl("button", { text: "Undo" }); b.addEventListener("click", () => void undo());
  }
  const cols = root.createEl("div", { cls: "pjb-cols" });
  for (const col of COLS) {
    const mine = list.filter(p => colOf(p) === col.id);
    const el = cols.createEl("div", { cls: `pjb-col${mine.length ? "" : " is-empty"}`, attr: { "data-col": col.id } });
    const head = el.createEl("div", { cls: "pjb-head", text: col.label });
    head.createEl("span", { text: String(mine.length) });
    if (col.id === "idea") { const add = head.createEl("button", { text: "+ Idea" }); add.addEventListener("click", () => void newIdea()); }
    el.addEventListener("dragover", e => { e.preventDefault(); el.addClass("is-over"); });
    el.addEventListener("dragleave", () => el.removeClass("is-over"));
    el.addEventListener("drop", e => { e.preventDefault(); el.removeClass("is-over"); const p = list.find(x => x.file.path === e.dataTransfer.getData("text/x-ex3c-project")); if (p && colOf(p) !== col.id) void setStatus(p, col.id); });
    // sort: due date first (undated last, by name), by name, or by estimated time left
    const leftOf = p => tasksOf(p, tagged).filter(t => !t.completed && t.status !== "-" && !(t.children ?? []).some(c => c.task)).reduce((m, t) => m + (parseEst(t.text.match(/\[est::\s*([^\]]*)\]/)?.[1]) ?? 0), 0);
    const by = PREF.sort ?? "due";
    if (by === "due") mine.sort((a, b) => (a.due ? String(a.due) : "9999") .localeCompare(b.due ? String(b.due) : "9999") || a.file.name.localeCompare(b.file.name));
    else if (by === "left") { const L = new Map(mine.map(p => [p, leftOf(p)])); mine.sort((a, b) => L.get(b) - L.get(a) || a.file.name.localeCompare(b.file.name)); }
    const showAll = UI.open[col.id] || mine.length <= CARDS_SHOWN + 2;
    for (const p of showAll ? mine : mine.slice(0, CARDS_SHOWN)) {
      const ts = tasksOf(p, tagged), open = ts.filter(t => !t.completed && t.status !== "-"), done = ts.filter(t => t.completed);
      const card = el.createEl("div", { cls: "pjb-card", attr: { draggable: "true" } });
      card.addEventListener("dragstart", e => { e.dataTransfer.setData("text/x-ex3c-project", p.file.path); e.dataTransfer.effectAllowed = "move"; });
      const t = card.createEl("strong", { text: p.file.name }); t.addEventListener("click", () => app.workspace.openLinkText(p.file.path, "", false));
      // roll-up (computed, never written): steps done, estimated time and money still open, blocked steps
      const leaf = t => !(t.children ?? []).some(c => c.task), steps = ts.filter(leaf), openSteps = steps.filter(t => !t.completed && t.status !== "-");
      const f = (t, k) => t.text.match(new RegExp(`\\[${k}::\\s*([^\\]]*)\\]`))?.[1]?.trim();
      const left = openSteps.reduce((m, t) => m + (parseEst(f(t, "est")) ?? 0), 0), noEst = openSteps.filter(t => parseEst(f(t, "est")) === null).length;
      const cost = openSteps.reduce((c, t) => { const p = Number(f(t, "price")); return isNaN(p) || f(t, "price") === undefined ? c : c + p * (Number(f(t, "qty")) || 1); }, 0);
      const blocked = openSteps.filter(t => (t.text.match(/⛔ ([\w-]+(?:\s*,\s*[\w-]+)*)/u)?.[1] ?? "").split(/\s*,\s*/).some(id => id && OPEN_IDS.has(id))).length;
      const sub = card.createEl("div", { cls: "pjb-sub", text: steps.length ? `${steps.length - openSteps.length} of ${steps.length} done` : "No tasks yet" });
      const roll = [left ? `${fmtEst(left)} left` : "", cost ? `${money(cost)} to buy` : "", blocked ? `⛔ ${blocked} blocked` : ""].filter(Boolean);
      const rollEl = roll.length ? card.createEl("div", { cls: "pjb-roll", text: roll.join(" · "), attr: { title: `Computed from the open steps, never written into the note. Time left: their [est::]${noEst ? ` (${noEst} without an estimate are not counted)` : ""}. To buy: price × qty. Blocked: waiting for an open ⛔ task.` } }) : null;
      if (p.area && !AREA) sub.createEl("span", { cls: "pjb-chip", text: String(p.area) });
      if (p.due) sub.appendText(` · due ${dmy(p.due)}`);
      if (steps.length) card.createEl("div", { cls: "pjb-bar" }).createEl("div", { attr: { style: `width:${100 * (steps.length - openSteps.length) / steps.length}%` } });
      const next = p.file.tasks.array().find(t => !t.completed && t.status !== "-" && !(t.children ?? []).some(c => !c.completed));
      if (next && col.id === "active") card.createEl("div", { cls: "pjb-next", text: `Next: ${next.text.replace(/\s*[⏳📅🛫➕✅]\s*\d{4}-\d{2}-\d{2}/gu, "").replace(/\[[\w-]+::[^\]]*\]/g, "").replace(/\s*(?:🆔|⛔)\s*[\w-]+(?:\s*,\s*[\w-]+)*/gu, "").replace(/\s*#project\/\S+/g, "").replace(/[🔺⏫🔼🔽⏬]/gu, "").replace(/\s+/g, " ").trim().replace(/^(.{90}).+$/, "$1…")}` });
      // picking a status works on phones too, where cards cannot be dragged
      const sel = card.createEl("select", { attr: { "aria-label": `Status of ${p.file.name}` } });
      for (const c of COLS) { const o = sel.createEl("option", { text: c.label, value: c.id }); if (c.id === col.id) o.selected = true; }
      sel.addEventListener("change", () => void setStatus(p, sel.value));
    }
    if (mine.length > CARDS_SHOWN + 2) {
      const more = el.createEl("button", { cls: "pjb-more", text: UI.open[col.id] ? `Show the first ${CARDS_SHOWN}` : `Show all ${mine.length} (${mine.length - CARDS_SHOWN} more)` });
      more.addEventListener("click", () => { UI.open[col.id] = !UI.open[col.id]; render(); });
    }
  }
}
render();
