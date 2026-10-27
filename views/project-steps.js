// Task sequence by indentation.
// Usage: await dv.view("Meta/views/project-steps", { files: ["path.md"], section: "Tasks" })
// Numbers each task by its place in the outline (1, 1.1, 1.2, 2 ...) and marks the next step:
// the first open task, top to bottom, that has no open subtasks of its own. A parent with
// [mode:: parallel] makes all of its open steps next at once. [est::] estimates add up per step and project.
// Areas: a task's #<area> tag, otherwise its note's area property (the area list is the app's Areas).
// With allProjects (the EX3C Agenda Project steps widget) you pick projects at the top and each shows as Gantt charts
// (one per heading that holds tasks) or as the numbered steps list. Bars use 🛫 start, ⏳ scheduled and 📅 due;
// steps without dates are drawn dashed, in outline order, from their estimates. Dragging a bar writes real dates.
// the app's Size setting zooms the page: pointer moves arrive zoomed, bar positions are not
const ZM = () => dv.container.currentCSSZoom || 1;
const AREA = input?.area || null;
const AREA_KEYS = app.plugins?.plugins?.["ex3c-agenda"]?.areaKeys?.() ?? ["work", "study", "personal"];
const AREA_TAG = new RegExp(`(^|\\s)#(${AREA_KEYS.join("|") || "(?!)"})(?=\\s|$)`, "i");
const areaOf = (raw, page) => { const m = String(raw).match(AREA_TAG); if (m) return m[2].toLowerCase(); const a = String(page?.area ?? "").toLowerCase(); return AREA_KEYS.includes(a) ? a : null; };
// allProjects: every note with type: project (not templates, trash, or example seed notes), on an area tab only that area.
const files = input?.allProjects
  ? (() => {
      const all = dv.pages().where(p => String(p.type ?? "") === "project" && !["Templates/", ".trash/", "scripts/", "wiki/"].some(e => p.file.path.startsWith(e)) && !/\/templates\//i.test(p.file.path) && (!AREA || areaOf("", p) === AREA));
      const real = all.where(p => !(p.file.tags ?? []).includes("#example"));
      return real.sort(p => p.file.mtime, "desc").file.path.array();
    })()
  : (input?.files ?? [dv.current().file.path]);
if (input?.allProjects && !files.length) dv.paragraph(AREA ? `No ${AREA} projects yet. Give a project note area: ${AREA}.` : "No project notes yet.");
const section = input?.section;
const CUR = input?.currency ?? "EUR";
const money = n => n.toLocaleString(undefined, { style: "currency", currency: CUR });
// Time estimates: [est:: 45m], [est:: 1h 30m], [est:: 1.5h], or a plain number of minutes.
const parseEst = s => { const v = String(s ?? "").trim().toLowerCase().replace(",", "."); if (/^\d+(\.\d+)?$/.test(v)) return parseFloat(v); let m = 0, hit = false; for (const x of v.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)(?![a-z])/g)) { hit = true; m += parseFloat(x[1]) * (x[2].startsWith("h") ? 60 : 1); } return hit ? m : null; };
const fmtEst = min => { const h = Math.floor(min / 60), m = Math.round(min - h * 60); return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ") || "0m"; };
// ---- shared task writing (Dataview views cannot import each other, so this block is repeated) ----
const tasksApi = app.plugins.plugins["obsidian-tasks-plugin"]?.apiV1;
const obs = (() => { try { return require("obsidian"); } catch (e) { return {}; } })();
const notify = msg => (obs.Notice ? new obs.Notice(msg) : console.warn(msg));
const TASK_RE = /^(\s*)[-*+] \[(.)\] /;
const strip = s => s.replace(TASK_RE, "").replace(/\s*✅ \d{4}-\d{2}-\d{2}/, "").trim();
const isDoneLine = s => /^\s*[-*+] \[[xX-]\]/.test(s);
const parseFields = s => { const f = {}; for (const m of s.matchAll(/\[([\w-]+)::\s*([^\]]*)\]/g)) f[m[1]] = m[2].trim(); return f; };
// [with:: previous] on a step: it runs side by side with the step above it instead of after it.
const withPrev = r => /\[with::\s*previous\s*\]/i.test(r.raw);
const num = v => (v === undefined || v === "" || isNaN(Number(v)) ? undefined : Number(v));
const clean = s => strip(s).replace(/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s+/, "").replace(/\[[\w-]+::[^\]]*\]/g, "").replace(/\s*(📅|⏳|🛫|➕|✅|❌) \d{4}-\d{2}-\d{2}/gu, "").replace(/\s*🔁[^📅⏳🛫➕✅❌🔺⏫🔼🔽⏬#^]*/u, "").replace(/[🔺⏫🔼🔽⏬]/gu, "").replace(/\s*(🆔|⛔) [\w-]+(?:\s*,\s*[\w-]+)*/gu, "").replace(/#[\w/-]+/g, "").replace(/\s+/g, " ").trim();
// r = { path, line, raw } where raw is the full task line as last seen.
function findLine(lines, r) {
  const key = strip(r.raw);
  if (lines[r.line] !== undefined && TASK_RE.test(lines[r.line]) && strip(lines[r.line]) === key) return r.line;
  let best = -1;
  lines.forEach((l, i) => { if (TASK_RE.test(l) && strip(l) === key && (best < 0 || Math.abs(i - r.line) < Math.abs(best - r.line))) best = i; });
  return best;
}
async function writeTask(r, mode) {
  const f = app.vault.getAbstractFileByPath(r.path);
  if (!f) { notify(`Note not found: ${r.path}`); return false; }
  const lines = (await app.vault.read(f)).split("\n");
  const i = findLine(lines, r);
  if (i < 0) { notify("That task changed in its note. Reopen this page to refresh."); return false; }
  const line = lines[i];
  let next;
  if (mode === "edit") {
    if (!tasksApi?.editTaskLineModal) { notify("The Tasks plugin edit dialog is not available."); return false; }
    next = await tasksApi.editTaskLineModal(line);
    if (!next) return false;
    const ind = line.match(/^\s*/)[0];
    next = next.split("\n").map(l => (l.startsWith(ind) ? l : ind + l.trimStart())).join("\n");
  } else {
    next = tasksApi?.executeToggleTaskDoneCommand
      ? tasksApi.executeToggleTaskDoneCommand(line, r.path)
      : line.replace(/\[(.)\]/, (m, c) => (c === " " ? "[x]" : "[ ]"));
  }
  let ok = false;
  await app.vault.process(f, data => {
    const L = data.split("\n");
    const j = findLine(L, r);
    if (j < 0) return data;
    const parts = next.split("\n");
    L.splice(j, 1, ...parts);
    r.line = j + parts.length - 1; // Tasks puts a new recurrence above the completed task
    r.raw = parts[parts.length - 1];
    ok = true;
    return L.join("\n");
  });
  if (!ok) notify("That task changed in its note. Reopen this page to refresh.");
  return ok;
}
function iconButton(parent, icon, label, onClick) {
  const b = parent.createEl("span", { cls: "clickable-icon", attr: { "aria-label": label, style: "padding:2px;opacity:0.6" } });
  if (obs.setIcon) obs.setIcon(b, icon); else b.setText("✎");
  b.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); return onClick(); });
  return b;
}
// ---- end shared ----

// ⛔ waits for the open task with that 🆔, anywhere in the vault (as in the Tasks plugin and the planner).
// A step whose blocker is still open shows a ⛔ badge; "available" means nothing it waits for is open.
const OPEN_IDS = new Map();
for (const t of dv.pages().where(p => !["Templates/", ".trash/", "scripts/", "wiki/"].some(e => p.file.path.startsWith(e))).file.tasks.where(t => !t.completed && t.status !== "-").array()) {
  const id = t.text.match(/🆔 ([\w-]+)/u)?.[1];
  if (id) OPEN_IDS.set(id, clean(`- [ ] ${t.text}`));
}
const waitsFor = r => (isDoneLine(r.raw) ? [] : (r.raw.match(/⛔ ([\w-]+(?:\s*,\s*[\w-]+)*)/u)?.[1] ?? "").split(/\s*,\s*/).filter(id => id && OPEN_IDS.has(id)).map(id => OPEN_IDS.get(id)));
const costOf = r => { const f = parseFields(r.raw), p = num(f.price); return p === undefined ? 0 : p * (num(f.qty) ?? 1); };

// ctr is shared with the children of plain (non-task) bullets, so numbering carries on through them
function walk(items, prefix, depth, out, parent, ctr = { n: 0 }) {
  for (const it of items) {
    if (!it.task) { walk(it.children ?? [], prefix, depth, out, parent, ctr); continue; }
    const n = ++ctr.n;
    const r = { path: it.path, line: it.line, raw: `${"\t".repeat(depth)}- [${it.status}] ${it.text}`, num: prefix ? `${prefix}.${n}` : `${n}`, depth, kids: [], up: parent };
    out.push(r);
    if (parent) parent.kids.push(r);
    walk(it.children ?? [], r.num, depth + 1, out, r);
  }
}

