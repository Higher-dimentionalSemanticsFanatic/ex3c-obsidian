// Every open task with a price, from every project, in one sortable list.
// Usage: await dv.view("Meta/views/purchases", { currency: "EUR" })
// Task format: - [ ] Buy timber [price:: 7.90] [qty:: 14] [shop:: Timber yard]
// price is per item, qty defaults to 1, total = price × qty. Any other [field:: value] on these
// tasks shows up as an extra column and sort option. Ticked items stay visible (struck through,
// out of the totals) until the page refreshes, so a mis-click can be undone.
const EXCL = ["Templates/", "scripts/", "wiki/", ".trash/"];
const CUR = input?.currency ?? "EUR";
const money = n => n.toLocaleString(undefined, { style: "currency", currency: CUR });
const KEY = "compass-proto-purchases";
const parseEst = s => { const v = String(s ?? "").trim().toLowerCase().replace(",", "."); if (/^\d+(\.\d+)?$/.test(v)) return parseFloat(v); let m = 0, hit = false; for (const x of v.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)(?![a-z])/g)) { hit = true; m += parseFloat(x[1]) * (x[2].startsWith("h") ? 60 : 1); } return hit ? m : null; };
// ---- shared task writing (Dataview views cannot import each other, so this block is repeated) ----
const tasksApi = app.plugins.plugins["obsidian-tasks-plugin"]?.apiV1;
const obs = (() => { try { return require("obsidian"); } catch (e) { return {}; } })();
const notify = msg => (obs.Notice ? new obs.Notice(msg) : console.warn(msg));
const TASK_RE = /^(\s*)[-*+] \[(.)\] /;
const strip = s => s.replace(TASK_RE, "").replace(/\s*✅ \d{4}-\d{2}-\d{2}/, "").trim();
const isDoneLine = s => /^\s*[-*+] \[[xX-]\]/.test(s);
const parseFields = s => { const f = {}; for (const m of s.matchAll(/\[([\w-]+)::\s*([^\]]*)\]/g)) f[m[1]] = m[2].trim(); return f; };
const num = v => (v === undefined || v === "" || isNaN(Number(v)) ? undefined : Number(v));
const clean = s => strip(s).replace(/\[[\w-]+::[^\]]*\]/g, "").replace(/#project\/\S+/g, "").replace(/\s+/g, " ").trim();
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

// Areas: a task's #<area> tag, otherwise its note's area property (the area list is the app's Areas).
const AREA = input?.area || null;
const AREA_KEYS = app.plugins?.plugins?.["ex3c-agenda"]?.areaKeys?.() ?? ["work", "study", "personal"];
const AREA_TAG = new RegExp(`(^|\\s)#(${AREA_KEYS.join("|") || "(?!)"})(?=\\s|$)`, "i");
const areaOf = (raw, page) => { const m = String(raw).match(AREA_TAG); if (m) return m[2].toLowerCase(); const a = String(page?.area ?? "").toLowerCase(); return AREA_KEYS.includes(a) ? a : null; };
// Sample notes (tagged example) are left out unless a note passes samples: true.
const SAMPLES = input?.samples ?? false;
const isSample = p => p.example === true || (p.file.tags ?? []).includes("#example");
const rows = dv.pages().where(p => !EXCL.some(e => p.file.path.startsWith(e)) && !/(^|\/)templates\//i.test(p.file.path) && String(p.type ?? "") !== "checklist" && (SAMPLES || !isSample(p))).file.tasks
  .where(t => !(t.completed || t.status === "-") && /\[price::/.test(t.text) && (!AREA || areaOf(t.text, dv.page(t.path)) === AREA)).array()
  .map(t => {
    const tag = (t.tags ?? []).find(x => x.startsWith("#project/"));
    return { path: t.path, line: t.line, raw: `- [${t.status}] ${t.text}`, project: tag ? tag.slice(9) : (dv.page(t.path)?.file.name ?? t.path) };
  });
function info(r) {
  const fields = parseFields(r.raw);
  const price = num(fields.price) ?? 0, qty = num(fields.qty) ?? 1;
  return { fields, item: clean(r.raw), qty, price, total: price * qty, shop: fields.shop ?? "", project: r.project, done: isDoneLine(r.raw) };
}

let state = { sort: "total", desc: true, group: "shop" };
try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) ?? "{}")); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