function project(path, host = dv.container) {
  const page = dv.page(path);
  if (!page) { host.createEl("p", { text: `Not found: ${path}` }); return; }
  const roots = page.file.lists.where(l => l.parent === undefined || l.parent === null)
    .where(l => !section || l.section?.subpath === section).array();
  const rows = [];
  walk(roots, "", 0, rows, null);
  const box = host.createEl("div", { cls: "lifeos-widget" });

  function draw() {
    box.empty();
    const done = r => isDoneLine(r.raw);
    // Steps run in order unless their parent has [mode:: parallel]; then every open step under it is next.
    const parallel = r => (parseFields(r.raw).mode ?? "").toLowerCase() === "parallel";
    const actionable = r => (done(r) ? [] : r.kids.some(k => !done(k)) ? fromList(r.kids, parallel(r)) : [r]);
    // Same rules as the planner: a purchase never holds up the steps after it, a ⏫ or 🔺 step is next wherever
    // it sits, and a step waiting for an open ⛔ is not next.
    const isPurchase = r => r.kids.every(done) && ("price" in parseFields(r.raw) || /^(buy|order|purchase)\b/i.test(clean(r.raw)));
    const fromList = (list, par) => {
      const open = list.filter(k => !done(k));
      if (par) return open.flatMap(actionable);
      const group = [];
      let i = 0;
      for (; i < open.length; i++) { group.push(open[i]); if (!isPurchase(open[i])) break; }
      for (i++; i < open.length && withPrev(open[i]); i++) group.push(open[i]);
      return group.flatMap(actionable);
    };
    const openIds = new Set(rows.filter(r => !done(r)).map(r => r.raw.match(/🆔 ([\w-]+)/u)?.[1]).filter(Boolean));
    const blocked = r => (r.raw.match(/⛔ ([\w-]+(?:\s*,\s*[\w-]+)*)/u)?.[1] ?? "").split(/\s*,\s*/).some(id => id && openIds.has(id));
    const nexts = [...new Set([...fromList(rows.filter(r => r.depth === 0), false),
      ...rows.filter(r => !done(r) && !r.kids.some(k => !done(k)) && /[🔺⏫]/u.test(r.raw))])].filter(r => !blocked(r));
    const spend = rows.filter(r => !done(r)).reduce((s, r) => { const f = parseFields(r.raw); return s + (num(f.price) ?? 0) * (num(f.qty) ?? 1); }, 0);
    const count = rows.filter(done).length;
    // Time left: a task's own estimate while it is open, plus everything still open under it.
    const own = r => parseEst(parseFields(r.raw).est) ?? 0;
    const left = r => (done(r) ? 0 : own(r)) + r.kids.reduce((s, k) => s + left(k), 0);
    const timeLeft = rows.filter(r => r.depth === 0).reduce((s, r) => s + left(r), 0);
    const unestimated = rows.filter(r => !done(r) && !r.kids.length && parseEst(parseFields(r.raw).est) === null).length;
    const head = box.createEl("div", { attr: { style: "display:flex;justify-content:space-between;align-items:baseline;gap:1em;flex-wrap:wrap" } });
    const a = head.createEl("h4", { attr: { style: "margin:0" } }).createEl("a", { text: page.file.name, cls: "internal-link" });
    a.addEventListener("click", () => app.workspace.openLinkText(path, "", false));
    head.createEl("span", { text: `${count} of ${rows.length} done${timeLeft ? ` · ${fmtEst(timeLeft)} left` : ""}${timeLeft && unestimated ? ` (${unestimated} step${unestimated === 1 ? "" : "s"} without estimate)` : ""}${spend ? ` · ${money(spend)} still to buy` : ""}`, attr: { style: "color:var(--text-muted);font-size:0.9em" } });
    const bar = box.createEl("div", { attr: { style: "height:4px;background:var(--background-modifier-border);border-radius:2px;margin:0.4em 0 0.6em" } });
    bar.createEl("div", { attr: { style: `height:4px;width:${rows.length ? (100 * count / rows.length) : 0}%;background:var(--interactive-accent);border-radius:2px` } });
    box.createEl("div", { text: nexts.length ? `Next: ${nexts.map(n => `${n.num}  ${clean(n.raw)}${own(n) ? ` (${fmtEst(own(n))})` : ""}`).join("  ·  ")}` : "All steps done.", attr: { style: "font-weight:600;margin-bottom:0.4em" } });

    for (const r of rows) {
      const d = done(r), isNext = nexts.includes(r), f = parseFields(r.raw);
      const row = box.createEl("div", { attr: { style: `display:flex;gap:0.5em;align-items:center;padding:2px 4px;margin-left:${r.depth * 1.6}em;border-radius:4px;${isNext ? "background:var(--background-modifier-hover);" : ""}` } });
      const cb = row.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
      cb.checked = d;
      cb.addEventListener("click", async e => {
        e.preventDefault();
        const before = r.raw;
        r.raw = r.raw.replace(/\[(.)\]/, d ? "[ ]" : "[x]"); // show the change right away
        draw();
        r.raw = before;
        if (!(await writeTask(r, "toggle"))) r.raw = before;
        draw();
      });
      row.createEl("span", { text: r.num, attr: { style: "color:var(--text-muted);font-variant-numeric:tabular-nums;min-width:2.5em" } });
      const txt = row.createEl("span", { text: clean(r.raw), attr: { style: `cursor:pointer;${d ? "color:var(--text-faint);text-decoration:line-through;" : ""}` } });
      txt.addEventListener("click", () => app.workspace.openLinkText(path, "", false, { eState: { line: r.line } }));
      const right = row.createEl("span", { attr: { style: "margin-left:auto;display:flex;gap:0.4em;align-items:center" } });
      const price = num(f.price), qty = num(f.qty) ?? 1;
      const mins = r.kids.length ? left(r) : own(r);
      if (mins) right.createEl("span", { text: r.kids.length ? `${fmtEst(mins)} left` : fmtEst(mins), attr: { title: r.kids.length ? "Estimated time still open in this step" : "Estimate", style: `color:var(--text-muted);font-size:0.85em;white-space:nowrap;${r.kids.length ? "font-style:italic;" : ""}` } });
      if (price !== undefined) right.createEl("span", { text: qty !== 1 ? `${qty} × ${money(price)}` : money(price), attr: { style: "color:var(--text-muted);font-size:0.85em;white-space:nowrap" } });
      const wf = waitsFor(r);
      if (wf.length) right.createEl("span", { text: "⛔ blocked", attr: { title: `Waits for: ${wf.join(", ")}`, style: "font-size:0.75em;padding:0 6px;border-radius:8px;border:1px solid var(--color-red);color:var(--color-red);white-space:nowrap" } });
      if (r.kids.length && !d) { const ls = r.kids.flatMap(function lv(k) { return k.kids.length ? k.kids.flatMap(lv) : [k]; }), c = ls.filter(k => !done(k)).reduce((t, k) => t + costOf(k), 0); right.createEl("span", { text: `${ls.filter(done).length} of ${ls.length}${c ? ` · ${money(c)} to buy` : ""}`, attr: { title: "Sub-steps done, and what is still to buy under this step", style: "color:var(--text-muted);font-size:0.85em;white-space:nowrap" } }); }
      if (isNext) right.createEl("span", { text: "next", attr: { style: "font-size:0.75em;padding:0 6px;border-radius:8px;background:var(--interactive-accent);color:var(--text-on-accent)" } });
      iconButton(right, "pencil", "Edit task", async () => { if (await writeTask(r, "edit")) draw(); });
    }
  }
  draw();
}

// ---------- Gantt ----------
const DAY = 86400000;
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const asDate = s => new Date(`${s}T12:00:00`);
const addDays = (s, n) => iso(new Date(asDate(s).getTime() + n * DAY));
const diffDays = (a, b) => Math.round((asDate(b) - asDate(a)) / DAY);
const TODAY = iso(new Date());
const dmy = s => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
// a step's estimate becomes days at this many hours of work per day: the planner's Hours per day (config note)
const HOURS_PER_DAY = input?.hoursPerDay ?? (Number(dv.page("Meta/EX3C Agenda Config.md")?.planner_hours_per_day) || 4);
const BUFFER = Number(dv.page("Meta/EX3C Agenda Config.md")?.planner_buffer ?? 25) || 0; // the planner's Buffer %
const ZOOM = { day: 26, week: 10, month: 3.5 }; // px per day
const STORE = "compass-project-steps";
const ui = (() => { try { return { selected: null, view: {}, zoom: "day", ...JSON.parse(localStorage.getItem(STORE) || "{}") }; } catch (e) { return { selected: null, view: {}, zoom: "day" }; } })();
const saveUi = () => { try { localStorage.setItem(STORE, JSON.stringify(ui)); } catch (e) {} };
const KEEP = (window.__compassSteps ??= { scroll: {} }); // horizontal scroll per chart, kept across Dataview reruns
// The task title column: drag the line between titles and chart (on a phone, press and drag it) to make it wider or
// narrower. The width is kept per device (phone and desktop each their own), every chart uses it.
const LABEL_KEY = window.innerWidth <= 600 ? "labelWPhone" : "labelW";
const labelWidth = () => Math.max(60, Math.min(700, Number(ui[LABEL_KEY]) || (window.innerWidth <= 600 ? 130 : 380)));
function splitter(wrap, labels) {
  const bar = wrap.createEl("div", { cls: "pg-split", attr: { title: "Drag to make the titles wider or narrower; double-click for the standard width" } });
  bar.addEventListener("pointerdown", ev => {
    if (ev.button > 0) return;
    ev.preventDefault(); ev.stopPropagation();
    try { bar.setPointerCapture(ev.pointerId); } catch (err) { /* not a real pointer */ }
    const x0 = ev.clientX, w0 = labels.offsetWidth, z = ZM();
    bar.classList.add("is-dragging");
    const move = e => { const w = Math.max(60, Math.min(700, Math.round(w0 + (e.clientX - x0) / z))); for (const l of dv.container.querySelectorAll(".pg-labels")) l.style.width = `${w}px`; ui[LABEL_KEY] = w; };
    const up = () => { bar.classList.remove("is-dragging"); document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up); saveUi(); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
  });
  bar.addEventListener("dblclick", () => { delete ui[LABEL_KEY]; saveUi(); for (const l of dv.container.querySelectorAll(".pg-labels")) l.style.width = `${labelWidth()}px`; });
}

function setDate(line, emoji, date) {
  const re = new RegExp(`\\s*${emoji} \\d{4}-\\d{2}-\\d{2}`, "u");
  const out = line.replace(re, "");
  if (!date) return out;
  const m = out.match(/\s\^[\w-]+\s*$/);
  return m ? `${out.slice(0, m.index)} ${emoji} ${date}${out.slice(m.index)}` : `${out.trimEnd()} ${emoji} ${date}`;
}
async function writeLine(r, fn) {
  const f = app.vault.getAbstractFileByPath(r.path);
  if (!f) return false;
  let ok = false;
  await app.vault.process(f, data => { const L = data.split("\n"); const j = findLine(L, r); if (j < 0) return data; L[j] = fn(L[j]); r.raw = L[j]; r.line = j; ok = true; return L.join("\n"); });
  if (!ok) notify("That task changed in its note. Reopen this page to refresh.");
  return ok;
}

// ---------- shared by both charts: done steps, parents, folding (option C, 25-10-2026) ----------
// Done and cancelled steps leave the projection: they are drawn where they happened (left of today) or listed as
// "✓ date", never in a future slot. A parent is a band (top level, with its area colour on the left edge) and a
// bracket spanning its open steps, filled to the share done by estimate; ▾/▸ folds it. Steps without an estimate
// say so as text instead of a dashed guess.
const isCancelled = r => /^\s*[-*+] \[-\]/.test(r.raw);
// the default estimate (planner ⚙, default_estimate in the config note): a step without [est::] counts this much, drawn dashed
const DEFAULT_EST = parseEst(dv.page("Meta/EX3C Agenda Config.md")?.default_estimate) || 30;
const isRecur = r => /🔁/u.test(r.raw);
const TIME_RANGE = /^\s*[-*+] \[.\] (\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s/;
const AREA_COLOURS = { work: "#4a7fd4", study: "#8f6bdc", personal: "#4bb38a" };
const areaColour = path => { const a = areaOf("", dv.page(path)); return a ? app.plugins.plugins["ex3c-agenda"]?.areaColors?.()[a] ?? AREA_COLOURS[a] ?? "var(--interactive-accent)" : "var(--interactive-accent)"; };
const leavesOf = r => (r.kids.length ? r.kids.flatMap(leavesOf) : [r]);
function prep(rows) {
  for (const r of rows) {
    r.done = isDoneLine(r.raw); r.cancel = isCancelled(r);
    r.doneOn = r.raw.match(/✅ (\d{4}-\d{2}-\d{2})/u)?.[1] ?? r.raw.match(/❌ (\d{4}-\d{2}-\d{2})/u)?.[1] ?? null;
    const t = r.raw.match(TIME_RANGE), took = t ? (+t[3] * 60 + +t[4]) - (+t[1] * 60 + +t[2]) : null;
    r.took = took > 0 ? took : null;
    r.est = parseEst(parseFields(r.raw).est);
    r.guess = r.est === null; r.estUsed = r.est ?? DEFAULT_EST;
  }
  const settled = r => r.done && r.kids.every(settled);
  for (const r of rows) {
    r.settled = settled(r);
    if (!r.kids.length) continue;
    const ls = leavesOf(r).filter(l => !isRecur(l)); // counts use steps without sub-steps; repeats never count
    r.nLeaves = ls.length; r.nDone = ls.filter(l => l.done).length;
    r.estAll = ls.reduce((s, l) => s + l.estUsed, 0); r.estDone = ls.filter(l => l.done).reduce((s, l) => s + l.estUsed, 0);
    r.lastDone = ls.map(l => l.doneOn).filter(Boolean).sort().pop() ?? r.doneOn;
    r.costLeft = ls.filter(l => !l.done).reduce((t, l) => t + costOf(l), 0);
  }
  for (const r of rows) r.blockedBy = r.kids.length ? [] : waitsFor(r);
}
const foldKey = (path, r) => `${path}#${clean(r.raw)}`;
// a parent that is done with everything under it folds by itself; ▾/▸ overrides that
const isFolded = (path, r) => { const v = ui.fold?.[foldKey(path, r)]; return v === undefined ? r.kids.length > 0 && r.settled : v; };
function visibleRows(rows, path) {
  const out = [];
  const go = list => { for (const r of list) { out.push(r); if (r.kids.length && !isFolded(path, r)) go(r.kids); } };
  go(rows.filter(r => r.depth === 0));
  return out;
}
const shortDate = d => `${d.slice(8, 10)}-${d.slice(5, 7)}`;
// The project note's own deadline (due property, a date): a line on the calendar Gantt, a chip by the project name.
const projectDue = path => { const v = dv.page(path)?.due; const s = v?.toISODate ? v.toISODate() : String(v ?? "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
// what the row says on the right of its name
function rowMeta(r, path) {
  if (r.kids.length) {
    if (r.settled) return `✓ ${r.lastDone ? shortDate(r.lastDone) : "done"} · ${r.nLeaves} step${r.nLeaves === 1 ? "" : "s"}`;
    return `${r.nDone} of ${r.nLeaves}${r.estAll ? ` · ${fmtEst(r.estDone)} of ${fmtEst(r.estAll)}` : ""}${r.costLeft ? ` · ${money(r.costLeft)}` : ""}`;
  }
  if (r.done) return [r.est ? fmtEst(r.est) : "", r.took ? `took ${fmtEst(r.took)}` : r.doneOn ? `✓ ${shortDate(r.doneOn)}` : r.cancel ? "cancelled" : "✓"].filter(Boolean).join(" · ");
  return r.est ? fmtEst(r.est) : `~${fmtEst(DEFAULT_EST)}`;
}
function labelRow(labels, r, i, path, ROW, opts = {}) {
  const top = r.depth === 0 && r.kids.length > 0;
  const lab = labels.createEl("div", { cls: `pg-label${r.done ? " is-done" : ""}${top ? " is-band" : ""}${r.kids.length ? " is-parent" : ""}`, attr: { style: `height:${ROW}px;padding-left:${4 + r.depth * 14}px`, "data-row": i } });
  if (opts.grip) opts.grip(lab);
  const chev = lab.createEl("span", { cls: "pg-chev", text: r.kids.length ? (isFolded(path, r) ? "▸" : "▾") : "" });
  if (r.kids.length) { chev.title = isFolded(path, r) ? "Show its steps" : "Fold its steps"; chev.addEventListener("click", e => { e.stopPropagation(); ui.fold = { ...(ui.fold ?? {}), [foldKey(path, r)]: !isFolded(path, r) }; saveUi(); redraw(); }); }
  const cb = lab.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
  cb.checked = r.done;
  cb.addEventListener("click", async e => { e.preventDefault(); if (await writeTask(r, "toggle")) redraw(); });
  lab.createEl("span", { text: `${r.num} `, cls: "pg-num" });
  const t = lab.createEl("span", { text: clean(r.raw), cls: "pg-text" });
  t.title = clean(r.raw);
  t.addEventListener("click", () => app.workspace.openLinkText(path, "", false, { eState: { line: r.line } }));
  if (r.blockedBy?.length) lab.createEl("span", { cls: "pg-blocked", text: "⛔", attr: { title: `Blocked: waits for ${r.blockedBy.join(", ")}` } });
  lab.createEl("span", { cls: "pg-meta", text: rowMeta(r, path) });
  return lab;
}
// the row behind the chart: a faint band for a top-level parent
const plotRow = (plot, r, top, ROW) => plot.createEl("div", { cls: `pg-row${r.depth === 0 && r.kids.length ? " is-band" : ""}`, attr: { style: `top:${top}px;height:${ROW}px` } });
// a parent's bracket from x0 to x1, filled to the share done; folded, it shows a tick where each open step sits
function bracket(plot, r, top, x0, x1, ticks) {
  const w = Math.max(8, x1 - x0), share = r.estAll ? r.estDone / r.estAll : r.nLeaves ? r.nDone / r.nLeaves : 0;
  const b = plot.createEl("div", { cls: `pg-bracket${r.depth ? " is-nested" : ""}`, attr: { style: `top:${top + 7}px;left:${x0}px;width:${w}px` } });
  b.createEl("div", { cls: "pg-bracket-fill", attr: { style: `width:${Math.round(share * 100)}%` } });
  b.title = `${clean(r.raw)}\n${rowMeta(r)}: the bracket spans its open steps, filled to the share done`;
  for (const tx of ticks || []) plot.createEl("div", { cls: "pg-tickmark", attr: { style: `top:${top + 17}px;left:${tx}px` } });
  return b;
}
const noEstimate = (plot, r, top, x, path) => {
  const n = plot.createEl("div", { cls: "pg-noest", text: "no estimate · add one", attr: { style: `top:${top + 5}px;left:${x}px`, title: "Add [est:: 1h] to the step; it is not drawn until then. Click to open it." } });
  n.addEventListener("click", () => app.workspace.openLinkText(path, "", false, { eState: { line: r.line } }));
};

// Work out a bar for every open task: written dates win; the rest follow the outline (steps in order,
// [mode:: parallel] together). Done steps are placed where they happened (their ✅ date), not in the future.
function schedule(rows) {
  // 🛫 with a later ⏳ is a task the planner spread over several days: the bar runs from 🛫 to ⏳
  const dates = r => { const st = r.raw.match(/🛫 (\d{4}-\d{2}-\d{2})/u)?.[1] ?? null, sc = r.raw.match(/⏳ (\d{4}-\d{2}-\d{2})/u)?.[1] ?? null;
    return { start: st ?? sc, ownStart: !!st, spreadEnd: st && sc && sc > st ? sc : null, due: r.raw.match(/📅 (\d{4}-\d{2}-\d{2})/u)?.[1] ?? null }; };
  // days of work, with the planner's buffer, so an undated bar is as long as the planner would spread the task
  const days = r => { const e = r.est ?? r.took ?? DEFAULT_EST; return e ? Math.max(1, Math.ceil(e * (1 + BUFFER / 100) / (HOURS_PER_DAY * 60))) : 1; };
  const place = (list, earliest, parallel) => {
    let cursor = earliest, end = null;
    const starts = [];
    for (const r of list) {
      const d = dates(r), from = parallel ? earliest : cursor;
      Object.assign(r, { s: null, e: null, inferred: false, due: d.due, hasStart: !!d.start, actual: false, noEst: false });
      if (r.settled) {
        if (!r.kids.length && r.doneOn) Object.assign(r, { e: r.doneOn, s: addDays(r.doneOn, -(days(r) - 1)), actual: true });
        if (r.kids.length) place(r.kids, earliest, true); // its done steps get their own done dates
        continue;
      }
      let s, e, inferred = false;
      if (r.kids.length) {
        const span = place(r.kids, d.start ?? from, (parseFields(r.raw).mode ?? "").toLowerCase() === "parallel");
        s = d.start ?? span.start; e = d.due && (!span.end || d.due > span.end) ? d.due : span.end ?? s;
        inferred = !d.start && !d.due && span.inferred;
        r.parent = true;
      } else if (d.spreadEnd) { s = d.start; e = d.spreadEnd; }
      else if (d.start && d.due && d.ownStart) { s = d.start; e = d.due < d.start ? d.start : d.due; }
      else if (d.start) { s = d.start; e = addDays(s, days(r) - 1); }
      else if (d.due) { e = d.due; s = addDays(e, -(days(r) - 1)); r.dueOnly = true; }
      else { s = from; e = addDays(s, days(r) - 1); inferred = true; }
      Object.assign(r, { s, e, inferred });
      if (!parallel && !r.noEst) { const nextDay = addDays(e, 1); if (nextDay > cursor) cursor = nextDay; }
      if (!r.noEst) { end = !end || e > end ? e : end; starts.push(s); }
    }
    starts.sort();
    return { start: starts[0] ?? earliest, end, inferred: list.filter(r => !r.settled).every(r => r.inferred) };
  };
  place(rows.filter(r => r.depth === 0), TODAY, false);
}

function charts(path, host) {
  const page = dv.page(path);
  if (!page) return;
  const groups = new Map(); // heading -> root list items
  for (const l of page.file.lists.where(l => l.parent === undefined || l.parent === null).array()) {
    const key = l.section?.subpath && l.section.subpath !== page.file.name ? l.section.subpath : "Tasks";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  let any = false;
  for (const [heading, roots] of groups) {
    let rows = [];
    walk(roots, "", 0, rows, null);
    rows = rows.filter(r => clean(r.raw) || r.kids.length); // skip empty "- [ ]" lines
    if (!rows.length || /^done$/i.test(heading) && rows.every(r => isDoneLine(r.raw))) continue;
    any = true;
    for (const r of rows) r.chart = rows;
    prep(rows);
    if (timeModeOf(path) === "sequence") seqGantt(host, path, heading, rows, groups.size > 1);
    else gantt(host, path, heading, rows, groups.size > 1);
  }
  if (!any) host.createEl("p", { text: "No tasks in this project note yet.", attr: { style: "color:var(--text-muted)" } });
}

function gantt(host, path, heading, rows, showHeading) {
  schedule(rows);
  const vis = visibleRows(rows, path);
  const PX = ZOOM[ui.zoom] ?? ZOOM.day, ROW = 26, LABEL = labelWidth();
  const pdue = projectDue(path);
  const all = rows.flatMap(r => [r.s, r.e, r.due].filter(Boolean)).concat([TODAY], pdue ? [pdue] : []).sort();
  const first = addDays(all[0], -2), last = addDays(all[all.length - 1], 4);
  const span = diffDays(first, last) + 1, W = span * PX;
  const x = d => diffDays(first, d) * PX;
  const box = host.createEl("div", { cls: "pg-box", attr: { style: `--area:${areaColour(path)}` } });
  if (showHeading) box.createEl("div", { text: heading, cls: "pg-head" });
  const wrap = box.createEl("div", { cls: "pg-wrap" });
  const labels = wrap.createEl("div", { cls: "pg-labels", attr: { style: `width:${LABEL}px` } });
  splitter(wrap, labels);
  const scroller = wrap.createEl("div", { cls: "pg-scroll" });
  const plot = scroller.createEl("div", { cls: "pg-plot", attr: { style: `width:${W}px;height:${36 + vis.length * ROW}px` } });
  // time axis: month names, then weekday and day, or week starts
  labels.createEl("div", { cls: "pg-axis-pad" });
  for (let i = 0; i < span; i++) {
    const d = addDays(first, i), dt = asDate(d);
    if (dt.getDate() === 1 || i === 0) plot.createEl("div", { cls: "pg-month", text: dt.toLocaleDateString(undefined, { month: "short", year: "numeric" }), attr: { style: `left:${x(d)}px` } });
    const wk = dt.getDay() === 0 || dt.getDay() === 6;
    if (ui.zoom === "day") { if (wk) plot.createEl("div", { cls: "pg-weekend", attr: { style: `left:${x(d)}px;width:${PX}px` } }); plot.createEl("div", { cls: `pg-tick${d === TODAY ? " is-today" : ""}`, text: String(dt.getDate()), attr: { style: `left:${x(d)}px;width:${PX}px`, title: dt.toLocaleDateString(undefined, { weekday: "long" }) } }); }
    else if (dt.getDay() === 1 && ui.zoom === "week") plot.createEl("div", { cls: "pg-tick is-week", text: `${dt.getDate()}-${dt.getMonth() + 1}`, attr: { style: `left:${x(d)}px` } });
  }
  plot.createEl("div", { cls: "pg-today", attr: { style: `left:${x(TODAY) + PX / 2}px`, title: `Today ${dmy(TODAY)}` } });
  if (pdue) plot.createEl("div", { cls: "pg-pdue", text: "⚑", attr: { style: `left:${x(pdue) + PX}px`, title: `Project due ${dmy(pdue)} (the due property of the project note)` } });
  vis.forEach((r, i) => {
    const top = 36 + i * ROW;
    labelRow(labels, r, i, path, ROW);
    plotRow(plot, r, top, ROW);
    if (r.kids.length) {
      if (r.settled) { plot.createEl("div", { cls: "pg-donetext", text: `✓ ${r.lastDone ? shortDate(r.lastDone) : ""}`, attr: { style: `top:${top + 5}px;left:${x(r.lastDone ?? TODAY)}px` } }); return; }
      const folded = isFolded(path, r);
      const ticks = folded ? leavesOf(r).filter(l => !l.done && l.s && !l.noEst).map(l => x(l.s) + 2) : [];
      const b = bracket(plot, r, top, x(r.s), x(r.e) + PX, ticks);
      b.title += `\n${dmy(r.s)} to ${dmy(r.e)}\nDrag to move this step with all its sub-steps`; dragGroup(b, r, PX);
      if (r.due && r.due > r.e) plot.createEl("div", { cls: "pg-due", text: "⚑", attr: { style: `top:${top + 3}px;left:${x(r.due)}px`, title: `Due ${dmy(r.due)}` } });
      return;
    }
    if (r.done) {
      if (r.actual) { const bar = plot.createEl("div", { cls: "pg-bar is-done", attr: { style: `top:${top + 7}px;left:${x(r.s)}px;width:${Math.max(PX - 4, (diffDays(r.s, r.e) + 1) * PX - 4)}px;height:12px` } }); bar.title = `${clean(r.raw)}\nDone ${dmy(r.doneOn)}${r.took ? `, took ${fmtEst(r.took)}` : ""}`; plot.createEl("div", { cls: "pg-check", text: "✓", attr: { style: `top:${top + 4}px;left:${x(r.e) + PX}px` } }); }
      else plot.createEl("div", { cls: "pg-donetext", text: r.cancel ? "cancelled" : "✓ no date", attr: { style: `top:${top + 5}px;left:${x(TODAY) - 70}px` } });
      return;
    }
    if (r.noEst) { noEstimate(plot, r, top, x(r.s), path); return; }
    const late = r.e < TODAY, past = !late && pdue && r.e > pdue;
    const bar = plot.createEl("div", { cls: `pg-bar${r.inferred ? " is-inferred" : ""}${late ? " is-late" : ""}${past ? " is-pastdue" : ""}${r.blockedBy?.length ? " is-blocked" : ""}`,
      attr: { "data-key": `${r.line}`, style: `top:${top + 5}px;left:${x(r.s)}px;width:${Math.max(PX, (diffDays(r.s, r.e) + 1) * PX)}px;height:16px` } });
    bar.title = `${clean(r.raw)}\n${dmy(r.s)} to ${dmy(r.e)}${r.blockedBy?.length ? `\n⛔ Blocked: waits for ${r.blockedBy.join(", ")}` : ""}${r.inferred ? " (not planned yet: placed in outline order from its estimate)" : ""}${late ? "\nOverdue" : ""}${past ? `\nEnds after the project deadline (${dmy(pdue)})` : ""}`;
    if (r.due && r.due > r.e) plot.createEl("div", { cls: "pg-due", text: "⚑", attr: { style: `top:${top + 3}px;left:${x(r.due)}px`, title: `Due ${dmy(r.due)}` } });
    const grip = bar.createEl("div", { cls: "pg-grip", attr: { title: "Drag to change the end date" } });
    linkHandle(bar, r, plot);
    dragBar(bar, r, "move", PX);
    dragBar(grip, r, "end", PX);
  });
  depArrows(plot, vis, r => (r.s && !r.done && !r.noEst && !r.kids.length ? { x0: x(r.s), x1: x(r.e) + PX } : null), ROW);
  const sk = `${path}#${heading}`;
  requestAnimationFrame(() => { scroller.scrollLeft = KEEP.scroll[sk] ?? Math.max(0, x(TODAY) - 3 * PX * (ui.zoom === "day" ? 3 : 7)); });
  scroller.addEventListener("scroll", () => { KEEP.scroll[sk] = scroller.scrollLeft; });
}

// ---------- Sequence mode: no calendar ----------
// The x axis is hours of work still to do, not dates: open steps follow the outline one after another
// ([mode:: parallel] side by side, ⛔ waits for the step with that 🆔), each as long as its [est::]. Done work is
// not on the axis; a step without an estimate takes no room and says so.
const SEQ_ZOOM = { day: 40, week: 14, month: 5 }; // px per hour of work
function projectHasDates(path) {
  const page = dv.page(path);
  return !!page && page.file.tasks.where(t => !t.completed && /[🛫⏳📅] \d{4}-\d{2}-\d{2}/u.test(t.text)).length > 0;
}
// Sequence or Calendar is kept in the project note (gantt_mode), so every device shows the same
const timeModeOf = path => { const m = String(dv.page(path)?.gantt_mode ?? "").toLowerCase(); return ["sequence", "calendar"].includes(m) ? m : ui.timeMode?.[path] ?? (projectHasDates(path) ? "calendar" : "sequence"); };
function sequence(rows) {
  const ids = new Map();
  for (const r of rows) { const id = r.raw.match(/🆔 ([\w-]+)/u)?.[1] ?? parseFields(r.raw).id; if (id) ids.set(id, r); }
  const blockers = r => (r.raw.match(/⛔ ([\w,-]+)/u)?.[1] ?? parseFields(r.raw).dependsOn ?? "").split(",").map(x => x.trim()).filter(Boolean).map(id => ids.get(id)).filter(Boolean);
  const place = (list, from, parallel) => {
    let cursor = from, end = from, prev = null;
    for (const r of list) {
      if (r.settled || (r.done && !r.kids.length)) { r.h0 = r.h1 = undefined; continue; } // done work is off the axis
      let s0 = parallel ? from : withPrev(r) && prev ? prev.h0 : cursor;
      r.prev = prev;
      for (const b of blockers(r)) if (b.h1 !== undefined && b.h1 > s0) s0 = b.h1;
      if (r.kids.length) {
        const span = place(r.kids, s0, (parseFields(r.raw).mode ?? "").toLowerCase() === "parallel");
        Object.assign(r, { h0: s0, h1: span.end, parent: true });
      } else Object.assign(r, { h0: s0, h1: s0 + r.estUsed });
      if (!parallel) cursor = Math.max(cursor, r.h1);
      end = Math.max(end, r.h1);
      prev = r;
    }
    return { end };
  };
  return place(rows.filter(r => r.depth === 0), 0, false).end;
}
function seqGantt(host, path, heading, rows, showHeading) {
  const total = sequence(rows);
  const vis = visibleRows(rows, path);
  const PXH = (SEQ_ZOOM[ui.zoom] ?? SEQ_ZOOM.day) / 60, ROW = 26, LABEL = labelWidth(); // px per minute
  const W = Math.max(300, (total + 120) * PXH);
  const box = host.createEl("div", { cls: "pg-box", attr: { style: `--area:${areaColour(path)}` } });
  if (showHeading) box.createEl("div", { text: heading, cls: "pg-head" });
  const wrap = box.createEl("div", { cls: "pg-wrap" });
  const labels = wrap.createEl("div", { cls: "pg-labels", attr: { style: `width:${LABEL}px` } });
  splitter(wrap, labels);
  const scroller = wrap.createEl("div", { cls: "pg-scroll" });
  const plot = scroller.createEl("div", { cls: "pg-plot", attr: { style: `width:${W}px;height:${36 + vis.length * ROW}px` } });
  labels.createEl("div", { cls: "pg-axis-pad" });
  // axis: hours of work left, with a band per work day (HOURS_PER_DAY hours)
  const step = ui.zoom === "day" ? 60 : ui.zoom === "week" ? 240 : 480;
  const dayMin = HOURS_PER_DAY * 60;
  for (let d = 0; d * dayMin < total + 120; d++) {
    if (d % 2) plot.createEl("div", { cls: "pg-weekend", attr: { style: `left:${d * dayMin * PXH}px;width:${dayMin * PXH}px` } });
    plot.createEl("div", { cls: "pg-month", text: `work day ${d + 1}`, attr: { style: `left:${d * dayMin * PXH}px` } });
  }
  for (let m = 0; m <= total + 120; m += step) plot.createEl("div", { cls: "pg-tick is-week", text: fmtEst(m), attr: { style: `left:${m * PXH}px` } });
  vis.forEach((r, i) => {
    const top = 36 + i * ROW;
    labelRow(labels, r, i, path, ROW, { grip: lab => { const g = lab.createEl("span", { cls: "pg-move", text: "⋮⋮", attr: { title: "Drag up or down to move this step (and its sub-steps) in the note" } }); dragRow(g, r, vis, labels, ROW, "row"); } });
    plotRow(plot, r, top, ROW);
    if (withPrev(r) && r.h0 !== undefined) plot.createEl("div", { cls: "pg-with", text: "∥", attr: { style: `top:${top + 4}px;left:${Math.max(0, r.h0 * PXH - 12)}px`, title: "Runs side by side with the step above" } });
    if (r.kids.length) {
      if (r.settled || r.h0 === undefined) return;
      const folded = isFolded(path, r);
      const ticks = folded ? leavesOf(r).filter(l => !l.done && l.h0 !== undefined && !l.noEst).map(l => l.h0 * PXH + 2) : [];
      const b = bracket(plot, r, top, r.h0 * PXH, r.h1 * PXH, ticks);
      const doneMin = r.estDone, leftMin = Math.max(0, r.estAll - r.estDone);
      b.title += `\ndone ${fmtEst(doneMin)} · left ${fmtEst(leftMin)}`;
      b.style.cursor = "grab"; dragRow(b, r, vis, labels, ROW, "bar", PXH);
      return;
    }
    if (r.done) return; // done work is off the axis; the row says when (and how long it took)
    if (r.noEst) { noEstimate(plot, r, top, r.h0 * PXH, path); return; }
    const len = r.h1 - r.h0;
    const bar = plot.createEl("div", { cls: `pg-bar${r.guess ? " is-inferred" : ""}${r.blockedBy?.length ? " is-blocked" : ""}`, attr: { "data-key": `${r.line}`, style: `top:${top + 5}px;left:${r.h0 * PXH}px;width:${Math.max(6, len * PXH)}px;height:16px` } });
    bar.title = `${clean(r.raw)}\n${r.guess ? `No estimate yet: counted as the default ${fmtEst(DEFAULT_EST)} (dashed)` : `Estimate ${fmtEst(len)}`}\nDrag the right edge to ${r.guess ? "set" : "change"} the estimate`;
    bar.title += r.prev ? "\nDrag left onto the start of the step above to run side by side; drag right to run after it. Drag up or down to move it." : "\nDrag up or down to move it.";
    const egrip = bar.createEl("div", { cls: "pg-grip", attr: { title: "Drag to change the estimate" } });
    dragEst(egrip, bar, r, PXH);
    linkHandle(bar, r, plot);
    dragRow(bar, r, vis, labels, ROW, "bar", PXH);
  });
  const open = rows.filter(r => !r.kids.length && !r.done && !isRecur(r)), done = rows.filter(r => !r.kids.length && r.done && !isRecur(r));
  const pdue = projectDue(path);
  const left = open.reduce((s, r) => s + r.estUsed, 0), doneMin = done.reduce((s, r) => s + (r.est ?? r.took ?? 0), 0), noEst = open.filter(r => r.guess).length;
  box.createEl("div", { cls: "pg-legend", attr: { style: "padding:2px 8px 4px" }, text: `Done ${fmtEst(doneMin)} · left ${fmtEst(left)}, about ${Math.max(1, Math.ceil(left / dayMin))} work day${Math.ceil(left / dayMin) === 1 ? "" : "s"} at ${HOURS_PER_DAY}h a day${noEst ? `; ${noEst} step${noEst === 1 ? "" : "s"} without an estimate counted at the default ${fmtEst(DEFAULT_EST)} (dashed)` : ""}.${pdue ? ` Project due ${dmy(pdue)}: ${(n => n < 0 ? `${-n} days over` : `${n} day${n === 1 ? "" : "s"} left${Math.ceil(left / dayMin) > n ? ", fewer than the work days needed" : ""}`)(diffDays(TODAY, pdue))}.` : ""}` });
  depArrows(plot, vis, r => (r.h0 !== undefined && !r.done && !r.noEst && !r.kids.length ? { x0: r.h0 * PXH, x1: r.h1 * PXH } : null), ROW);
  const sk = `seq:${path}#${heading}`;
  requestAnimationFrame(() => { scroller.scrollLeft = KEEP.scroll[sk] ?? 0; });
  scroller.addEventListener("scroll", () => { KEEP.scroll[sk] = scroller.scrollLeft; });
}
// Move a step (with its sub-steps) to another place in the outline, or line it up with the step above.
// Up/down: drops it before the step it is over, at that step's indent (so it can become a sub-step), or after the
// last step when dropped below them all. Left/right (bars only): start of the step above = side by side.
function dragRow(el, r, rows, labels, ROW, kind, PXH = 0) {
  el.addEventListener("touchmove", ev => { if (el._drag?.active) ev.preventDefault(); }, { passive: false });
  el.addEventListener("pointerdown", ev => {
    if (ev.button > 0 || ev.target.classList.contains("pg-grip")) return;
    ev.stopPropagation();
    const d = { x0: ev.clientX, y0: ev.clientY, active: false, touch: ev.pointerType === "touch" };
    el._drag = d;
    const bar = kind === "bar" ? el : null, left0 = bar?.offsetLeft ?? 0, top0 = bar?.offsetTop ?? 0;
    const begin = () => { d.active = true; (bar ?? el.parentElement).classList.add("is-dragging"); };
    if (d.touch) d.timer = setTimeout(begin, 300);
    const box = labels.getBoundingClientRect();
    const z = ZM(), rowAt = y => Math.floor(((y - box.top) / z - 36) / ROW);
    let marker = null;
    const move = e => {
      const dx = (e.clientX - d.x0) / z, dy = (e.clientY - d.y0) / z;
      if (!d.active) { if (d.touch) { if (Math.hypot(dx, dy) > 8) end(null); return; } if (Math.hypot(dx, dy) < 5) return; begin(); }
      d.vertical = Math.abs(dy) > Math.abs(dx) || kind === "row";
      marker?.remove(); marker = null;
      if (d.vertical) {
        const at = Math.max(0, Math.min(rows.length, rowAt(e.clientY + (ROW * z) / 2)));
        d.target = at;
        marker = labels.createEl("div", { cls: "pg-drop", attr: { style: `top:${36 + at * ROW - 1}px` } });
        if (bar) { bar.style.left = `${left0}px`; bar.style.top = `${top0 + dy}px`; }
      } else if (bar && PXH) {
        const x = left0 + dx;
        d.side = r.prev && !r.parent ? Math.abs(x - r.prev.h0 * PXH) < Math.abs(x - r.prev.h1 * PXH) : null;
        if (d.side !== null) bar.style.left = `${(d.side ? r.prev.h0 : r.prev.h1) * PXH}px`;
        bar.style.top = `${top0}px`;
      }
    };
    const end = async (e) => {
      clearTimeout(d.timer); document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", cancel);
      el._drag = null; marker?.remove();
      const reset = () => { (bar ?? el.parentElement).classList.remove("is-dragging"); if (bar) { bar.style.left = `${left0}px`; bar.style.top = `${top0}px`; } };
      if (!d.active || !e) return reset();
      if (d.vertical) {
        const target = rows[d.target] ?? null, i = rows.indexOf(r);
        if (d.target === i || d.target === i + 1 + countDesc(r)) return reset();
        if (await moveBlock(r, target, rows)) redraw(); else reset();
      } else if (d.side !== null && d.side !== undefined && d.side !== withPrev(r)) {
        if (await writeLine(r, line => d.side ? setField(line, "with", "previous") : setField(line, "with", null))) redraw(); else reset();
      } else reset();
    };
    const up = e => void end(e), cancel = () => void end(null);
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", cancel);
  });
}
const countDesc = r => r.kids.reduce((n, k) => n + 1 + countDesc(k), 0);
function setField(line, key, val) {
  const re = new RegExp(`\\s*\\[${key}::[^\\]]*\\]`);
  const out = line.replace(re, "");
  if (val === null) return out;
  const m = out.match(/\s(?:[🔺⏫🔼🔽⏬🔁➕⏳🛫📅✅❌🆔⛔]|\^[\w-]+\s*$)/u);
  return m ? `${out.slice(0, m.index)} [${key}:: ${val}]${out.slice(m.index)}` : `${out.trimEnd()} [${key}:: ${val}]`;
}
// Cut the task's line and every more-indented line under it, and paste it before `target` at target's indent
// (or after the last step of this chart when target is null).
async function moveBlock(r, target, rows) {
  const f = app.vault.getAbstractFileByPath(r.path);
  if (!f) return false;
  let ok = false;
  await app.vault.process(f, data => {
    const L = data.split("\n");
    const a = findLine(L, r);
    if (a < 0) return data;
    const ind = l => l.match(/^\s*/)[0].replace(/ {4}/g, "\t").length;
    const base = ind(L[a]);
    let b = a + 1;
    while (b < L.length && L[b].trim() !== "" && ind(L[b]) > base) b++;
    const block = L.slice(a, b);
    let t, newIndent;
    if (target) {
      const ti = findLine(L, target);
      if (ti < 0 || (ti >= a && ti < b)) return data; // not into itself
      t = ti; newIndent = L[ti].match(/^\s*/)[0];
    } else {
      const last = rows[rows.length - 1], li = findLine(L, last);
      if (li < 0 || (li >= a && li < b)) return data;
      t = li + 1;
      while (t < L.length && L[t].trim() !== "" && ind(L[t]) > ind(L[li])) t++;
      newIndent = rows.find(x => x.depth === 0) ? L[findLine(L, rows.find(x => x.depth === 0))].match(/^\s*/)[0] : "";
    }
    const oldIndent = L[a].match(/^\s*/)[0];
    const moved = block.map(l => newIndent + l.slice(Math.min(oldIndent.length, l.match(/^\s*/)[0].length)));
    L.splice(a, b - a);
    const at = t > a ? t - (b - a) : t;
    L.splice(at, 0, ...moved);
    ok = true;
    return L.join("\n");
  });
  if (!ok) notify("Could not move that step. Reopen this page to refresh.");
  return ok;
}

// Replace [est::], or put it before the first Tasks emoji field so the Tasks plugin still reads the line.
function setEst(line, val) {
  if (/\[est::[^\]]*\]/.test(line)) return line.replace(/\[est::[^\]]*\]/, `[est:: ${val}]`);
  const m = line.match(/\s(?:[🔺⏫🔼🔽⏬🔁➕⏳🛫📅✅❌🆔⛔]|\^[\w-]+\s*$)/u);
  return m ? `${line.slice(0, m.index)} [est:: ${val}]${line.slice(m.index)}` : `${line.trimEnd()} [est:: ${val}]`;
}
// Drag a bar's right edge to set its [est::] in 15 minute steps (phone: press and hold first).
function dragEst(grip, bar, r, PXH) {
  grip.addEventListener("touchmove", ev => { if (grip._drag?.active) ev.preventDefault(); }, { passive: false });
  grip.addEventListener("pointerdown", ev => {
    if (ev.button > 0) return;
    ev.stopPropagation();
    const d = { x0: ev.clientX, y0: ev.clientY, active: false, touch: ev.pointerType === "touch" }, w0 = bar.offsetWidth;
    grip._drag = d;
    const len0 = r.h1 - r.h0;
    const begin = () => { d.active = true; bar.classList.add("is-dragging"); };
    if (d.touch) d.timer = setTimeout(begin, 300);
    const minutes = e => Math.max(15, Math.round((len0 + (e.clientX - d.x0) / ZM() / PXH) / 15) * 15);
    const move = e => {
      if (!d.active) { if (d.touch) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 8) end(null); return; } if (Math.abs(e.clientX - d.x0) < 4) return; begin(); }
      d.min = minutes(e); bar.style.width = `${d.min * PXH}px`; bar.title = `Estimate ${fmtEst(d.min)}`;
    };
    const end = async (e) => {
      clearTimeout(d.timer); document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", cancel);
      grip._drag = null;
      if (!d.active || !e || !d.min || d.min === len0) { bar.classList.remove("is-dragging"); bar.style.width = `${w0}px`; return; }
      const val = fmtEst(d.min);
      if (await writeLine(r, line => setEst(line, val))) redraw();
    };
    const up = e => void end(e), cancel = () => void end(null);
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", cancel);
  });
}