const root = dv.container.createEl("div", { cls: "lifeos-widget" });
if (!rows.length) { root.createEl("p", { text: "No open tasks with a [price:: ] field yet." }); return; }
const bar = root.createEl("div", { attr: { style: "display:flex;gap:0.6em;flex-wrap:wrap;align-items:center;margin-bottom:0.6em" } });
const out = root.createEl("div");
const STD = ["total", "price", "qty", "shop", "project", "item"];
const extras = () => [...new Set(rows.flatMap(r => Object.keys(parseFields(r.raw))))].filter(k => !["price", "qty", "shop"].includes(k));

function controls() {
  bar.empty();
  const sel = (label, key, opts) => {
    bar.createEl("span", { text: label, attr: { style: "color:var(--text-muted)" } });
    const s = bar.createEl("select", { cls: "dropdown" });
    for (const [v, l] of opts) s.createEl("option", { value: v, text: l });
    s.value = opts.some(o => o[0] === state[key]) ? state[key] : opts[0][0];
    s.addEventListener("change", () => { state[key] = s.value; save(); draw(); });
  };
  sel("Sort by", "sort", [["total", "Total"], ["price", "Unit price"], ["qty", "Quantity"], ["shop", "Shop"], ["project", "Project"], ["item", "Item"], ...extras().map(k => [k, k])]);
  const dir = bar.createEl("button", { text: state.desc ? "High to low" : "Low to high" });
  dir.addEventListener("click", () => { state.desc = !state.desc; save(); controls(); draw(); });
  sel("Group by", "group", [["shop", "Shop"], ["project", "Project"], ["none", "Nothing"]]);
}

function draw() {
  out.empty();
  const ex = extras();
  const val = (i, k) => (STD.includes(k) ? i[k] : k === "est" ? (parseEst(i.fields.est) ?? -1) : (i.fields[k] ?? ""));
  const list = rows.map(r => ({ r, i: info(r) })).sort((a, b) => {
    const x = val(a.i, state.sort), y = val(b.i, state.sort);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return state.desc ? -c : c;
  });
  const groups = new Map();
  for (const e of list) {
    const g = state.group === "none" ? "" : (e.i[state.group] || `No ${state.group}`);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(e);
  }
  const cols = ["", "Item", "Qty", "Unit", "Total", ...(state.group === "shop" ? [] : ["Shop"]), ...(state.group === "project" ? [] : ["Project"]), ...ex, ""];
  const table = out.createEl("table");
  const hr = table.createEl("thead").createEl("tr");
  for (const c of cols) hr.createEl("th", { text: c });
  const body = table.createEl("tbody");
  const sum = es => es.filter(e => !e.i.done).reduce((s, e) => s + e.i.total, 0);
  for (const [g, es] of groups) {
    if (g) {
      const open = es.filter(e => !e.i.done).length;
      body.createEl("tr").createEl("td", { text: `${g}  ·  ${open} item${open === 1 ? "" : "s"}  ·  ${money(sum(es))}`, attr: { colspan: cols.length, style: "font-weight:600;padding-top:0.8em" } });
    }
    for (const { r, i } of es) {
      const tr = body.createEl("tr", { attr: { style: i.done ? "color:var(--text-faint);text-decoration:line-through" : "" } });
      const cb = tr.createEl("td").createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
      cb.checked = i.done;
      cb.addEventListener("click", async e => {
        e.preventDefault();
        const before = r.raw;
        r.raw = r.raw.replace(/\[(.)\]/, i.done ? "[ ]" : "[x]"); // show the change right away
        draw();
        r.raw = before;
        if (!(await writeTask(r, "toggle"))) r.raw = before;
        draw();
      });
      const it = tr.createEl("td").createEl("a", { text: i.item, cls: "internal-link" });
      it.addEventListener("click", () => app.workspace.openLinkText(r.path, "", false, { eState: { line: r.line } }));
      tr.createEl("td", { text: String(i.qty) });
      tr.createEl("td", { text: money(i.price) });
      tr.createEl("td", { text: money(i.total) });
      if (state.group !== "shop") tr.createEl("td", { text: i.shop });
      if (state.group !== "project") tr.createEl("td", { text: i.project });
      for (const k of ex) tr.createEl("td", { text: i.fields[k] ?? "" });
      iconButton(tr.createEl("td"), "pencil", "Edit task", async () => { if (await writeTask(r, "edit")) { controls(); draw(); } });
    }
  }
  const open = list.filter(e => !e.i.done);
  out.createEl("p", { text: `${open.length} items, ${money(sum(list))} in total.`, attr: { style: "font-weight:600" } });
}
controls();
draw();