// Drag a bar sideways to move it (keeps its length), or its right edge to change the end. Mouse: press and move.
// Phone: press and hold, then move. Writes ⏳ for one day, or 🛫 and ⏳ for several; never changes a 📅 deadline.
function dragBar(el, r, kind, PX) {
  el.addEventListener("touchmove", ev => { if (el._drag?.active) ev.preventDefault(); }, { passive: false });
  el.addEventListener("pointerdown", ev => {
    if (ev.button > 0 || (kind === "move" && ev.target.classList.contains("pg-grip"))) return;
    ev.stopPropagation();
    const d = { x0: ev.clientX, y0: ev.clientY, active: false, touch: ev.pointerType === "touch", delta: 0 };
    el._drag = d;
    const bar = kind === "end" ? el.parentElement : el, left0 = bar.offsetLeft, w0 = bar.offsetWidth;
    const begin = () => { d.active = true; bar.classList.add("is-dragging"); };
    if (d.touch) d.timer = setTimeout(begin, 300);
    const move = e => {
      const dx = (e.clientX - d.x0) / ZM();
      if (!d.active) { if (d.touch) { if (Math.hypot(dx, e.clientY - d.y0) > 8) end(false); return; } if (Math.abs(dx) < 4) return; begin(); }
      d.delta = Math.round(dx / PX);
      if (kind === "move") bar.style.left = `${left0 + d.delta * PX}px`; else bar.style.width = `${Math.max(PX, w0 + d.delta * PX)}px`;
      bar.title = kind === "move" ? `${dmy(addDays(r.s, d.delta))} to ${dmy(addDays(r.e, d.delta))}` : `ends ${dmy(addDays(r.e, d.delta))}`;
    };
    const end = async (commit = true) => {
      clearTimeout(d.timer); document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", cancel);
      el._drag = null;
      if (!d.active || !commit || !d.delta) { bar.classList.remove("is-dragging"); bar.style.left = `${left0}px`; bar.style.width = `${w0}px`; return; }
      const s = kind === "move" ? addDays(r.s, d.delta) : r.s, e2 = kind === "move" ? addDays(r.e, d.delta) : addDays(r.e, d.delta) < r.s ? r.s : addDays(r.e, d.delta);
      const useSched = !r.hasStart && /⏳/u.test(r.raw);
      // a task the planner spread over days (🛫 to a later ⏳) keeps that form, so the planner and the chart agree
      const spread = r.hasStart && (r.raw.match(/⏳ (\d{4}-\d{2}-\d{2})/u)?.[1] ?? "") > (r.raw.match(/🛫 (\d{4}-\d{2}-\d{2})/u)?.[1] ?? "9");
      // Dragging plans, it never moves a deadline: one day writes ⏳, several days 🛫 first day and ⏳ last day
      // (the planner's form for a task spread over days). 📅 stays as it was.
      void spread; void useSched;
      const own = line => (s === e2 ? setDate(setDate(line, "🛫", null), "⏳", s) : setDate(setDate(line, "🛫", s), "⏳", e2));
      if (await moveWithChain(r, own, s, diffDays(r.e, e2), e2)) redraw(); else { bar.classList.remove("is-dragging"); bar.style.left = `${left0}px`; bar.style.width = `${w0}px`; }
    };
    const up = () => void end(true), cancel = () => void end(false);
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", cancel);
  });
}

// Drag a parent bar sideways: the step and every open sub-step under it move by the same number of days.
// Written dates (🛫 ⏳ 📅) shift; a parent without its own start gets 🛫 so undated sub-steps follow it.
// Changing several tasks asks first (count and list) and can be undone (shared Undo with the planner).
const shiftDate = (line, emoji, n) => line.replace(new RegExp(`${emoji} (\\d{4}-\\d{2}-\\d{2})`, "u"), (m, d) => `${emoji} ${addDays(d, n)}`);
const shiftLine = (line, n) => ["🛫", "⏳", "📅"].reduce((l, e) => shiftDate(l, e, n), line);
const descendants = r => r.kids.flatMap(k => [k, ...descendants(k)]);
const UNDO_KEY = "compass-proto-planner-undo"; // the planner's key, so its Undo bar covers this too
const loadUndo = () => { try { return JSON.parse(localStorage.getItem(UNDO_KEY) || "null"); } catch (e) { return null; } };
function confirmBox(title, lines, yesText) {
  return new Promise(resolve => {
    const back = document.body.createEl("div", { attr: { style: "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px" } });
    const card = back.createEl("div", { attr: { style: "background:var(--background-primary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:10px;max-width:560px;width:100%;padding:14px 16px;box-shadow:var(--shadow-l)" } });
    card.createEl("div", { text: `${title}?`, attr: { style: "font-weight:600;font-size:15px;margin-bottom:6px" } });
    const ul = card.createEl("ul", { attr: { style: "max-height:45vh;overflow:auto;font-size:12px;margin:4px 0;padding-left:18px" } });
    for (const l of lines) ul.createEl("li", { text: l });
    card.createEl("div", { text: "You can undo this afterwards with Undo above the chart.", attr: { style: "color:var(--text-muted);font-size:12px;margin:6px 0 10px" } });
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
async function moveGroup(r, n) {
  const list = [r, ...descendants(r)].filter(x => !x.done);
  const fnFor = x => line => { let next = shiftLine(line, n); if (x === r && !/[🛫⏳] \d{4}-\d{2}-\d{2}/u.test(line)) next = setDate(next, "🛫", addDays(x.s, n)); return next; };
  const plan = list.map(x => ({ x, fn: fnFor(x) })).filter(c => c.fn(c.x.raw) !== c.x.raw);
  const undated = list.filter(x => x !== r && !/[🛫⏳📅] \d{4}-\d{2}-\d{2}/u.test(x.raw)).length;
  if (!plan.length) return false;
  const sign = n > 0 ? `+${n}` : `${n}`, days = `${sign} day${Math.abs(n) === 1 ? "" : "s"}`;
  const lines = plan.map(({ x }) => `${x.num} ${clean(x.raw)}: ${dmy(x.s)} to ${dmy(addDays(x.s, n))}`);
  if (undated) lines.push(`${undated} sub-step${undated === 1 ? "" : "s"} without dates follow along (nothing written)`);
  if (!(await confirmBox(`Move "${clean(r.raw)}" and its sub-steps ${days}`, lines, `Move ${plan.length} task${plan.length === 1 ? "" : "s"}`))) return false;
  const f = app.vault.getAbstractFileByPath(r.path);
  if (!f) return false;
  const items = [];
  await app.vault.process(f, data => {
    const L = data.split("\n");
    for (const { x, fn } of plan) { const j = findLine(L, x); if (j < 0) continue; const next = fn(L[j]); if (next === L[j]) continue; items.push({ path: r.path, before: L[j], after: next }); L[j] = next; }
    return L.join("\n");
  });
  if (items.length < plan.length) notify(`${plan.length - items.length} task${plan.length - items.length === 1 ? "" : "s"} had changed in the note and were left alone.`);
  try { localStorage.setItem(UNDO_KEY, JSON.stringify({ title: `Moved "${clean(r.raw)}" ${days}`, at: Date.now(), items })); } catch (e) {}
  return items.length > 0;
}
async function undoLast() {
  const u = loadUndo();
  if (!u?.items?.length) return;
  let back = 0, changed = 0;
  for (const [path, its] of Object.entries(u.items.reduce((m, it) => ((m[it.path] ??= []).push(it), m), {}))) {
    const f = app.vault.getAbstractFileByPath(path);
    if (!f) { changed += its.length; continue; }
    await app.vault.process(f, data => {
      const L = data.split("\n");
      for (const it of its) { const i = L.indexOf(it.after); if (i < 0) { changed++; continue; } if (it.before === null) L.splice(i, 1); else L[i] = it.before; back++; }
      return L.join("\n");
    });
  }
  try { localStorage.removeItem(UNDO_KEY); } catch (e) {}
  notify(`Undone: ${back} task${back === 1 ? "" : "s"} put back${changed ? `; ${changed} had changed since and were left alone` : ""}.`);
}
function dragGroup(el, r, PX) {
  el.addEventListener("touchmove", ev => { if (el._drag?.active) ev.preventDefault(); }, { passive: false });
  el.addEventListener("pointerdown", ev => {
    if (ev.button > 0) return;
    ev.stopPropagation();
    const d = { x0: ev.clientX, y0: ev.clientY, active: false, touch: ev.pointerType === "touch", delta: 0 };
    el._drag = d;
    // the parent's sub-step bars travel with it while dragging
    const plot = el.parentElement, mine = [el, ...descendants(r).map(k => plot.querySelector(`[data-key="${CSS.escape(`${k.line}`)}"]`)).filter(Boolean)];
    const left0 = mine.map(b => b.offsetLeft);
    const begin = () => { d.active = true; mine.forEach(b => b.classList.add("is-dragging")); };
    if (d.touch) d.timer = setTimeout(begin, 300);
    const move = e => {
      const dx = (e.clientX - d.x0) / ZM();
      if (!d.active) { if (d.touch) { if (Math.hypot(dx, e.clientY - d.y0) > 8) end(false); return; } if (Math.abs(dx) < 4) return; begin(); }
      d.delta = Math.round(dx / PX);
      mine.forEach((b, i) => { b.style.left = `${left0[i] + d.delta * PX}px`; });
      el.title = `${dmy(addDays(r.s, d.delta))} to ${dmy(addDays(r.e, d.delta))}`;
    };
    const reset = () => mine.forEach((b, i) => { b.classList.remove("is-dragging"); b.style.left = `${left0[i]}px`; });
    const end = async (commit = true) => {
      clearTimeout(d.timer); document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", cancel);
      el._drag = null;
      if (!d.active || !commit || !d.delta) return reset();
      if (await moveGroup(r, d.delta)) redraw(); else reset();
    };
    const up = () => void end(true), cancel = () => void end(false);
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", cancel);
  });
}

// ---------- chains and links (ideas from Operon, 28-10-2026) ----------
// Moving a step can carry the steps after it: its later siblings (the steps that follow it in the outline) and the
// steps that wait for it (⛔ its 🆔), all by the same number of days. Only 🛫 and ⏳ shift; 📅 deadlines never move.
// Undated steps follow by themselves. If the step now starts before a parent's own 🛫, the parent's 🛫 can widen to
// fit. Everything asks first, and Undo above the chart puts it back.
const idOf = r => r.raw.match(/🆔 ([\w-]+)/u)?.[1] ?? null;
const depsOf = r => (r.raw.match(/⛔ ([\w-]+(?:\s*,\s*[\w-]+)*)/u)?.[1] ?? "").split(/\s*,\s*/).filter(Boolean);
const shiftPlan = (line, n) => ["🛫", "⏳"].reduce((l, e) => shiftDate(l, e, n), line);
const hasPlanDate = r => /[🛫⏳] \d{4}-\d{2}-\d{2}/u.test(r.raw);
function followers(r, n, { sib, dep }) {
  const rows = r.chart ?? [], moved = new Set([r]), open = x => !isDoneLine(x.raw);
  const add = x => { if (moved.has(x) || !open(x)) return false; moved.add(x); for (const k of descendants(x)) if (open(k)) moved.add(k); return true; };
  const why = new Map();
  if (sib) {
    // later siblings of the step and of each of its parents: everything after it in the outline
    for (let x = r; x; x = x.up) { const list = x.up ? x.up.kids : rows.filter(y => y.depth === 0); for (const y of list.slice(list.indexOf(x) + 1)) if (add(y)) why.set(y, "later step"); }
  }
  if (dep) {
    let grew = true;
    while (grew) {
      grew = false;
      const ids = new Set([...moved].map(idOf).filter(Boolean));
      for (const y of rows) if (!moved.has(y) && open(y) && depsOf(y).some(id => ids.has(id))) { add(y); why.set(y, "waits for it (⛔)"); grew = true; }
    }
  }
  moved.delete(r);
  return { list: [...moved], why };
}
async function moveWithChain(r, ownFn, newStart, n, newEnd = null) {
  const C = (ui.chain ??= { sib: true, dep: true, widen: true });
  // a parent with its own 🛫 later than the step's new start can widen (idea 9; never touches 📅 or the project's due)
  const widen = [];
  for (let p = r.up; p; p = p.up) { const st = p.raw.match(/🛫 (\d{4}-\d{2}-\d{2})/u)?.[1]; if (st && newStart < st) widen.push(p); }
  const fAll = n ? followers(r, n, { sib: true, dep: true }) : { list: [], why: new Map() };
  const dated = fAll.list.filter(hasPlanDate);
  if (!dated.length && !widen.length) return writeLine(r, ownFn);
  const days = `${n > 0 ? "+" : ""}${n} day${Math.abs(n) === 1 ? "" : "s"}`;
  const choice = await new Promise(resolve => {
    const back = document.body.createEl("div", { cls: "pg-chain-back", attr: { style: "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px" } });
    const card = back.createEl("div", { attr: { style: "background:var(--background-primary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:10px;max-width:560px;width:100%;padding:14px 16px;box-shadow:var(--shadow-l)" } });
    card.createEl("div", { text: `Move "${clean(r.raw)}"${n ? ` ${days}` : ""}`, attr: { style: "font-weight:600;font-size:15px;margin-bottom:6px" } });
    const st = { ...C };
    const listEl = card.createEl("ul", { attr: { style: "max-height:40vh;overflow:auto;font-size:12px;margin:4px 0;padding-left:18px" } });
    const box = (key, text, count) => { if (!count) return; const l = card.createEl("label", { attr: { style: "display:flex;gap:6px;align-items:center;font-size:13px;margin:4px 0" } }); const i = l.createEl("input", { type: "checkbox" }); i.checked = !!st[key]; l.appendText(text); i.addEventListener("change", () => { st[key] = i.checked; paint(); }); listEl.before(l); };
    const nSib = followers(r, n, { sib: true, dep: false }).list.filter(hasPlanDate).length, nDep = followers(r, n, { sib: false, dep: true }).list.filter(hasPlanDate).length;
    box("sib", ` Also move the later steps ${days} (${nSib} with dates)`, n && nSib);
    box("dep", ` Also move the steps that wait for it, ⛔ (${nDep} with dates)`, n && nDep);
    box("widen", ` Widen ${widen.length === 1 ? `"${clean(widen[0].raw)}"` : `${widen.length} parent steps`} to start ${dmy(newStart)} (🛫)`, widen.length);
    const paint = () => {
      listEl.empty();
      listEl.createEl("li", { text: `${r.num} ${clean(r.raw)}: ${dmy(newStart)}${newEnd && newEnd !== newStart ? ` to ${dmy(newEnd)}` : ""} (this step)` });
      const f = n ? followers(r, n, st) : { list: [], why: new Map() };
      for (const y of f.list.filter(hasPlanDate)) { const d0 = y.raw.match(/[🛫⏳] (\d{4}-\d{2}-\d{2})/u)[1]; listEl.createEl("li", { text: `${y.num} ${clean(y.raw)}: ${dmy(d0)} to ${dmy(addDays(d0, n))} (${f.why.get(y) ?? "inside a later step"})` }); }
      const und = f.list.filter(y => !hasPlanDate(y)).length;
      if (und) listEl.createEl("li", { text: `${und} step${und === 1 ? "" : "s"} without dates follow along (nothing written)`, attr: { style: "color:var(--text-muted)" } });
      if (st.widen) for (const p of widen) listEl.createEl("li", { text: `${p.num} ${clean(p.raw)}: start ${dmy(p.raw.match(/🛫 (\d{4}-\d{2}-\d{2})/u)[1])} to ${dmy(newStart)}` });
    };
    paint();
    card.createEl("div", { text: "Only 🛫 and ⏳ change; 📅 deadlines stay. You can undo this with Undo above the chart.", attr: { style: "color:var(--text-muted);font-size:12px;margin:6px 0 10px" } });
    const row = card.createEl("div", { attr: { style: "display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap" } });
    const no = row.createEl("button", { text: "Cancel" }), only = row.createEl("button", { text: "Only this step" }), yes = row.createEl("button", { text: "Move", cls: "mod-cta" });
    const done = v => { document.removeEventListener("keydown", key, true); back.remove(); resolve(v); };
    const key = e => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
    document.addEventListener("keydown", key, true);
    no.addEventListener("click", () => done(null)); only.addEventListener("click", () => done({ sib: false, dep: false, widen: false })); yes.addEventListener("click", () => done(st));
    back.addEventListener("click", e => { if (e.target === back) done(null); });
    yes.focus();
  });
  if (!choice) return false;
  Object.assign(C, choice); saveUi();
  const plan = [{ x: r, fn: ownFn }];
  if (n) for (const y of followers(r, n, choice).list.filter(hasPlanDate)) plan.push({ x: y, fn: line => shiftPlan(line, n) });
  if (choice.widen) for (const p of widen) plan.push({ x: p, fn: line => setDate(line, "🛫", newStart) });
  return applyPlan(r.path, plan, `Moved "${clean(r.raw)}"${plan.length > 1 ? ` and ${plan.length - 1} more` : ""}`);
}
// several line edits in one note, in one write, with the shared Undo
async function applyPlan(path, plan, title) {
  const f = app.vault.getAbstractFileByPath(path);
  if (!f) return false;
  const items = [];
  await app.vault.process(f, data => {
    const L = data.split("\n");
    for (const { x, fn } of plan) { const j = findLine(L, x); if (j < 0) continue; const next = fn(L[j]); if (next === L[j]) continue; items.push({ path, before: L[j], after: next }); L[j] = next; }
    return L.join("\n");
  });
  if (items.length < plan.length) notify(`${plan.length - items.length} task${plan.length - items.length === 1 ? "" : "s"} had changed in the note (or needed no change) and were left alone.`);
  if (items.length) try { localStorage.setItem(UNDO_KEY, JSON.stringify({ title, at: Date.now(), items })); } catch (e) {}
  return items.length > 0;
}
// Drag from the dot at a bar's right end onto another bar: that step now waits for this one (writes 🆔 here, ⛔ there).
const newId = () => Math.random().toString(36).slice(2, 8).padEnd(6, "0");
const addSign = (line, emoji, val) => { const m = line.match(/\s\^[\w-]+\s*$/); return m ? `${line.slice(0, m.index)} ${emoji} ${val}${line.slice(m.index)}` : `${line.trimEnd()} ${emoji} ${val}`; };
function linkHandle(bar, r, plot) {
  const dot = bar.createEl("div", { cls: "pg-link", attr: { title: "Drag onto another step: that step then waits for this one (⛔)" } });
  dot.addEventListener("touchmove", ev => { if (dot._drag?.active) ev.preventDefault(); }, { passive: false });
  dot.addEventListener("pointerdown", ev => {
    if (ev.button > 0) return;
    ev.stopPropagation(); ev.preventDefault();
    const d = { x0: ev.clientX, y0: ev.clientY, active: false, touch: ev.pointerType === "touch" };
    dot._drag = d;
    const pr = plot.getBoundingClientRect(), b = bar.getBoundingClientRect();
    const sx = b.right - pr.left, sy = b.top + b.height / 2 - pr.top;
    let line = null, over = null;
    const begin = () => { d.active = true; line = plot.createEl("div", { cls: "pg-linkline" }); };
    if (d.touch) d.timer = setTimeout(begin, 300); else begin();
    const targetAt = e => { const el = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.classList?.contains("pg-bar") && x !== bar && x.closest(".pg-plot") === plot); return el ? (r.chart ?? []).find(y => `${y.line}` === el.dataset.key) ?? null : null; };
    const move = e => {
      if (!d.active) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 8) end(null); return; }
      const ex = e.clientX - pr.left, ey = e.clientY - pr.top, len = Math.hypot(ex - sx, ey - sy);
      line.style.cssText = `left:${sx}px;top:${sy}px;width:${len}px;transform:rotate(${Math.atan2(ey - sy, ex - sx)}rad)`;
      plot.querySelectorAll(".pg-bar.is-linktarget").forEach(x => x.classList.remove("is-linktarget"));
      over = targetAt(e);
      if (over) plot.querySelector(`.pg-bar[data-key="${CSS.escape(`${over.line}`)}"]`)?.classList.add("is-linktarget");
    };
    const end = async e => {
      clearTimeout(d.timer); document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", cancel);
      dot._drag = null; line?.remove(); plot.querySelectorAll(".pg-bar.is-linktarget").forEach(x => x.classList.remove("is-linktarget"));
      if (!d.active || !e || !over || over === r) return;
      const id = idOf(r) ?? newId();
      if (depsOf(over).includes(id)) return notify("That step already waits for this one.");
      if (idOf(over) && depsOf(r).includes(idOf(over))) return notify("This step already waits for that one; a step cannot wait for itself in a loop.");
      const plan = [];
      if (!idOf(r)) plan.push({ x: r, fn: l => addSign(l, "🆔", id) });
      plan.push({ x: over, fn: l => (/⛔ [\w-]/u.test(l) ? l.replace(/⛔ ([\w-]+(?:\s*,\s*[\w-]+)*)/u, (m, ids) => `⛔ ${ids},${id}`) : addSign(l, "⛔", id)) });
      if (await applyPlan(r.path, plan, `Linked: "${clean(over.raw)}" waits for "${clean(r.raw)}"`)) { notify(`"${clean(over.raw)}" now waits for "${clean(r.raw)}". Undo is above the chart.`); redraw(); }
    };
    const up = e => void end(e), cancel = () => void end(null);
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", cancel);
  });
}
// thin arrows from the end of a step to the start of each step that waits for it (same chart, both shown)
function depArrows(plot, vis, span, ROW) {
  const byId = new Map(); vis.forEach((r, i) => { const id = idOf(r); if (id) byId.set(id, i); });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "pg-deps"); plot.appendChild(svg);
  vis.forEach((r, i) => {
    const to = span(r); if (!to) return;
    for (const id of depsOf(r)) {
      const j = byId.get(id); if (j === undefined) continue;
      const from = span(vis[j]); if (!from) continue;
      const x1 = from.x1, y1 = 36 + j * ROW + 13, x2 = to.x0, y2 = 36 + i * ROW + 13, mx = Math.max(x1 + 6, Math.min(x2 - 6, x1 + 10));
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", `M${x1},${y1} H${mx} V${y2} H${x2 - 2}`);
      p.setAttribute("class", x2 < x1 ? "is-conflict" : "");
      const t = document.createElementNS("http://www.w3.org/2000/svg", "title"); t.textContent = `${clean(r.raw)} waits for ${clean(vis[j].raw)}${x2 < x1 ? " (but starts before it ends)" : ""}`; p.appendChild(t);
      svg.appendChild(p);
    }
  });
}

// ---------- page ----------
let redraw = () => {};
if (input?.allProjects && files.length) {
  const root = dv.container.createEl("div", { cls: "pg" });
  root.createEl("style", { text: `
.pg-pick { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
.pg-chip { font-size: 12px; padding: 2px 10px; border-radius: 12px; border: 1px solid var(--background-modifier-border); cursor: pointer; background: var(--background-primary); user-select: none; }
.pg-chip.is-on { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); }
.pg-tools { display: flex; gap: 6px; align-items: center; margin-left: auto; font-size: 12px; }
.pg-proj { margin: 10px 0 16px; }
.pg-proj-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
.pg-proj-head h4 { margin: 0; }
.pg-seg { display: inline-flex; border: 1px solid var(--background-modifier-border); border-radius: 6px; overflow: hidden; }
.pg-seg span { font-size: 11px; padding: 1px 8px; cursor: pointer; }
.pg-seg span.is-on { background: var(--background-modifier-hover); font-weight: 600; }
.pg-box { border: 1px solid var(--background-modifier-border); border-radius: 8px; margin: 6px 0; overflow: hidden; background: var(--background-primary); }
.pg-head { font-weight: 600; font-size: 12px; padding: 4px 8px; border-bottom: 1px solid var(--background-modifier-border); background: var(--background-secondary); }
.pg-wrap { display: flex; }
.pg-labels { flex-shrink: 0; border-right: 1px solid var(--background-modifier-border); font-size: 12px; }
.pg-axis-pad { height: 36px; border-bottom: 1px solid var(--background-modifier-border); }
.pg-label { display: flex; align-items: center; gap: 3px; white-space: nowrap; overflow: hidden; box-sizing: border-box; border-bottom: 1px solid var(--background-modifier-border-hover, transparent); }
.pg-label input { margin: 0 2px 0 0; flex-shrink: 0; }
.pg-label.is-done .pg-text { color: var(--text-faint); }
.pg-num { color: var(--text-muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.pg-text { overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.pg-scroll { overflow-x: auto; flex: 1; min-width: 0; }
.pg-plot { position: relative; }
.pg-month { position: absolute; top: 2px; font-size: 11px; font-weight: 600; color: var(--text-muted); white-space: nowrap; padding-left: 3px; border-left: 1px solid var(--background-modifier-border); }
.pg-tick { position: absolute; top: 18px; height: 18px; font-size: 10px; color: var(--text-faint); text-align: center; border-bottom: 1px solid var(--background-modifier-border); box-sizing: border-box; }
.pg-tick.is-week { width: auto; padding-left: 2px; border-left: 1px solid var(--background-modifier-border); }
.pg-weekend { position: absolute; top: 18px; bottom: 0; background: var(--background-secondary); }
.pg-today { position: absolute; top: 18px; bottom: 0; border-left: 2px solid var(--text-muted); z-index: 2; }
.pg-tick.is-today { color: var(--text-normal); font-weight: 700; }
.pg-row.is-band { background: color-mix(in srgb, var(--area) 6%, transparent); }
.pg-label.is-band { background: color-mix(in srgb, var(--area) 6%, transparent); box-shadow: inset 3px 0 0 var(--area); }
.pg-label.is-parent .pg-text { font-weight: 600; }
.pg-chev { width: 12px; flex-shrink: 0; color: var(--text-muted); cursor: pointer; font-size: 10px; text-align: center; }
.pg-meta { margin-left: auto; padding: 0 6px 0 8px; color: var(--text-muted); font-size: 11px; white-space: nowrap; flex-shrink: 0; font-variant-numeric: tabular-nums; }
@media (max-width: 600px) { .pg-meta { display: none; } }
.pg-bracket { position: absolute; height: 7px; z-index: 3; box-sizing: border-box; border: 2px solid var(--text-muted); border-top: none; border-radius: 0 0 2px 2px; cursor: grab; background: transparent; }
.pg-bracket.is-nested { border-width: 1px; height: 5px; opacity: .8; }
.pg-bracket-fill { position: absolute; left: 0; top: 0; bottom: 0; background: color-mix(in srgb, var(--text-muted) 55%, transparent); }
.pg-tickmark { position: absolute; width: 2px; height: 5px; background: var(--text-muted); z-index: 3; }
.pg-donetext { position: absolute; font-size: 11px; color: var(--text-faint); white-space: nowrap; z-index: 3; }
.pg-check { position: absolute; font-size: 11px; color: var(--text-muted); z-index: 3; }
.pg-noest { position: absolute; font-size: 11px; color: var(--text-muted); font-style: italic; white-space: nowrap; z-index: 3; cursor: pointer; }
.pg-noest:hover { color: var(--text-accent); }
.pg-row { position: absolute; left: 0; right: 0; border-bottom: 1px solid var(--background-modifier-border-hover, transparent); }
.pg-bar { position: absolute; border-radius: 4px; background: var(--interactive-accent); z-index: 3; cursor: grab; touch-action: manipulation; box-sizing: border-box; }
.pg-bar.is-parent { background: var(--text-muted); border-radius: 2px; cursor: default; }
.pg-bar.is-parent.is-group { cursor: grab; height: 10px !important; }
.pg-bar.is-parent.is-group:hover { background: var(--text-normal); }
.pg-undo { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12px; padding: 4px 8px; margin-bottom: 6px; border-radius: 6px; background: var(--background-secondary); }
.pg-bar.is-inferred { background: transparent; border: 2px dashed var(--interactive-accent); }
.pg-bar.is-parent.is-inferred { border-color: var(--text-muted); border-width: 1px; }
.pg-bar.is-done { background: var(--text-faint); opacity: .7; cursor: default; }
.pg-bar.is-late { background: var(--color-red); border-color: var(--color-red); }
.pg-bar.is-dragging { opacity: .7; box-shadow: 0 0 0 2px var(--text-accent); }
.pg-grip { position: absolute; right: -2px; top: 0; bottom: 0; width: 9px; cursor: ew-resize; touch-action: none; }
.pg-due { position: absolute; font-size: 12px; color: var(--color-red); z-index: 4; }
.pg-pdue { position: absolute; top: 2px; bottom: 0; border-left: 2px dashed var(--color-red); z-index: 3; font-size: 11px; color: var(--color-red); padding-left: 2px; line-height: 1; }
.pg-bar.is-pastdue { outline: 2px solid var(--color-orange); outline-offset: -2px; }
.pg-pdue-chip { font-size: 12px; color: var(--text-muted); border: 1px solid var(--background-modifier-border); border-radius: 10px; padding: 0 8px; }
.pg-pdue-chip.is-over { color: var(--color-red); border-color: var(--color-red); }
.pg-move { cursor: grab; color: var(--text-faint); padding: 0 3px 0 0; touch-action: none; user-select: none; flex-shrink: 0; font-size: 11px; letter-spacing: -2px; }
.pg-move:hover { color: var(--text-accent); }
.pg-label.is-dragging { background: var(--background-modifier-hover); }
.pg-labels { position: relative; }
.pg-split { flex: 0 0 10px; margin: 0 -5px; position: relative; z-index: 6; cursor: col-resize; touch-action: none; user-select: none; -webkit-user-select: none; }
.pg-split::after { content: ""; position: absolute; top: 0; bottom: 0; left: 4px; width: 2px; background: transparent; transition: background .1s; }
.pg-split:hover::after, .pg-split.is-dragging::after { background: var(--interactive-accent); }
@media (hover: none) { .pg-split { flex-basis: 18px; margin: 0 -9px; } .pg-split::after { left: 8px; background: var(--background-modifier-border); } }
.pg-drop { position: absolute; left: 0; right: 0; height: 0; border-top: 2px solid var(--interactive-accent); z-index: 5; pointer-events: none; }
.pg-with { position: absolute; font-size: 11px; color: var(--text-accent); z-index: 4; }
.pg-blocked { color: var(--color-red); font-size: 11px; flex-shrink: 0; cursor: help; }
.pg-bar.is-blocked { background-image: repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, var(--background-primary) 55%, transparent) 4px 7px); }
.pg-sum { font-size: 12px; color: var(--text-muted); }
.pg-link { position: absolute; right: -11px; top: 50%; width: 9px; height: 9px; margin-top: -4.5px; border-radius: 50%; background: var(--background-primary); border: 2px solid var(--text-accent); cursor: crosshair; touch-action: none; opacity: 0; z-index: 5; }
.pg-bar:hover .pg-link, .pg-link:active { opacity: 1; }
@media (hover: none) { .pg-link { opacity: .8; } }
.pg-linkline { position: absolute; height: 0; border-top: 2px dashed var(--text-accent); transform-origin: 0 0; z-index: 6; pointer-events: none; }
.pg-bar.is-linktarget { box-shadow: 0 0 0 2px var(--text-accent); }
.pg-deps { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2; overflow: visible; }
.pg-deps path { fill: none; stroke: var(--text-muted); stroke-width: 1.2; marker-end: none; }
.pg-deps path.is-conflict { stroke: var(--color-red); stroke-dasharray: 3 2; }
.pg-legend { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
` });
  const pick = root.createEl("div", { cls: "pg-pick" });
  const body = root.createEl("div");
  if (!Array.isArray(ui.selected)) ui.selected = files.slice(0, 1);
  ui.selected = ui.selected.filter(p => files.includes(p));
  if (!ui.selected.length) ui.selected = files.slice(0, 1);
  const undoBar = root.createEl("div");
  pick.before(undoBar);
  redraw = () => {
    pick.empty(); body.empty(); undoBar.empty();
    const u = loadUndo();
    if (u?.items?.length && Date.now() - u.at < 86400000) {
      const ub = undoBar.createEl("div", { cls: "pg-undo" });
      ub.createEl("span", { text: `Last change: ${u.title} (${u.items.length} task${u.items.length === 1 ? "" : "s"}).` });
      const b = ub.createEl("button", { text: "Undo", cls: "mod-warning" });
      b.addEventListener("click", async () => { b.disabled = true; await undoLast(); redraw(); });
      const hide = ub.createEl("span", { text: "hide", attr: { style: "cursor:pointer;text-decoration:underline;color:var(--text-muted)" } });
      hide.addEventListener("click", () => { try { localStorage.removeItem(UNDO_KEY); } catch (e) {} redraw(); });
    }
    pick.createEl("span", { text: "Projects:", attr: { style: "font-size:12px;color:var(--text-muted)" } });
    for (const p of files) {
      const c = pick.createEl("span", { cls: `pg-chip${ui.selected.includes(p) ? " is-on" : ""}`, text: dv.page(p)?.file.name ?? p });
      c.addEventListener("click", () => { ui.selected = ui.selected.includes(p) ? ui.selected.filter(x => x !== p) : [...ui.selected, p]; saveUi(); redraw(); });
    }
    const tools = pick.createEl("span", { cls: "pg-tools" });
    tools.createEl("span", { text: "Zoom" });
    const seg = tools.createEl("span", { cls: "pg-seg" });
    for (const [z, l] of [["day", "Days"], ["week", "Weeks"], ["month", "Months"]]) {
      const b = seg.createEl("span", { text: l, cls: ui.zoom === z ? "is-on" : "" });
      b.addEventListener("click", () => { ui.zoom = z; KEEP.scroll = {}; saveUi(); redraw(); });
    }
    if (!ui.selected.length) body.createEl("p", { text: "Pick one or more projects above.", attr: { style: "color:var(--text-muted)" } });
    for (const p of ui.selected) {
      const sec = body.createEl("div", { cls: "pg-proj" });
      const head = sec.createEl("div", { cls: "pg-proj-head" });
      const a = head.createEl("h4").createEl("a", { text: dv.page(p)?.file.name ?? p, cls: "internal-link" });
      a.addEventListener("click", () => app.workspace.openLinkText(p, "", false));
      const pd = projectDue(p);
      if (pd) { const d = diffDays(TODAY, pd); head.createEl("span", { cls: `pg-pdue-chip${d < 0 ? " is-over" : ""}`, text: `⚑ due ${dmy(pd)} · ${d < 0 ? `${-d}d over` : d === 0 ? "today" : `${d}d left`}`, attr: { title: "The project note's due property" } }); }
      { // roll-up for the whole project: computed from its steps, never written into a note
        let rs = []; walk(dv.page(p)?.file.lists.where(l => l.parent === undefined || l.parent === null).array() ?? [], "", 0, rs, null);
        rs = rs.filter(r => clean(r.raw) || r.kids.length); prep(rs);
        const ls = rs.filter(r => !r.kids.length && !isRecur(r)), open = ls.filter(r => !r.done);
        const est = open.reduce((t, r) => t + (r.est ?? 0), 0), noEst = open.filter(r => r.est === null).length, cost = open.reduce((t, r) => t + costOf(r), 0), blk = open.filter(r => r.blockedBy.length).length;
        if (ls.length) head.createEl("span", { cls: "pg-sum", text: `${ls.length - open.length} of ${ls.length} done${est ? ` · ${fmtEst(est)} left` : ""}${noEst && est ? ` (+${noEst} without estimate)` : ""}${cost ? ` · ${money(cost)} to buy` : ""}${blk ? ` · ${blk} blocked` : ""}`, attr: { title: "Steps without sub-steps; repeats not counted. Time left is the open steps' [est::]; to buy is their price × qty. Nothing here is written into the note." } });
      }
      const view = ui.view[p] ?? "gantt";
      const seg2 = head.createEl("span", { cls: "pg-seg" });
      for (const [v, l] of [["gantt", "Gantt"], ["steps", "Steps"]]) {
        const b = seg2.createEl("span", { text: l, cls: view === v ? "is-on" : "" });
        b.addEventListener("click", () => { ui.view[p] = v; saveUi(); redraw(); });
      }
      if (view === "gantt") {
        const mode = timeModeOf(p);
        const seg3 = head.createEl("span", { cls: "pg-seg", attr: { title: "Sequence: plan order and effort, no dates. Calendar: bars on real dates." } });
        for (const [v, l] of [["sequence", "Sequence"], ["calendar", "Calendar"]]) {
          const b = seg3.createEl("span", { text: l, cls: mode === v ? "is-on" : "" });
          b.addEventListener("click", async () => { const f = app.vault.getAbstractFileByPath(p); if (f) await app.fileManager.processFrontMatter(f, fm => { fm.gantt_mode = v; }); ui.timeMode = { ...(ui.timeMode ?? {}), [p]: v }; saveUi(); redraw(); });
        }
      }
      if (view === "steps") project(p, sec);
      else {
        charts(p, sec);
        if (timeModeOf(p) === "sequence") sec.createEl("div", { cls: "pg-legend", text: "Sequence: the hours of work still to do, in outline order (indent to nest, [mode:: parallel] side by side, ⛔ waits for a 🆔), each as long as its estimate. Done steps are off the axis (✓ with their date). [ ] bracket = a parent over its open steps, filled to the share done; ▸ folded. Drag a bar's right edge to change its estimate; drag a step (bar or ⋮⋮) up or down to move it; drag a bar left onto the start of the step above to run them side by side (∥, writes [with:: previous]). Bands are work days of " + HOURS_PER_DAY + "h. Switch to Calendar once you want dates." });
        else sec.createEl("div", { cls: "pg-legend", text: `■ planned (🛫 ⏳ 📅) · dashed: not planned yet, placed in outline order at ${HOURS_PER_DAY}h a day plus ${BUFFER}% buffer · grey ✓: done, on its ✅ date · [ ] bracket: a parent over its open steps, filled to the share done · ▸ folded · red: overdue · ⚑ due date · red dashed line: the project's due date (orange outline: a step that ends after it). Dragging plans (⏳, or 🛫 and ⏳); it never moves a 📅 deadline, and asks whether the later steps and the steps waiting for it (⛔) move along. Hatched with ⛔: waits for an open step; thin lines: what waits for what. Drag the dot at a bar's end onto another bar to make that one wait for it (🆔 and ⛔). Each heading with tasks is its own chart.` });
      }
    }
  };
  redraw();
} else {
  for (const path of files) project(path);
}
