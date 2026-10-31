// The planner. Usage: await dv.view("Meta/views/planner", { folders: [""], area: null })
// Long list: the next step of every project (indentation and [mode:: parallel] decide what is next) plus
// loose tasks. Short list: one click puts a task on a day by writing ⏳ YYYY-MM-DD on its line, the same
// scheduled date the Tasks plugin and the daily note's Today section already use. Each day shows its
// estimated time ([est::]) plus a buffer against your capacity. The timeline shows one day as hours: drag tasks onto
// it to write a Day Planner time range (- [ ] 10:00 - 11:30 Task ⏳ date), drag blocks to move or resize them.
const SCOPE = input?.folders ?? [""];
const EXCL = ["Templates/", "scripts/", "wiki/", ".trash/"];
const KEY = "compass-proto-planner";
let GUESS = 30; // the default estimate: minutes counted for a task without [est::], shown as ~30m (set in ⚙; the project steps chart uses the same)
const SOON = 3; // a due date this many days away (or less) counts as urgent, here and in Needs attention
// Sample notes (tagged example) are left out unless a note passes samples: true.
const SAMPLES = input?.samples ?? false;
const isSample = p => p.example === true || (p.file.tags ?? []).includes("#example");

// ---------- state ----------
const DEFAULTS = { capacity: 4, buffer: 25, weekOffset: 0, sort: "suggested", quick: false, dueSoon: false, wholeVault: false, dayStart: "07:00", dayEnd: "21:00" };
let state = { ...DEFAULTS };
try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };
// Hours per day, buffer and the day's start and end live in the config note, so the phone and the desktop agree.
const CFG_PATH = "Meta/EX3C Agenda Config.md";
const CFG_KEYS = { defaultEst: "default_estimate", capacity: "planner_hours_per_day", buffer: "planner_buffer", dayStart: "planner_day_start", dayEnd: "planner_day_end", useIdeal: "planner_use_ideal_week" };
{
  const cfg = dv.page(CFG_PATH) ?? {};
  for (const [k, ck] of Object.entries(CFG_KEYS)) {
    const v = cfg[ck];
    if (v === undefined || v === null || v === "") continue;
    // a time written without quotes can come back as minutes (YAML reads 07:00 as 420)
    if (k === "useIdeal") state[k] = v === true || v === "true";
    else if (k === "defaultEst") state[k] = String(v);
    else if (k.startsWith("day")) state[k] = typeof v === "number" ? `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}` : String(v);
    else if (!isNaN(Number(v))) state[k] = Number(v);
  }
}
// The Ideal Week (03 Planning/Ideal Week.md, section Blocks): one line per block, "Mon-Fri 08:00 - 10:00 Deep work #tasks".
// Blocks marked #tasks are the time for tasks. Only while "Use my Ideal Week" is on (planner settings, or the switch
// on the Ideal Week note) do they set each weekday's hours instead of Hours per day and show behind the week view.
const IDEAL_PATH = "03 Planning/Ideal Week.md";
const DAYN = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
function daysOf(spec) {
  const out = new Set();
  for (const part of String(spec).toLowerCase().split(/\s*,\s*/)) {
    if (part === "daily" || part === "every day") DAYN.forEach((d, i) => out.add(i));
    else if (part === "weekdays") [0, 1, 2, 3, 4].forEach(i => out.add(i));
    else if (part === "weekend") [5, 6].forEach(i => out.add(i));
    else {
      const [a, b] = part.split(/\s*-\s*/).map(x => DAYN.indexOf(x.slice(0, 3)));
      if (a < 0) continue;
      if (b === undefined) out.add(a); else if (b >= 0) for (let i = a; ; i = (i + 1) % 7) { out.add(i); if (i === b) break; }
    }
  }
  return [...out];
}
const IDEAL = (() => {
  const page = dv.page(IDEAL_PATH);
  if (!page) return [];
  const out = [];
  for (const l of page.file.lists.array()) {
    if (l.task) continue;
    const m = String(l.text).match(/^\s*([A-Za-z][A-Za-z, -]*?)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s+(.+)$/);
    if (!m) continue;
    const days = daysOf(m[1]), s = +m[2] * 60 + +m[3], e = +m[4] * 60 + +m[5];
    if (days.length && e > s) out.push({ days, s, e, what: m[6].replace(/(^|\s)#(tasks|work)\b/gi, " ").trim(), tasks: /(^|\s)#tasks\b/i.test(m[6]), work: /(^|\s)#work\b/i.test(m[6]) });
  }
  return out;
})();
const IDEAL_ON = !!state.useIdeal && IDEAL.some(b => b.tasks);
const weekdayOf = date => (asDate(date).getDay() + 6) % 7;
const idealOn = date => (state.useIdeal ? IDEAL.filter(b => b.days.includes(weekdayOf(date)) && !b.work) : []);
// Work is part of the Ideal Week: its blocks marked #work (the Work tab's Work schedule writes them), with the
// note's commute_minutes before and after each. They are always busy time, whether or not the Ideal Week is used:
// solid blocks on the hours that tasks are planned around.
const WORK = (() => {
  const c = Number(dv.page(IDEAL_PATH)?.commute_minutes ?? 0) || 0, out = {};
  for (const b of IDEAL.filter(b => b.work)) for (const i of b.days) (out[i] ??= []).push(...(c ? [{ s: b.s - c, e: b.s, what: "Commute", busy: true }] : []), { s: b.s, e: b.e, what: b.what || "Work", busy: true, work: true }, ...(c ? [{ s: b.e, e: b.e + c, what: "Commute", busy: true }] : []));
  return out;
})();
const workOn = date => WORK[weekdayOf(date)] ?? [];
// Birthdays: the birthday property of person notes (1990-03-14, or 03-14), shown on their day every year.
const BIRTHDAYS = dv.pages().where(p => (String(p.type ?? "") === "person" || p.file.path.startsWith("05 People/")) && !p.file.path.startsWith("Templates/") && (SAMPLES || !isSample(p))).array()
  .map(p => { const v = p.birthday?.toISODate ? p.birthday.toISODate() : String(p.birthday ?? ""); const m = v.trim().match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/); return m ? { name: p.file.name, path: p.file.path, y: m[1] ? +m[1] : null, md: `${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}` } : null; }).filter(Boolean);
const birthdaysOn = date => BIRTHDAYS.filter(b => b.md === date.slice(5)).map(b => ({ ...b, age: b.y ? +date.slice(0, 4) - b.y : null }));
function birthdayMarks(parent, date) {
  for (const b of birthdaysOn(date)) {
    const el = h("div", { class: "pln-bday", title: `${b.name}'s birthday${b.age ? `, turns ${b.age}` : ""}` }, parent, `🎂 ${b.name}${b.age ? ` (${b.age})` : ""}`);
    el.addEventListener("click", () => app.workspace.openLinkText(b.path, "", false));
  }
}
// Project deadlines: the due property of project notes that are not done, on their day (on an area tab, that area's).
let PROJECT_DUES = null;
const projectDuesOn = date => (PROJECT_DUES ??= dv.pages().where(p => String(p.type ?? "") === "project" && !/^(Templates|\.trash|scripts|wiki)\//.test(p.file.path) && (SAMPLES || !isSample(p))
  && !["done", "complete", "completed", "archived", "dropped"].includes(String(p.status ?? "").toLowerCase().trim()) && (!AREA || String(p.area ?? "").toLowerCase() === AREA)).array()
  .map(p => { const v = p.due?.toISODate ? p.due.toISODate() : String(p.due ?? "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? { name: p.file.name, path: p.file.path, due: v } : null; }).filter(Boolean))
  .filter(d => d.due === date);
function projectDueMarks(parent, date, short) {
  for (const d of projectDuesOn(date)) {
    const el = h("div", { class: "pln-due", title: "Project deadline (the due property of the project note)" }, parent, short ? `⚑ ${d.name}` : `⚑ Project due: ${d.name}`);
    el.addEventListener("click", () => app.workspace.openLinkText(d.path, "", false));
  }
}
const bandsOn = date => idealOn(date);
{ const m = String(state.defaultEst ?? "").trim().toLowerCase(), n = /^\d+(\.\d+)?$/.test(m) ? parseFloat(m) : (() => { let t = 0, hit = false; for (const x of m.matchAll(/(\d+(?:\.\d+)?)\s*(h|m)/g)) { hit = true; t += parseFloat(x[1]) * (x[2] === "h" ? 60 : 1); } return hit ? t : null; })(); if (n > 0) GUESS = n; }
async function saveSetting(k, v) {
  state[k] = v; save();
  const f = app.vault.getAbstractFileByPath(CFG_PATH);
  if (f) await app.fileManager.processFrontMatter(f, fm => { fm[CFG_KEYS[k]] = v; });
}

// ---------- dates and estimates ----------
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const NOW = new Date();
const TODAY_D = new Date(NOW); TODAY_D.setHours(12, 0, 0, 0);
const TODAY = iso(TODAY_D), TOMORROW = iso(addDays(TODAY_D, 1));
const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7));
const asDate = s => new Date(`${s}T12:00:00`);
const dayLabel = s => `${asDate(s).toLocaleDateString(undefined, { weekday: "short" })} ${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`; // e.g. Sun 11-10-2026
const daysUntil = s => Math.round((asDate(s) - TODAY_D) / 86400000);
const parseEst = s => { const v = String(s ?? "").trim().toLowerCase().replace(",", "."); if (/^\d+(\.\d+)?$/.test(v)) return parseFloat(v); let m = 0, hit = false; for (const x of v.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)(?![a-z])/g)) { hit = true; m += parseFloat(x[1]) * (x[2].startsWith("h") ? 60 : 1); } return hit ? m : null; };
const fmtEst = min => { const h = Math.floor(min / 60), m = Math.round(min - h * 60); return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ") || "0m"; };
const clock = min => `${pad(Math.floor(min / 60) % 24)}:${pad(Math.round(min % 60))}`;
const parseClock = s => { const m = String(s || "").match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

// ---- shared task writing (Dataview views cannot import each other, so this block is repeated) ----
const tasksApi = app.plugins.plugins["obsidian-tasks-plugin"]?.apiV1;
const obs = (() => { try { return require("obsidian"); } catch (e) { return {}; } })();
const notify = msg => (obs.Notice ? new obs.Notice(msg) : console.warn(msg));
const TASK_RE = /^(\s*)[-*+] \[(.)\] /;
const strip = s => s.replace(TASK_RE, "").replace(/\s*✅ \d{4}-\d{2}-\d{2}/, "").trim();
const isDoneLine = s => /^\s*[-*+] \[[xX-]\]/.test(s);
const parseFields = s => { const f = {}; for (const m of s.matchAll(/\[([\w-]+)::\s*([^\]]*)\]/g)) f[m[1]] = m[2].trim(); return f; };
const num = v => (v === undefined || v === "" || isNaN(Number(v)) ? undefined : Number(v));
function findLine(lines, r) {
  const key = strip(r.raw);
  if (lines[r.line] !== undefined && TASK_RE.test(lines[r.line]) && strip(lines[r.line]) === key) return r.line;
  let best = -1;
  lines.forEach((l, i) => { if (TASK_RE.test(l) && strip(l) === key && (best < 0 || Math.abs(i - r.line) < Math.abs(best - r.line))) best = i; });
  return best;
}
// mode: "toggle" (Tasks plugin done/undone), "edit" (Tasks edit dialog), or a function(line) => new line
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
  } else if (mode === "toggle") {
    next = tasksApi?.executeToggleTaskDoneCommand
      ? tasksApi.executeToggleTaskDoneCommand(line, r.path)
      : line.replace(/\[(.)\]/, (m, c) => (c === " " ? "[x]" : "[ ]"));
  } else {
    next = mode(line);
  }
  if (next === line) return true;
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
// ---- end shared ----

function setDate(line, emoji, date) {
  const out = line.replace(new RegExp(`\\s*${emoji} \\d{4}-\\d{2}-\\d{2}`, "u"), "");
  if (!date) return out;
  const m = out.match(/\s\^[\w-]+\s*$/);
  return m ? `${out.slice(0, m.index)} ${emoji} ${date}${out.slice(m.index)}` : `${out.trimEnd()} ${emoji} ${date}`;
}
// A task planned on one day gets ⏳ that day. A task longer than a day's hours is spread over several days:
// 🛫 on the first day and ⏳ on the last, the same dates the project steps chart draws as one bar.
function setScheduled(line, date) {
  const m = meta(line);
  if (m.spread) line = setDate(line, "🛫", null); // a spread task planned on one day stops being spread
  return setDate(line, "⏳", date);
}
// days a task needs at your hours per day, buffer included (the project steps chart counts the same way)
const spanDays = est => (est && capMin() ? Math.max(1, Math.ceil(withBuffer(est) / capMin() - 1e-9)) : 1);
function planLine(line, date) {
  const m = meta(line);
  if (!date || m.recur) return setScheduled(line, date);
  const n = spanDays(m.est);
  if (n <= 1) return setScheduled(line, date);
  return setDate(setDate(line, "🛫", date), "⏳", iso(addDays(asDate(date), n - 1)));
}
// Moves a planned task by whole days, keeping a spread task's length.
function shiftLine(line, n) {
  const m = meta(line);
  if (m.spread) return setDate(setDate(line, "🛫", iso(addDays(asDate(m.start0), n))), "⏳", iso(addDays(asDate(m.sched), n)));
  return setDate(line, "⏳", iso(addDays(asDate(m.sched), n)));
}
const PRI = { "🔺": 0, "⏫": 1, "🔼": 2, "🔽": 4, "⏬": 5 };
const PRI_LABEL = ["highest", "high", "medium", "", "low", "lowest"];
// Day Planner writes a time range right after the checkbox: "- [ ] 10:00 - 11:30 Task ⏳ 2026-10-12".
const TIME_RE = /^(\s*[-*+] \[.\] )(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s+/;
const EVENT_RE = /(^|\s)#event(?=\s|$)/;
function setTime(line, start, end) {
  const plain = line.replace(TIME_RE, "$1");
  if (start === null) return plain;
  return plain.replace(/^(\s*[-*+] \[.\] )/, `$1${clock(start)} - ${clock(end)} `);
}
function meta(raw) {
  const f = parseFields(raw);
  const tm = raw.match(TIME_RE);
  const start = tm ? Number(tm[2]) * 60 + Number(tm[3]) : null;
  const end = tm ? Number(tm[4]) * 60 + Number(tm[5]) : null;
  const pm = raw.match(/[🔺⏫🔼🔽⏬]/u);
  const price = num(f.price);
  const sched = raw.match(/⏳ (\d{4}-\d{2}-\d{2})/u)?.[1] ?? null, start0 = raw.match(/🛫 (\d{4}-\d{2}-\d{2})/u)?.[1] ?? null;
  const spread = !!(sched && start0 && start0 < sched);
  const est = parseEst(f.est) ?? (start !== null && end > start ? end - start : null);
  const ndays = spread ? daysUntil(sched) - daysUntil(start0) + 1 : 1;
  return {
    start, end, event: EVENT_RE.test(raw), est, due: raw.match(/📅 (\d{4}-\d{2}-\d{2})/u)?.[1] ?? null, sched, start0, spread, ndays,
    share: est === null ? null : est / ndays, // work per day for a task spread over days
    commute: parseEst(f.commute) ?? 0, // minutes of travel before and after (drawn on the hours)
    recur: /🔁/u.test(raw), soon: SOON_LINES.has(raw.trim()) || /(^|\s)#soon\b/i.test(raw), created: raw.match(/➕ (\d{4}-\d{2}-\d{2})/u)?.[1] ?? null, id: raw.match(/🆔 ([\w-]+)/u)?.[1] ?? null,
    deps: (raw.match(/⛔ ([\w-]+(?:\s*,\s*[\w-]+)*)/u)?.[1] ?? "").split(/\s*,\s*/).filter(Boolean),
    // a priority written on the line wins; unwritten, a Soon task is 🔼 medium and a study task 🔺 highest
    pri: pm ? PRI[pm[0]] : SOON_LINES.has(raw.trim()) || /(^|\s)#soon\b/i.test(raw) ? 2 : STUDY_LINES.has(raw.trim()) ? 0 : 3, ownPri: pm ? PRI[pm[0]] : 3, cost: price !== undefined ? price * (num(f.qty) ?? 1) : null, done: isDoneLine(raw), mode: (f.mode ?? "").toLowerCase(),
    shops: shopsOf(raw),
  };
}
// [shop:: Ikea, Gamma] or the field written twice: the shops where a task can be bought.
function shopsOf(raw) { return [...raw.matchAll(/\[shop::\s*([^\]]*)\]/g)].flatMap(m => m[1].split(",")).map(s => s.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean); }
// One errand per shop: tasks with a shop are bought on one trip. A task with several shops joins the shop that
// already has the most of the list (ties: the first shop written). Returns the trips and the tasks without a shop.
function errands(list) {
  const trips = new Map(), loose = [], multi = [];
  for (const r of list) { const s = meta(r.raw).shops; if (!s.length) loose.push(r); else if (s.length === 1) (trips.get(s[0]) ?? trips.set(s[0], []).get(s[0])).push(r); else multi.push(r); }
  for (const r of multi) { const s = meta(r.raw).shops, best = s.reduce((b, x) => ((trips.get(x)?.length ?? 0) > (trips.get(b)?.length ?? 0) ? x : b), s[0]); (trips.get(best) ?? trips.set(best, []).get(best)).push(r); }
  return { trips, loose };
}
// A trip counts as one task of your default estimate, or its items' own estimates added up when that is more.
function errandMin(list) { return Math.max(GUESS, list.reduce((t, r) => t + (meta(r.raw).share ?? 0), 0)); }
// Is the task on this day? A spread task is on every day from 🛫 to ⏳.
const onDate = (m, date) => (m.spread ? m.start0 <= date && date <= m.sched : m.sched === date);
// One meaning of urgent everywhere: overdue, then due within SOON days (a Soon task's month ending counts as its
// due date), then 🔺 highest, ⏫ high, 🔼 medium (Soon tasks), then the rest.
const soonLeft = m => (m.soon && m.created ? daysUntil(m.created) + 30 : null);
const urgency = m => { if (m.due) { const d = daysUntil(m.due); if (d <= 0) return 0; if (d <= SOON) return 1; } if (m.soon) { const l = soonLeft(m); if (l !== null && l <= SOON) return 1; } return 2 + Math.min(m.pri, 3); };
// A purchase never holds up the steps after it: buying can happen any time.
const isPurchase = r => r.kids.every(k => meta(k.raw).done) && ("price" in parseFields(r.raw) || /^(buy|order|purchase)\b/i.test(label(r.raw)));
const label = raw => strip(raw)
  .replace(/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s+/, "")
  .replace(/(^|\s)#event(?=\s|$)/g, " ")
  .replace(/\[[\w-]+::[^\]]*\]/g, "")
  .replace(/\s*(📅|⏳|🛫|➕|✅|❌) \d{4}-\d{2}-\d{2}/gu, "")
  .replace(/\s*🔁[^📅⏳🛫➕✅❌🔺⏫🔼🔽⏬#^]*/u, "")
  .replace(/[🔺⏫🔼🔽⏬]/gu, "")
  .replace(/#project\/\S+/g, "")
  .replace(/\s*(🆔|⛔) [\w-]+(?:\s*,\s*[\w-]+)*/gu, "")
  .replace(/(^|\s)#(work|study|personal|soon|someday)(?=\s|$)/gi, " ")
  .replace(/\s+/g, " ").trim();

// ---------- read tasks ----------
const SOON_LINES = new Set(); // task lines in the master list's ## Soon
const STUDY_LINES = new Set(); // task lines in the study area (#study, or a note with area: study)
const pages = dv.pages()
  .where(p => !EXCL.some(e => p.file.path.startsWith(e)) && p.file.path !== "10 Areas/Work/Work schedule.md" /* drawn from the Work schedule itself */ && !/(^|\/)templates\//i.test(p.file.path) && String(p.type ?? "") !== "checklist"
    && (SAMPLES || !isSample(p)) && (state.wholeVault || SCOPE.some(s => p.file.path.startsWith(s))))
  .array();
// Areas: a task's #<area> tag, otherwise its note's area property (the area list is the app's Areas).
const AREA = input?.area || null;
// Area colours from Configure (Meta/EX3C Agenda Layout.md): a task's block takes its area's colour, so work, study and
// personal stay apart on Home too. Tasks without an area keep the page colour; calendar events stay grey.
const AREA_COLORS = { work: "#4a7fd4", study: "#8f6bdc", personal: "#4bb38a", ...(app.plugins?.plugins?.["ex3c-agenda"]?.areaColors?.() ?? {}) };
const areaStyle = area => (AREA_COLORS[area] ? `;--blk:${AREA_COLORS[area]}` : "");
const AREA_KEYS = app.plugins?.plugins?.["ex3c-agenda"]?.areaKeys?.() ?? ["work", "study", "personal"];
const AREA_TAG = new RegExp(`(^|\\s)#(${AREA_KEYS.join("|") || "(?!)"})(?=\\s|$)`, "i");
const areaOf = (raw, page) => { const m = String(raw).match(AREA_TAG); if (m) return m[2].toLowerCase(); const a = String(page?.area ?? "").toLowerCase(); return AREA_KEYS.includes(a) ? a : null; };
const ALL = [];
const ROWS = new Map(); // page path -> its task rows
for (const page of pages) {
  const rows = [];
  const walk = (items, depth, parent) => {
    for (const it of items) {
      if (!it.task) { walk(it.children ?? [], depth, parent); continue; }
      const tag = (it.tags ?? []).find(t => t.startsWith("#project/"));
      // only the task's own line (a missing blank line before a heading must not pull the heading in)
      const text = String(it.text).split("\n")[0].replace(/\s+#{1,6}\s.*$/, "");
      // a lecture note's tasks belong to its course
      const owner = page.course?.path ? page.course.path.split("/").pop().replace(/\.md$/, "") : typeof page.course === "string" && page.course.trim() ? page.course.trim() : page.file.name;
      // the master list's ## Soon and ## Eventually (inbox triage); ## Someday counts as Eventually
      const listName = page.file.path === "08 Tasks/Tasks.md" ? String(it.section?.subpath ?? "").toLowerCase() : "";
      const someday = listName === "eventually" || listName === "someday" || /(^|\s)#someday\b/i.test(text);
      const inSoon = listName === "soon";
      const r = { path: it.path, line: it.line, raw: `${"\t".repeat(depth)}- [${it.status}] ${text}`, depth, kids: [], isNext: false, someday, inSoon,
        project: tag ? tag.slice(9) : owner, area: areaOf(text, page) };
      r.key = `${r.path}|${label(r.raw)}`;
      if (rows.some(x => x.key === r.key)) r.key += `|${rows.filter(x => x.key.startsWith(`${r.key}|`)).length + 2}`; // the same text twice in a note (a repeat purchase) stays two tasks
      if (inSoon) SOON_LINES.add(r.raw.trim());
      if (r.area === "study") STUDY_LINES.add(r.raw.trim());
      rows.push(r);
      if (parent) parent.kids.push(r);
      walk(it.children ?? [], depth + 1, r);
    }
  };
  walk(page.file.lists.where(l => l.parent === undefined || l.parent === null).array(), 0, null);
  ALL.push(...rows);
  ROWS.set(page.file.path, { rows, isProject: String(page.type ?? "") === "project" });
}
// ⛔ waits for the open task with that 🆔 (anywhere in the vault, as in the Tasks plugin).
const BY_ID = new Map();
for (const r of ALL) { const m = meta(r.raw); if (m.id && !m.done) BY_ID.set(m.id, r); }
const blockers = r => meta(r.raw).deps.map(id => BY_ID.get(id)).filter(b => b && !meta(b.raw).done);
// On an area tab only that area's tasks are shown (what counts as "next" still uses the whole outline).
// (calendar events are fixed times whatever the area, so they show on every area tab)
// The day's load, capacity and Suggest's budget still count every area (EVERY): one day, one person.
const EVERY = [...ALL];
if (AREA) ALL.splice(0, ALL.length, ...ALL.filter((r) => r.area === AREA || EVENT_RE.test(r.raw)));
// What is "next": in a project note the top-level steps run in order; elsewhere every top-level task stands alone.
// Purchases never hold up the steps after them, a ⏫ or 🔺 step is next wherever it sits, and a step waiting
// for a ⛔ is never next. Every other open step is "later" and says what it waits for.
function markNext() {
  for (const r of ALL) { r.isNext = false; r.after = null; r.blockedBy = null; }
  const done = r => meta(r.raw).done;
  const actionable = r => (done(r) ? [] : r.kids.some(k => !done(k)) ? fromList(r.kids, meta(r.raw).mode === "parallel") : [r]);
  // [with:: previous] on a step: it is next together with the step above it
  const withPrev = r => /\[with::\s*previous\s*\]/i.test(r.raw);
  const fromList = (list, par) => {
    const open = list.filter(k => !done(k));
    if (par) return open.flatMap(actionable);
    const group = [];
    let i = 0;
    for (; i < open.length; i++) { group.push(open[i]); if (!isPurchase(open[i])) break; }
    for (i++; i < open.length && withPrev(open[i]); i++) group.push(open[i]);
    return group.flatMap(actionable);
  };
  for (const { rows, isProject } of ROWS.values()) {
    const top = rows.filter(r => r.depth === 0);
    const nexts = isProject ? fromList(top, false) : top.flatMap(actionable);
    const leaves = rows.filter(r => !done(r) && !r.kids.some(k => !done(k)));
    for (const r of leaves) if (meta(r.raw).ownPri <= 1 && !nexts.includes(r)) nexts.push(r);
    for (const r of nexts) r.isNext = true;
    const first = nexts.find(r => !blockers(r).length);
    for (const r of leaves) if (!r.isNext) r.after = first ? label(first.raw) : null;
  }
  for (const r of ALL) if (r.isNext && blockers(r).length) { r.isNext = false; r.blockedBy = blockers(r).map(b => label(b.raw)); }
}

// ---------- dom ----------
function h(tag, attrs = {}, parent, text) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v; else if (k === "style") el.style.cssText = v; else el.setAttribute(k, v);
  }
  if (text !== undefined) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}
const root = h("div", { class: "pln" }, dv.container);
h("style", {}, root, `
.pln { font-size: 13px; }
.pln button.pln-btn { font-size: 12px; padding: 1px 7px; height: auto; }
.pln-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 4px 0 10px; }
.pln-bar input[type=number] { width: 4.5em; }
.pln-bar input[type=time] { width: 7em; }
.pln-sub { font-size: 11px; color: var(--text-muted); }
.pln-box { border: 1px solid var(--background-modifier-border); border-radius: 8px; background: var(--background-secondary); padding: 8px 10px; margin-bottom: 10px; container-type: inline-size; }
.pln-box h4 { margin: 0 0 6px; }
.pln-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; margin-bottom: 10px; }
@media (max-width: 700px) { .pln-week { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.pln-day { border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 6px; background: var(--background-primary); min-height: 90px; }
.pln-day.is-today { border-color: var(--interactive-accent); box-shadow: 0 0 0 1px var(--interactive-accent); }
.pln-day.is-past { opacity: .6; }
.pln-day-head { display: flex; justify-content: space-between; font-weight: 600; font-size: 12px; }
.pln-cap { height: 6px; border-radius: 3px; background: var(--background-modifier-border); margin: 4px 0 2px; overflow: hidden; }
.pln-cap > div { height: 6px; background: var(--color-green); }
.pln-cap.is-full > div { background: var(--color-orange); }
.pln-cap.is-over > div { background: var(--color-red); }
.pln-item { display: flex; gap: 4px; align-items: flex-start; padding: 3px 2px; border-top: 1px solid var(--background-modifier-border); font-size: 12px; line-height: 1.25; }
.pln-item .pln-text { flex: 1; cursor: pointer; min-width: 0; overflow-wrap: break-word; }
.pln-day .pln-item { position: relative; }
.pln-day .pln-acts { position: absolute; right: 0; top: 2px; background: var(--background-primary); border-radius: 4px; opacity: 0; }
.pln-day .pln-item:hover .pln-acts, .pln-day .pln-item:focus-within .pln-acts { opacity: 1; }
@media (hover: none) { .pln-day .pln-item { flex-wrap: wrap; } .pln-day .pln-acts { position: static; opacity: 1; flex-basis: 100%; justify-content: flex-end; } }
.pln-item.is-done .pln-text { text-decoration: line-through; color: var(--text-faint); }
.pln-acts { display: flex; gap: 1px; flex-shrink: 0; }
.pln-acts span { cursor: pointer; color: var(--text-muted); padding: 0 2px; }
.pln-acts span:hover { color: var(--text-accent); }
.pln-errand { font-size: 13px; margin: 2px 0 6px; overflow-wrap: anywhere; }
.pln-chip { font-size: 10px; padding: 0 5px; border-radius: 8px; border: 1px solid var(--background-modifier-border); color: var(--text-muted); white-space: nowrap; }
.pln-chip.is-due { color: var(--color-red); border-color: var(--color-red); }
.pln-chip.is-soon { color: var(--color-orange); border-color: var(--color-orange); }
.pln-chip.is-guess { border-style: dashed; }
.pln-table { width: 100%; border-collapse: collapse; }
.pln-table td { padding: 3px 4px; border-top: 1px solid var(--background-modifier-border); vertical-align: top; font-size: 12px; }
.pln-table tr.is-suggested td { background: color-mix(in srgb, var(--interactive-accent) 14%, transparent); }
.pln-weektotal { margin: 4px 2px 10px; font-weight: 600; }
.pln-table tr.pln-total td { color: var(--text-muted); font-size: 11px; font-weight: 600; border-top: 1px dashed var(--background-modifier-border); }
.pln-table .pln-acts { display: inline-flex; vertical-align: middle; } /* the ✎ sits after the plan buttons, not on a line of its own */
/* a narrow card (a phone): each task wraps onto two lines, text first, the plan buttons under it, instead of widening the page */
@container (max-width: 520px) {
  .pln-table, .pln-table tbody { display: block; }
  .pln-table tr { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; padding: 4px 0; border-top: 1px solid var(--background-modifier-border); }
  .pln-table td { border-top: none; padding: 0; }
  .pln-table td.pln-c-text { flex: 1 1 0; min-width: 0; }
  .pln-table td.pln-c-act { flex-basis: 100%; display: flex; justify-content: flex-end; align-items: center; gap: 3px; }
  .pln-table td.pln-c-act > * { margin-left: 0 !important; }
  .pln-table tr.is-suggested { background: color-mix(in srgb, var(--interactive-accent) 14%, transparent); }
  .pln-table tr.is-suggested td { background: none; }
}
.pln-time { font-variant-numeric: tabular-nums; color: var(--text-muted); white-space: nowrap; }
.pln-tl-row { display: flex; gap: 8px; align-items: center; padding: 3px 0; border-top: 1px solid var(--background-modifier-border); }
.pln-tl-row.is-now { font-weight: 600; }
.pln-chip.is-time { color: var(--text-accent); border-color: var(--text-accent); }
.pln-day.is-shown .pln-day-head { color: var(--text-accent); }
.pln-day.is-drop, .pln-pool.is-drop { outline: 2px dashed var(--interactive-accent); outline-offset: -2px; }
.pln-tlw { display: grid; grid-template-columns: minmax(180px, 2fr) 3fr; gap: 10px; align-items: start; }
@media (max-width: 700px) { .pln-tlw { grid-template-columns: 1fr; } }
.pln-pool { max-height: 560px; overflow: auto; border-radius: 6px; min-height: 60px; }
@media (max-width: 700px) { .pln-pool { max-height: 220px; } }
.pln-pool h5 { margin: 6px 0 3px; font-size: 12px; color: var(--text-muted); }
.pln-pi { display: flex; gap: 4px; align-items: center; padding: 4px 6px; margin: 3px 0; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-primary); cursor: grab; font-size: 12px; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
.pln-pi[style*="--blk"] { border-left: 3px solid var(--blk); }
.pln-pi.is-picked { border-color: var(--interactive-accent); box-shadow: 0 0 0 1px var(--interactive-accent); }
.pln-pi .pln-text { flex: 1; min-width: 0; overflow-wrap: break-word; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pln-gs { max-height: 560px; overflow: auto; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-primary); }
.pln-grid { position: relative; margin: 8px 0 8px 44px; border-left: 1px solid var(--background-modifier-border); }
.pln-grid.is-picking { cursor: copy; background: color-mix(in srgb, var(--interactive-accent) 6%, transparent); }
.pln-hr { position: absolute; left: 0; right: 0; border-top: 1px solid var(--background-modifier-border); }
.pln-hr.is-half { border-top-style: dotted; opacity: .6; }
.pln-hr span { position: absolute; left: -42px; top: -7px; font-size: 10px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.pln-now { position: absolute; left: 0; right: 0; border-top: 2px solid var(--color-red); z-index: 3; pointer-events: none; }
.pln-blk { position: absolute; box-sizing: border-box; border-radius: 5px; padding: 2px 5px 6px; font-size: 11px; line-height: 1.2; overflow: hidden; z-index: 2;
  background: color-mix(in srgb, var(--blk, var(--interactive-accent)) 22%, var(--background-primary)); border: 1px solid var(--blk, var(--interactive-accent)); cursor: grab; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
.pln-work { position: absolute; left: 2px; right: 2px; box-sizing: border-box; z-index: 1; border-radius: 5px; padding: 2px 5px; font-size: 11px; line-height: 1.2; overflow: hidden; cursor: default;
  background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--blk) 34%, var(--background-primary)) 0 7px, color-mix(in srgb, var(--blk) 20%, var(--background-primary)) 7px 14px); border: 1px solid var(--blk); }
.pln-work.is-commute { background: color-mix(in srgb, var(--blk) 9%, var(--background-primary)); border-style: dashed; border-color: color-mix(in srgb, var(--blk) 60%, transparent); color: var(--text-muted); font-size: 10px; }
.pln-work.is-other { background: color-mix(in srgb, var(--blk) 12%, transparent); border: 0; border-left: 2px solid color-mix(in srgb, var(--blk) 50%, transparent); border-radius: 0; color: var(--text-faint); }
.pln-work.is-other.is-commute { background: color-mix(in srgb, var(--blk) 6%, transparent); border-left-style: dashed; }
.pln-work .pln-bt { font-variant-numeric: tabular-nums; color: var(--text-muted); }
.pln-blk.is-event { background: var(--background-secondary-alt); border-color: var(--background-modifier-border); cursor: default; }
.pln-blk.is-event[style*="--blk"] { background: color-mix(in srgb, var(--blk) 12%, var(--background-secondary-alt)); border-color: color-mix(in srgb, var(--blk) 45%, var(--background-modifier-border)); border-left: 3px solid var(--blk); }
.pln-blk.is-done { opacity: .5; text-decoration: line-through; }
.pln-blk.is-ghost { opacity: .55; border-style: dashed; pointer-events: none; z-index: 4; }
.pln-blk .pln-bt { font-variant-numeric: tabular-nums; color: var(--text-muted); }
.pln-blk .pln-x { position: absolute; right: 3px; top: 1px; cursor: pointer; color: var(--text-muted); }
.pln-blk .pln-rs { position: absolute; left: 0; right: 0; bottom: 0; height: 7px; cursor: ns-resize; touch-action: none; }
.pln-drag { position: fixed; z-index: 1000; pointer-events: none; padding: 3px 8px; border-radius: 6px; font-size: 12px; background: var(--background-primary); border: 1px solid var(--interactive-accent); box-shadow: var(--shadow-s); max-width: 240px; }
.pln-due { font-size: 11px; color: var(--color-red); border-top: 1px dashed var(--background-modifier-border); padding: 3px 2px; cursor: pointer; }
.pln-answer { margin: 0 0 6px; font-weight: 600; }
.pln-bday { font-size: 11px; color: var(--text-accent); padding: 2px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pln-ideal { position: absolute; left: 0; right: 0; z-index: 1; pointer-events: none; background: color-mix(in srgb, var(--text-faint) 10%, transparent); border-top: 1px solid color-mix(in srgb, var(--text-faint) 25%, transparent); overflow: hidden; }
.pln-ideal.is-tasks { background: color-mix(in srgb, var(--interactive-accent) 18%, transparent); border-top-color: color-mix(in srgb, var(--interactive-accent) 35%, transparent); }
.pln-ideal.is-busy { z-index: 1; background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--text-faint) 16%, transparent) 0 6px, transparent 6px 12px); border-top-color: color-mix(in srgb, var(--text-faint) 40%, transparent); }
.pln-ideal span { position: absolute; right: 3px; top: 1px; font-size: 9px; color: var(--text-faint); white-space: nowrap; }
.pln-seg { display: inline-flex; gap: 2px; margin-left: 8px; vertical-align: middle; font-weight: normal; }
.pln button.pln-btn.is-on { background: var(--interactive-accent); color: var(--text-on-accent); }
.pln-pi.is-suggested { background: color-mix(in srgb, var(--interactive-accent) 14%, var(--background-primary)); }
.pln-pi .pln-chips { display: inline-flex; flex-wrap: wrap; gap: 2px; justify-content: flex-end; }
.pln-wkw { display: grid; grid-template-columns: minmax(150px, 210px) minmax(0, 1fr); gap: 10px; align-items: start; }
.pln-wkw.is-narrow { grid-template-columns: minmax(0, 1fr); }
.pln-wkw.is-narrow .pln-pool { max-height: 200px; }
.pln-cal { min-width: 0; }
.pln-cal-strip { overflow: auto; max-height: 70vh; min-width: 0; scroll-snap-type: x proximity; border: 1px solid var(--background-modifier-border); border-radius: 6px; }
.pln-cal.is-strip { width: max-content; }
.pln-cal.is-strip .pln-gs { max-height: none; overflow: visible; border: 0; border-radius: 0; }
/* the dates stay on top while the hours scroll */
.pln-cal.is-strip > .pln-cal-row:first-child { position: sticky; top: 0; z-index: 4; background: var(--background-secondary); }
.pln-cal.is-strip .pln-cal-row { grid-template-columns: 38px repeat(var(--n), 108px); }
.pln-cal.is-strip .pln-cal-dh { scroll-snap-align: start; scroll-margin-left: 38px; }
/* the hours (and the corner above them) stay put while the days scroll */
.pln-cal.is-strip .pln-cal-row > :first-child { position: sticky; left: 0; z-index: 3; background: var(--background-secondary); }
.pln-cal.is-strip > .pln-cal-row:first-child > :first-child { z-index: 5; }
.pln-cal-row { display: grid; grid-template-columns: 38px repeat(var(--n), minmax(0, 1fr)); }
.pln-cal-dh { padding: 3px 4px; font-size: 11px; font-weight: 600; border-left: 1px solid var(--background-modifier-border); cursor: pointer; min-width: 0; }
.pln-cal-dh.is-today { color: var(--text-accent); }
.pln-cal-dh.is-past { opacity: .6; }
.pln-cal-dh .pln-sub { font-weight: normal; font-size: 10px; }
.pln-cal-gut { font-size: 10px; color: var(--text-muted); padding: 4px 2px 0 0; text-align: right; }
.pln-cal .pln-day.pln-lane { min-height: 34px; border-radius: 0; padding: 2px; border-width: 1px 0 0 1px; background: var(--background-primary); box-shadow: none; min-width: 0; }
.pln-cal .pln-lane .pln-pi { margin: 2px 0; padding: 2px 4px; font-size: 11px; flex-direction: column; align-items: stretch; gap: 1px; }
.pln-cal .pln-lane .pln-pi .pln-chips { justify-content: flex-start; }
.pln-cal .pln-lane .pln-due { font-size: 10px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pln-cal-body { margin-top: 4px; }
.pln-cal-body .pln-cal-row { padding: 8px 0; }
.pln-cal-hours { position: relative; }
.pln-cal-hours span { position: absolute; right: 4px; transform: translateY(-6px); font-size: 10px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.pln-cal .pln-grid { margin: 0; border-left: 1px solid var(--background-modifier-border); min-width: 0; }
.pln-cal .pln-blk { font-size: 10px; padding: 1px 3px 6px; }
.pln-sel { position: absolute; left: 0; right: 0; z-index: 1; pointer-events: none; background: color-mix(in srgb, var(--interactive-accent) 14%, transparent); }
.pln-selframe { position: absolute; z-index: 3; pointer-events: none; --a: var(--interactive-accent); --b: var(--background-primary);
  background-image: linear-gradient(90deg, var(--a) 50%, var(--b) 50%), linear-gradient(90deg, var(--a) 50%, var(--b) 50%), linear-gradient(0deg, var(--a) 50%, var(--b) 50%), linear-gradient(0deg, var(--a) 50%, var(--b) 50%);
  background-repeat: repeat-x, repeat-x, repeat-y, repeat-y; background-size: 10px 2px, 10px 2px, 2px 10px, 2px 10px; background-position: 0 0, 0 100%, 0 0, 100% 0; animation: pln-ants .7s linear infinite; }
@keyframes pln-ants { to { background-position: 10px 0, -10px 100%, 0 -10px, 100% 10px; } }
@media (prefers-reduced-motion: reduce) { .pln-selframe { animation: none; } }
.pln-selframe span { position: absolute; top: 3px; right: 4px; font-size: 10px; font-weight: 600; color: var(--interactive-accent); background: var(--background-primary); border-radius: 3px; padding: 0 3px; }
.pln-selbox { border: 1px solid var(--interactive-accent); border-radius: 6px; background: var(--background-primary); padding: 6px 8px; margin: 8px 0; }
.pln-selhd { display: flex; gap: 6px; align-items: flex-start; margin-bottom: 4px; }
.pln-seltitle { flex: 1; min-width: 0; font-weight: 600; }
.pln-selbar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: color-mix(in srgb, var(--text-faint) 14%, transparent); margin: 2px 0 6px; }
.pln-selbar .is-tasks { background: var(--interactive-accent); }
.pln-selbar .is-busy { background: repeating-linear-gradient(135deg, var(--text-faint) 0 4px, color-mix(in srgb, var(--text-faint) 50%, transparent) 4px 8px); }
.pln-selnums { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-bottom: 4px; }
.pln-selnums div { display: flex; flex-direction: column; line-height: 1.2; }
.pln-selnums b { font-size: 14px; white-space: nowrap; }
.pln-selnums span { font-size: 11px; color: var(--text-muted); }
.pln-selnums .is-tasks b { color: var(--interactive-accent); }
.pln-sellist { margin-top: 4px; border-top: 1px solid var(--background-modifier-border); padding-top: 4px; }
.pln-selrow { display: flex; gap: 6px; align-items: baseline; padding: 1px 0; }
.pln-selrow .pln-bt { font-size: 11px; color: var(--text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.pln-selrow input { margin: 0; align-self: center; }
.pln-commute { display: inline-flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.pln-commute input[type=number] { width: 4.2em; }
.pln-work.is-trip { left: 2px; right: 2px; padding: 0 3px; z-index: 0; }
.pln-work.is-trip b { font-size: 9px; font-weight: 500; }
.pln-work.is-trip.is-back { display: flex; align-items: flex-end; }
.pln-selrow .pln-text { cursor: pointer; flex: 1; min-width: 0; }
.pln-selrow.is-done .pln-text { text-decoration: line-through; color: var(--text-muted); }
`);

let suggestion = null; // array of task keys proposed for today
const byKey = new Map();

async function act(r, mode, optimistic) {
  const before = r.raw;
  if (optimistic) { r.raw = optimistic(r.raw); render(); r.raw = before; }
  const ok = await writeTask(r, mode);
  if (!ok) r.raw = before;
  render();
  return ok;
}
// Every change to more than one task asks first (with the count and the tasks), and can be undone in one go:
// the exact lines before and after are kept, and Undo puts back each line that is still as this change left it.
// A plain overlay (no Obsidian Modal: views cannot always load the obsidian module, and window.confirm
// does not work on phones). Resolves true on "Yes", false on Cancel, Escape, or a click outside.
function confirmModal(title, lines) {
  return new Promise(resolve => {
    const back = h("div", { style: "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px" }, document.body);
    const card = h("div", { style: "background:var(--background-primary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:10px;max-width:520px;width:100%;padding:14px 16px;box-shadow:var(--shadow-l)" }, back);
    h("div", { style: "font-weight:600;font-size:15px;margin-bottom:6px" }, card, `${title}?`);
    const ul = h("ul", { style: "max-height:40vh;overflow:auto;font-size:13px;margin:4px 0;padding-left:18px" }, card);
    for (const l of lines.slice(0, 50)) h("li", {}, ul, l);
    if (lines.length > 50) h("div", { class: "pln-sub" }, card, `and ${lines.length - 50} more`);
    h("div", { class: "pln-sub", style: "margin:6px 0 10px" }, card, "You can undo this afterwards with Undo at the top of the planner.");
    const row = h("div", { style: "display:flex;gap:8px;justify-content:flex-end" }, card);
    const no = h("button", {}, row, "Cancel"), yes = h("button", { class: "mod-cta" }, row, "Yes, change them");
    const done = v => { document.removeEventListener("keydown", key, true); back.remove(); resolve(v); };
    const key = e => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
    document.addEventListener("keydown", key, true);
    no.addEventListener("click", () => done(false));
    yes.addEventListener("click", () => done(true));
    back.addEventListener("click", e => { if (e.target === back) done(false); });
    yes.focus();
  });
}
const UNDO_KEY = `${KEY}-undo`;
const loadUndo = () => { try { return JSON.parse(localStorage.getItem(UNDO_KEY) || "null"); } catch (e) { return null; } };
async function bulk(list, title, fn) {
  if (!list.length) return;
  if (list.length > 1 && !(await confirmModal(title, list.map(r => `${label(r.raw)} (${r.path.split("/").pop().replace(/\.md$/, "")})`)))) return;
  const items = [];
  for (const r of list) {
    let before = null;
    if (await writeTask(r, line => { before = line; return fn(line, r); }) && before !== null && before !== r.raw) items.push({ path: r.path, before, after: r.raw });
  }
  try { localStorage.setItem(UNDO_KEY, JSON.stringify({ title, at: Date.now(), items })); } catch (e) {}
  notify(`${title}: done. Undo is at the top of the planner.`);
  render();
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
      for (const it of its) { const i = L.indexOf(it.after); if (i < 0) { changed++; continue; } if (it.before === null) L.splice(i, 1); else L[i] = it.before; back++; } // before null: the line was added, so remove it
      return L.join("\n");
    });
  }
  try { localStorage.removeItem(UNDO_KEY); } catch (e) {}
  notify(`Undone: ${back} task${back === 1 ? "" : "s"} put back${changed ? `; ${changed} had changed since and were left alone` : ""}.`);
}
const schedule = (r, date) => act(r, line => planLine(line, date), line => planLine(line, date));
const shift = (r, n) => act(r, line => shiftLine(line, n), line => shiftLine(line, n));
const toggle = r => act(r, "toggle", line => line.replace(/\[(.)\]/, (m, c) => (c === " " ? "[x]" : "[ ]")));
const edit = r => act(r, "edit");
const openAt = r => { try { app.workspace.openLinkText(r.path, "", false, { eState: { line: r.line } }); } catch (e) { console.warn(e); } };
// A task's menu: right-click it, or on a phone press and hold it and let go without moving (moving drags it).
// Edit task is the Tasks plugin's dialog, where EX3C AgendA adds the fields (length, price, shop and the rest).
const EX3C = app.plugins.plugins["ex3c-agenda"];
function taskMenu(ev, r) {
  ev?.preventDefault?.();
  if (!EX3C?.showMenu) { edit(r); return; }
  const m = meta(r.raw), items = [];
  if (!m.event) items.push({ title: "Edit task…", icon: "pencil", run: () => edit(r) });
  if (!m.done && !m.event && !m.recur) {
    if (m.sched !== TODAY) items.push({ title: "Do today", icon: "calendar-check", run: () => schedule(r, TODAY) });
    if (m.sched !== TOMORROW) items.push({ title: "Do tomorrow", icon: "calendar-plus", run: () => schedule(r, TOMORROW) });
    if (m.start !== null) items.push({ title: "Remove the time", icon: "clock", run: () => unTime(r) });
    if (m.sched) items.push({ title: "Take off the plan", icon: "calendar-x", run: () => schedule(r, null) });
  }
  if (!m.event) items.push({ title: m.done ? "Mark as not done" : "Mark as done", icon: "check-square", run: () => toggle(r) });
  EX3C.showMenu(ev, [...items, "-", { title: "Open in its note", icon: "file-text", run: () => openAt(r) }]);
}
const menuOn = (el, r) => el.addEventListener("contextmenu", ev => { ev.preventDefault(); ev.stopPropagation(); if (!drag) taskMenu(ev, r); }); // during a drag the press is the drag's

function chips(parent, r, m, { showSched = false, noBlocked = false } = {}) {
  if (m.start !== null) h("span", { class: "pln-chip is-time", title: "Time block (set in Day Planner or by Put on the timeline)" }, parent, `${clock(m.start)} - ${clock(m.end)}`);
  if (m.event) { h("span", { class: "pln-chip", title: "Calendar event" }, parent, "event"); return; }
  const est = m.est;
  h("span", { class: `pln-chip${est === null ? " is-guess" : ""}`, title: est === null ? `No estimate yet; planned as ${GUESS} minutes` : "Estimate" }, parent, est === null ? `~${GUESS}m` : fmtEst(est));
  if (m.spread) h("span", { class: "pln-chip", title: `Spread over ${m.ndays} days (🛫 ${dayLabel(m.start0)} to ⏳ ${dayLabel(m.sched)}), ${fmtEst(m.share ?? 0)} a day` }, parent, `${m.ndays} days`);
  else if (!m.recur && est !== null && spanDays(est) > 1) h("span", { class: "pln-chip is-soon", title: m.sched ? `Longer than your ${state.capacity} hours a day but planned on one day: ⇉ spreads it over ${spanDays(est)} days` : `Longer than your ${state.capacity} hours a day: planning it spreads it over ${spanDays(est)} days` }, parent, m.sched ? "over a day" : `${spanDays(est)} days`);
  if (m.soon) { const l = soonLeft(m); h("span", { class: `pln-chip${l !== null && l < 0 ? " is-due" : " is-soon"}`, title: "In ## Soon: plan it within a month of capture" }, parent, l === null ? "soon" : l < 0 ? `soon, ${-l}d over` : `soon, ${l}d left`); }
  if (m.recur) h("span", { class: "pln-chip", title: "Repeating task: ticking it makes the next one (Tasks plugin); the planner never moves its date" }, parent, "repeats");
  if (m.due) {
    const d = daysUntil(m.due);
    h("span", { class: `pln-chip${d < 0 ? " is-due" : d <= 2 ? " is-soon" : ""}`, title: `Due ${m.due}` }, parent, d < 0 ? `overdue ${-d}d` : d === 0 ? "due today" : d === 1 ? "due tomorrow" : `due in ${d}d`);
  }
  if (m.pri < 3) h("span", { class: "pln-chip", title: m.ownPri === m.pri ? "Priority" : m.pri === 0 ? "Study task: highest unless you give it a priority" : "In Soon: medium unless you give it a priority" }, parent, PRI_LABEL[m.pri]);
  if (m.shops.length) h("span", { class: "pln-chip", title: `Bought on one trip with the other tasks for ${m.shops.join(" or ")} (the [shop::] field)` }, parent, `🛒 ${m.shops.join(" / ")}`);
  if (showSched && m.sched) h("span", { class: "pln-chip" }, parent, dayLabel(m.sched));
  // planned or not, a step whose ⛔ blocker is still open says so
  if (!noBlocked && !m.done && r && blockers(r).length) h("span", { class: "pln-chip is-due", title: `Blocked: waits for ${blockers(r).map(b => label(b.raw)).join(", ")} (⛔)` }, parent, "⛔ blocked");
}
// Work in a list of tasks; a task spread over days counts its share for one day.
function minutes(list) {
  let known = 0, guessed = 0, missing = 0;
  const { trips, loose } = errands(list.filter(r => !meta(r.raw).event));
  for (const t of trips.values()) known += errandMin(t);
  for (const r of loose) { const m = meta(r.raw); if (m.event) continue; /* events are busy time, not task load */ if (m.est === null) { guessed += GUESS; missing++; } else known += m.share ?? m.est; }
  return { known, guessed, missing, total: known + guessed };
}
const withBuffer = min => min * (1 + (Number(state.buffer) || 0) / 100);
// A task shows its own length; the buffer is added only to totals, and says so: "3h 8m + buffer = 4h".
const plusBuffer = min => { const nb = x => fmtEst(x).replace(/ /g, "\u00a0"); return Number(state.buffer) && min ? `${nb(min)} + buffer = ${nb(withBuffer(min))}` : fmtEst(min); }; // no break inside "6h 59m"
// a day's hours for tasks: its #tasks blocks in the Ideal Week, else your Hours per day
const capMin = date => {
  const base = date && IDEAL_ON ? idealOn(date).filter(b => b.tasks).reduce((t, b) => t + b.e - b.s, 0) : (Number(state.capacity) || 0) * 60;
  const busy = date ? workOn(date) : [];
  if (!busy.length) return base;
  const d0 = parseClock(state.dayStart) ?? 7 * 60, d1 = parseClock(state.dayEnd) ?? 21 * 60;
  const taken = busy.reduce((t, b) => t + Math.max(0, Math.min(b.e, d1) - Math.max(b.s, d0)), 0);
  return Math.max(0, Math.min(base, d1 - d0 - taken)); // on a workday only the time around work and commute is left
};

// Overdue and due within SOON days first, then by priority (🔺 ⏫ 🔼), then the nearest due date, then the shortest.
function suggestedOrder(list) {
  return [...list].sort((a, b) => {
    const A = meta(a.raw), B = meta(b.raw);
    const da = A.due ? Math.min(daysUntil(A.due), 60) : 60, db = B.due ? Math.min(daysUntil(B.due), 60) : 60;
    return urgency(A) - urgency(B) || A.pri - B.pri || da - db || (A.est ?? GUESS) - (B.est ?? GUESS);
  });
}
// Today's budget: your hours per day, but never past the end of your day from now (or your start time).
function todayBudget() {
  const nowMin = NOW.getHours() * 60 + NOW.getMinutes();
  const from = Math.max(nowMin, parseClock(state.dayStart) ?? nowMin);
  const left = Math.max(0, (parseClock(state.dayEnd) ?? 21 * 60) - from);
  return { budget: Math.min(capMin(TODAY), left), left };
}
let suggestionNote = "";
// Tasks on a day: planned for it, or spread over it; a repeating task whose date has passed shows on today.
const onDay = date => r => { const m = meta(r.raw); return onDate(m, date) || (date === TODAY && m.recur && !m.done && m.sched && m.sched < TODAY); };
const tasksOn = date => ALL.filter(onDay(date));
// a day's open work in minutes: all = every area (what the day holds), own = this tab's area
const dayLoad = date => { const open = EVERY.filter(onDay(date)).filter(r => !meta(r.raw).done), all = minutes(open).total; return { all, own: AREA ? minutes(open.filter(r => r.area === AREA)).total : all }; };
const AREA_LABEL = AREA ? (app.plugins?.plugins?.["ex3c-agenda"]?.areaName?.(AREA) || AREA).toLowerCase() : "";
// "3h 8m + buffer = 4h of 4h"; on an area tab "1h 59m work, 1h 52m other + buffer = 4h 49m of 4h"
const loadText = (L, cap) => (AREA && L.all > L.own ? `${fmtEst(L.own)} ${AREA_LABEL}, ${fmtEst(L.all - L.own)} other${Number(state.buffer) ? ` + buffer = ${fmtEst(withBuffer(L.all))}` : ""}` : plusBuffer(L.all)) + ` of ${fmtEst(cap)}`;
// Suggest for today or any later day (evening planning: tomorrow). Today stops at your day's end; a later day has
// your full hours. A task longer than a day counts with one day's share and is spread when you plan it.
function suggestFor(date) {
  let used = withBuffer(dayLoad(date).all);
  const { budget, left } = date === TODAY ? todayBudget() : { budget: capMin(date), left: Infinity };
  const pick = [], trips = [], seen = new Set();
  const cand = suggestedOrder(pool()).filter(r => { const m = meta(r.raw); return !(m.recur && m.sched); });
  // the most urgent item of a shop brings the whole shop's list along, as one errand
  const { trips: byShop } = errands(cand.filter(r => meta(r.raw).shops.length));
  const tripOf = new Map([...byShop].flatMap(([shop, list]) => list.map(r => [r.key, { shop, list }])));
  for (const r of cand) {
    if (seen.has(r.key)) continue;
    const t = tripOf.get(r.key);
    if (t) {
      for (const x of t.list) seen.add(x.key);
      const e = withBuffer(errandMin(t.list));
      if (used + e <= budget) { pick.push(...t.list.map(x => x.key)); trips.push({ shop: t.shop, keys: t.list.map(x => x.key), min: errandMin(t.list) }); used += e; }
      continue;
    }
    const m = meta(r.raw);
    const e = withBuffer(m.est === null ? GUESS : m.est / spanDays(m.est));
    if (used + e <= budget) { pick.push(r.key); used += e; }
  }
  suggestion = { date, keys: pick, trips };
  suggestionNote = date === TODAY && left < capMin(TODAY) ? ` Only ${fmtEst(left)} left before your day ends at ${state.dayEnd}.` : "";
  const L = dayLoad(date);
  if (L.all > L.own) suggestionNote += ` Other areas already have ${fmtEst(L.all - L.own)} planned that day; it counts against your ${fmtEst(budget)}.`;
  render();
}
const dayName = d => (d === TODAY ? "today" : d === TOMORROW ? "tomorrow" : dayLabel(d));
function pool() {
  let list = ALL.filter(r => { const m = meta(r.raw); return r.isNext && !r.someday && !m.done && !m.sched && !m.event; });
  if (state.quick) list = list.filter(r => (meta(r.raw).est ?? GUESS) <= 15);
  if (state.dueSoon) list = list.filter(r => { const d = meta(r.raw).due; return d && daysUntil(d) <= 7; });
  const by = {
    suggested: l => suggestedOrder(l),
    due: l => [...l].sort((a, b) => (meta(a.raw).due ?? "9999") < (meta(b.raw).due ?? "9999") ? -1 : 1),
    est: l => [...l].sort((a, b) => (meta(a.raw).est ?? GUESS) - (meta(b.raw).est ?? GUESS)),
    priority: l => [...l].sort((a, b) => meta(a.raw).pri - meta(b.raw).pri),
    project: l => [...l].sort((a, b) => a.project.localeCompare(b.project)),
    cost: l => [...l].sort((a, b) => (meta(b.raw).cost ?? -1) - (meta(a.raw).cost ?? -1)),
  };
  return (by[state.sort] || by.suggested)(list);
}

function render() {
  UI.day = tlDay; UI.picked = picked;
  const page = scrollerOf(root), keep = page ? page.scrollTop : null;
  root.style.minHeight = `${root.offsetHeight}px`;
  requestAnimationFrame(() => { root.style.minHeight = ""; if (page && page.scrollTop !== keep) page.scrollTop = keep; });
  markNext();
  byKey.clear();
  for (const r of ALL) byKey.set(r.key, r);
  for (const el of [...root.children]) if (el.tagName !== "STYLE") el.remove();

  // undo for the last change to several tasks (kept for a day)
  const u = loadUndo();
  if (u?.items?.length && Date.now() - u.at < 86400000) {
    const ub = h("div", { class: "pln-box", style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" }, root);
    h("span", {}, ub, `Last change: ${u.title} (${u.items.length} task${u.items.length === 1 ? "" : "s"}).`);
    const ubtn = h("button", { class: "pln-btn mod-warning" }, ub, "Undo");
    ubtn.addEventListener("click", async () => { ubtn.disabled = true; await undoLast(); });
    const forget = h("span", { class: "pln-sub", style: "cursor:pointer;text-decoration:underline" }, ub, "hide");
    forget.addEventListener("click", () => { try { localStorage.removeItem(UNDO_KEY); } catch (e) {} render(); });
  }
  // toolbar; the settings fold away behind one button (they are kept in the config note)
  const bar = h("div", { class: "pln-bar" }, root);
  const setBtn = h("button", { class: "pln-btn", title: "Hours per day, buffer, and when your day starts and ends" }, bar, `⚙ ${IDEAL_ON ? "Ideal Week hours" : `${state.capacity}h a day`} · ${state.buffer}% buffer · ${state.dayStart} to ${state.dayEnd}`);
  setBtn.addEventListener("click", () => { UI.settingsOpen = !UI.settingsOpen; render(); });
  const sbar = UI.settingsOpen ? h("div", { class: "pln-bar pln-box" }, root) : null;
  const numInput = (lbl, key, min, max, step, title) => {
    if (!sbar) return;
    const l = h("label", { title }, sbar, `${lbl} `);
    const i = h("input", { type: "number", min, max, step, value: String(state[key]) }, l);
    i.addEventListener("change", async () => { await saveSetting(key, Number(i.value) || 0); render(); });
  };
  numInput("Hours per day", "capacity", 0, 16, 0.5, "How many hours of task work fit in a day");
  numInput("Buffer %", "buffer", 0, 200, 5, "Added to every estimate, because estimates run short");
  if (sbar) {
    const dl = h("label", { title: "Counted for every task that has no [est::] yet, in the planner and in the project steps chart" }, sbar, "Default estimate ");
    const di = h("input", { type: "text", value: state.defaultEst || "30m", placeholder: "30m", style: "width:4.5em" }, dl);
    di.addEventListener("change", async () => { if (/^\s*\d/.test(di.value)) await saveSetting("defaultEst", di.value.trim()); render(); });
  }
  if (sbar) {
  const ds = h("label", { title: "The timeline starts here, and Fill the gaps never plans before it" }, sbar, "Day starts ");
  const dsi = h("input", { type: "text", value: state.dayStart || "07:00", placeholder: "HH:MM", pattern: "[0-2][0-9]:[0-5][0-9]", style: "width:4.5em" }, ds);
  dsi.addEventListener("change", async () => { if (parseClock(dsi.value) !== null) await saveSetting("dayStart", dsi.value.padStart(5, "0")); render(); });
  const de = h("label", { title: "Suggest today and Fill the gaps never plan past this time" }, sbar, "Day ends ");
  const dei = h("input", { type: "text", value: state.dayEnd || "21:00", placeholder: "HH:MM", pattern: "[0-2][0-9]:[0-5][0-9]", style: "width:4.5em" }, de);
  dei.addEventListener("change", async () => { if (parseClock(dei.value) !== null) await saveSetting("dayEnd", dei.value.padStart(5, "0")); render(); });
  h("span", { class: "pln-sub" }, sbar, "Saved in Meta/EX3C Agenda Config.md, so every device plans with the same hours.");
  const sw = h("label", { title: "On: your Ideal Week's #tasks blocks set each weekday's hours and its blocks show behind the week view. Off: Hours per day for every day. Work and commute (Work schedule) are blocked either way." }, sbar);
  const swi = h("input", { type: "checkbox" }, sw);
  swi.checked = !!state.useIdeal;
  sw.appendChild(document.createTextNode(" Use my Ideal Week"));
  swi.addEventListener("change", async () => { await saveSetting("useIdeal", swi.checked); render(); });
  const iw = h("span", { class: "pln-sub" }, sbar, !state.useIdeal ? `Off: every day has your Hours per day${Object.keys(WORK).length ? ", minus work and commute" : ""}. `
    : IDEAL_ON ? `Hours per weekday from its #tasks blocks: ${DAYN.map((d, i) => `${d[0].toUpperCase()}${d.slice(1)} ${fmtEst(IDEAL.filter(b => b.tasks && b.days.includes(i)).reduce((t, b) => t + b.e - b.s, 0))}`).join(", ")}. `
    : "On, but the Ideal Week has no #tasks blocks yet, so Hours per day still applies. ");
  h("a", { style: "cursor:pointer" }, iw, "Open the Ideal Week").addEventListener("click", () => app.workspace.openLinkText(IDEAL_PATH, "", false));
  }
  const prev = h("button", { class: "pln-btn" }, bar, "‹");
  const wk = h("button", { class: "pln-btn" }, bar, state.weekOffset === 0 ? "This week" : `Week ${state.weekOffset > 0 ? "+" : ""}${state.weekOffset}`);
  const nxt = h("button", { class: "pln-btn" }, bar, "›");
  prev.addEventListener("click", () => { state.weekOffset--; save(); render(); });
  nxt.addEventListener("click", () => { state.weekOffset++; save(); render(); });
  wk.addEventListener("click", () => { state.weekOffset = 0; save(); render(); });
  // In the evening (less than half an hour left today) planning tomorrow is the main button.
  const late = todayBudget().left < 30;
  const calB = h("button", { class: "pln-btn", title: "Calendar links and .ics files: their events are fixed blocks in the planner" }, bar, "📅 Calendars");
  calB.addEventListener("click", () => app.workspace.openLinkText("00 Dashboards/Calendars.md", "", false));
  const sug = h("button", { class: `pln-btn${late ? "" : " mod-cta"}`, title: "Proposes next steps that fit in what is left of today" }, bar, "Suggest today");
  sug.addEventListener("click", () => suggestFor(TODAY));
  const sugT = h("button", { class: `pln-btn${late ? " mod-cta" : ""}`, title: "Plan tomorrow tonight: proposes next steps for your full hours tomorrow" }, bar, "Suggest tomorrow");
  sugT.addEventListener("click", () => suggestFor(TOMORROW));
  if (!SCOPE.includes("")) {
  const wv = h("label", { title: "Off: only the prototype's sample notes. On: every task in the vault." }, bar);
  const wvi = h("input", { type: "checkbox" }, wv);
  wvi.checked = !!state.wholeVault;
  wv.appendChild(document.createTextNode(" Whole vault (reopen to apply)"));
  wvi.addEventListener("change", () => { state.wholeVault = wvi.checked; save(); });
  }

  // suggestion banner
  if (suggestion) {
    const box = h("div", { class: "pln-box" }, root);
    const { date, keys } = suggestion, name = dayName(date);
    const picked = keys.map(k => byKey.get(k)).filter(Boolean);
    const trips = (suggestion.trips ?? []).filter(t => t.keys.some(k => byKey.has(k)));
    const inTrip = new Set(trips.flatMap(t => t.keys));
    const mins = minutes(picked).total;
    const spreads = picked.filter(r => !inTrip.has(r.key) && spanDays(meta(r.raw).est) > 1).length;
    const tasksN = picked.length - inTrip.size + trips.length;
    h("p", { style: "margin:0 0 6px" }, box, picked.length
      ? `Suggested for ${name}: ${tasksN} task${tasksN === 1 ? "" : "s"}${trips.length ? ` (${trips.length} of them ${trips.length === 1 ? "an errand" : "errands"}, one trip per shop)` : ""}, about ${plusBuffer(mins)}. Overdue and due within ${SOON} days first, then 🔺 highest, ⏫ high, 🔼 medium (Soon), then shortest. They are highlighted below.${spreads ? ` ${spreads} of them ${spreads === 1 ? "is" : "are"} longer than a day and will be spread over the following days.` : ""}${suggestionNote}`
      : `Nothing fits: ${name} is already full, or there are no next steps.${suggestionNote}${date === TODAY ? " Try Suggest tomorrow." : ""}`);
    for (const t of trips) {
      const items = t.keys.map(k => byKey.get(k)).filter(Boolean);
      const cost = items.reduce((c, r) => c + (meta(r.raw).cost ?? 0), 0);
      const row = h("div", { class: "pln-errand" }, box);
      h("b", {}, row, `🛒 ${t.shop}`);
      h("span", { class: "pln-sub" }, row, ` · ${items.length} item${items.length === 1 ? "" : "s"} · ${fmtEst(t.min)}${cost ? ` · ${cost.toLocaleString(undefined, { style: "currency", currency: "EUR" })}` : ""}: `);
      h("span", {}, row, items.map(r => label(r.raw)).join(", "));
    }
    if (picked.length) {
      const ap = h("button", { class: "pln-btn mod-cta" }, box, `Plan these for ${name}`);
      ap.addEventListener("click", async () => { const list = keys.map(k => byKey.get(k)).filter(Boolean); suggestion = null; await bulk(list, `Plan ${list.length} task${list.length === 1 ? "" : "s"} for ${name}`, line => planLine(line, date)); });
    }
    const cl = h("button", { class: "pln-btn", style: "margin-left:6px" }, box, "Dismiss");
    cl.addEventListener("click", () => { suggestion = null; render(); });
  }

  // carried over
  // (repeating tasks are not carried over: the Tasks plugin owns their dates, they show on today instead)
  const carried = ALL.filter(r => { const m = meta(r.raw); return !m.done && !m.event && !m.recur && m.sched && m.sched < TODAY; });
  if (carried.length) {
    const box = h("div", { class: "pln-box" }, root);
    const hd = h("h4", {}, box, `Carried over (${carried.length})`);
    const all = h("button", { class: "pln-btn", style: "margin-left:8px" }, hd, "Move all to today");
    all.addEventListener("click", () => void bulk(carried, `Move ${carried.length} carried-over task${carried.length === 1 ? "" : "s"} to today`, line => planLine(line, TODAY)));
    for (const r of carried) item(box, r, { showSched: true });
  }

  // week (in the timeline's Week mode the week calendar below takes its place)
  if (state.tlMode !== "week") {
  const monday = addDays(mondayOf(TODAY_D), state.weekOffset * 7);
  const week = h("div", { class: "pln-week" }, root);
  for (let i = 0; i < 7; i++) {
    const date = iso(addDays(monday, i));
    const tasks = tasksOn(date);
    const open = tasks.filter(r => !meta(r.raw).done);
    const col = h("div", { class: `pln-day${date === TODAY ? " is-today" : ""}${date < TODAY ? " is-past" : ""}${date === tlDay ? " is-shown" : ""}`, "data-day": date }, week);
    const head = h("div", { class: "pln-day-head", title: "Show this day in the timeline below", style: "cursor:pointer" }, col);
    head.addEventListener("click", () => { tlDay = date; render(); });
    h("span", {}, head, date === TODAY ? `Today, ${dayLabel(date)}` : dayLabel(date));
    const mm = minutes(open), L = dayLoad(date), planned = withBuffer(L.all), cap = capMin(date);
    const capEl = h("div", { class: `pln-cap${planned > cap ? (date > TODAY ? " is-full" : " is-over") : planned > cap * 0.85 ? " is-full" : ""}`, title: "Planned time with buffer, against your hours per day" }, col);
    h("div", { style: `width:${cap ? Math.min(100, (100 * planned) / cap) : 0}%` }, capEl);
    h("div", { class: "pln-sub" }, col, `${loadText(L, cap)}${mm.missing ? ` · ${mm.missing} without estimate` : ""}`);
    for (const r of [...tasks].sort((a, b) => (meta(a.raw).start ?? 9999) - (meta(b.raw).start ?? 9999))) item(col, r, { day: date });
    birthdayMarks(col, date);
    const deadlines = ALL.filter(r => { const m = meta(r.raw); return m.due === date && !m.done && !onDate(m, date); });
    for (const r of deadlines) {
      const d = h("div", { class: "pln-due", title: "Deadline on this day (not planned for it)" }, col);
      d.appendChild(document.createTextNode(`⚑ Due: ${label(r.raw)}`));
      d.addEventListener("click", () => openAt(r));
    }
    projectDueMarks(col, date);
  }
  // the week's total row: tasks, time against the week's hours, money to spend
  const wdays = Array.from({ length: 7 }, (_, i) => iso(addDays(monday, i)));
  const wopen = wdays.flatMap(d => tasksOn(d).filter(r => !meta(r.raw).done && !meta(r.raw).event).map(r => ({ r, d })));
  const wmin = wdays.reduce((t, d) => t + minutes(tasksOn(d).filter(r => !meta(r.raw).done)).total, 0), wcap = wdays.reduce((t, d) => t + capMin(d), 0);
  const wcost = [...new Set(wopen.map(x => x.r))].reduce((c, r) => c + (meta(r.raw).cost ?? 0), 0);
  h("div", { class: "pln-sub pln-weektotal", title: "Open tasks planned on these seven days, with the buffer, against the hours of these days" }, root,
    `Week total: ${new Set(wopen.map(x => x.r)).size} open task${new Set(wopen.map(x => x.r)).size === 1 ? "" : "s"} · ${plusBuffer(wmin)} of ${fmtEst(wcap)}${wcost ? ` · ${wcost.toLocaleString(undefined, { style: "currency", currency: "EUR" })} to spend` : ""}`);
  }

  // timeline: one day as hours, with a pool of tasks to drag (or tap, then tap an hour) onto it
  timeline(root);

  // long list
  const pl = h("div", { class: "pln-box" }, root);
  const list = pool();
  const ph = h("h4", {}, pl, `Next steps, not planned yet (${list.length})`);
  const fb = h("div", { class: "pln-bar", style: "margin:4px 0 6px" }, pl);
  const tog = (lbl, key, title) => { const l = h("label", { title }, fb); const i = h("input", { type: "checkbox" }, l); i.checked = !!state[key]; l.appendChild(document.createTextNode(` ${lbl}`)); i.addEventListener("change", () => { state[key] = i.checked; save(); render(); }); };
  tog("Quick wins (15m or less)", "quick", "Short tasks for low-energy moments");
  tog("Due within 7 days", "dueSoon", "Only tasks with a due date in the next week");
  const sl = h("label", {}, fb, "Sort ");
  const ss = h("select", { class: "dropdown" }, sl);
  for (const [v, t] of [["suggested", "Suggested"], ["due", "Due date"], ["est", "Shortest first"], ["priority", "Priority"], ["project", "Project"], ["cost", "Cost"]]) h("option", { value: v }, ss, t);
  ss.value = state.sort;
  ss.addEventListener("change", () => { state.sort = ss.value; save(); render(); });
  if (!list.length) h("p", { class: "pln-sub" }, pl, "No unplanned next steps.");
  const table = h("table", { class: "pln-table" }, pl);
  const days = Array.from({ length: 7 }, (_, i) => iso(addDays(TODAY_D, i)));
  // total rows (idea from Operon's table summaries): one under each project when sorted by project, one for the list
  const totalRow = (rs, title) => {
    const mm = minutes(rs), cost = rs.reduce((c, r) => c + (meta(r.raw).cost ?? 0), 0);
    const tr = h("tr", { class: "pln-total" }, table);
    h("td", {}, tr);
    h("td", { colspan: "3" }, tr, `${title}: ${rs.length} step${rs.length === 1 ? "" : "s"} · ${plusBuffer(mm.total)}${mm.missing ? ` (${mm.missing} counted at ~${GUESS}m)` : ""}${cost ? ` · ${cost.toLocaleString(undefined, { style: "currency", currency: "EUR" })}` : ""}`);
  };
  let block = [];
  const flush = () => { if (state.sort === "project" && block.length > 1) totalRow(block, `${block[0].project} total`); block = []; };
  for (const r of list) {
    if (block.length && block[0].project !== r.project) flush();
    block.push(r);
    const m = meta(r.raw);
    const tr = h("tr", { class: suggestion?.keys.includes(r.key) ? "is-suggested" : "" }, table);
    const c0 = h("td", {}, tr);
    const cb = h("input", { type: "checkbox", class: "task-list-item-checkbox" }, c0);
    cb.addEventListener("click", e => { e.preventDefault(); toggle(r); });
    const c1 = h("td", { class: "pln-c-text" }, tr);
    const tx = h("span", { style: "cursor:pointer" }, c1, label(r.raw));
    tx.addEventListener("click", () => openAt(r));
    h("div", { class: "pln-sub" }, c1, r.project);
    const c2 = h("td", {}, tr); chips(c2, r, m);
    if (m.cost !== null) h("span", { class: "pln-chip" }, c2, m.cost.toLocaleString(undefined, { style: "currency", currency: "EUR" }));
    const c3 = h("td", { class: "pln-c-act", style: "white-space:nowrap;text-align:right" }, tr);
    const b1 = h("button", { class: "pln-btn" }, c3, "Today"); b1.addEventListener("click", () => schedule(r, TODAY));
    const b2 = h("button", { class: "pln-btn", style: "margin-left:3px" }, c3, "Tomorrow"); b2.addEventListener("click", () => schedule(r, TOMORROW));
    const sel = h("select", { class: "dropdown", style: "margin-left:3px;font-size:11px", "aria-label": "Plan on a day" }, c3);
    h("option", { value: "" }, sel, "Day…");
    for (const d of days.slice(2)) h("option", { value: d }, sel, dayLabel(d));
    sel.addEventListener("change", () => { if (sel.value) schedule(r, sel.value); });
    const pe = h("span", { class: "pln-acts", style: "margin-left:4px", title: "Edit task: dates, priority, length, price… (or right-click the task)" }, c3);
    h("span", {}, pe, "✎").addEventListener("click", () => edit(r));
    menuOn(tr, r);
  }
  flush();
  if (list.length > 1) totalRow(list, "All");

  // later steps: open steps that are not next yet, with what they wait for, so nothing in a project is invisible
  const later = ALL.filter(r => { const m = meta(r.raw); return !r.isNext && !m.done && !m.sched && !m.event && !r.kids.some(k => !meta(k.raw).done); });
  if (later.length) {
    const det = h("details", { style: "margin-top:8px" }, pl);
    if (UI.laterOpen) det.open = true;
    det.addEventListener("toggle", () => { UI.laterOpen = det.open; });
    const nBlocked = later.filter(r => blockers(r).length).length;
    h("summary", { class: "pln-sub", style: "cursor:pointer" }, det, `Later steps (${later.length}): ${later.length - nBlocked} waiting for an earlier step, ${nBlocked} blocked by a ⛔`);
    // available vs blocked: a filter, so the ⛔ ones can be looked at on their own (or hidden)
    const lf = h("div", { class: "pln-bar", style: "margin:4px 0" }, det);
    for (const [v, t] of [["all", `All (${later.length})`], ["order", `Waiting in order (${later.length - nBlocked})`], ["blocked", `Blocked ⛔ (${nBlocked})`]]) {
      const b = h("button", { class: `pln-btn${(UI.laterFilter ?? "all") === v ? " mod-cta" : ""}` }, lf, t);
      b.addEventListener("click", () => { UI.laterFilter = v; render(); });
    }
    const lt = h("table", { class: "pln-table" }, det);
    const lfv = UI.laterFilter ?? "all";
    for (const r of suggestedOrder(later).filter(r => lfv === "all" || (lfv === "blocked") === blockers(r).length > 0)) {
      const m = meta(r.raw), tr = h("tr", {}, lt); menuOn(tr, r);
      const c1 = h("td", { class: "pln-c-text" }, tr);
      const tx = h("span", { style: "cursor:pointer;color:var(--text-muted)" }, c1, label(r.raw));
      tx.addEventListener("click", () => openAt(r));
      h("div", { class: "pln-sub" }, c1, `${r.project} · ${blockers(r).length ? `blocked by ⛔ ${blockers(r).map(b => label(b.raw)).join(", ")}` : r.after ? `after: ${r.after}` : "waiting"}`);
      const c2 = h("td", {}, tr); chips(c2, r, m, { noBlocked: true });
      const c3 = h("td", { class: "pln-c-act", style: "white-space:nowrap;text-align:right" }, tr);
      const b = h("button", { class: "pln-btn", title: "Plan it anyway" }, c3, "Today"); b.addEventListener("click", () => schedule(r, TODAY));
      const b2 = h("button", { class: "pln-btn", style: "margin-left:3px" }, c3, "Tomorrow"); b2.addEventListener("click", () => schedule(r, TOMORROW));
    }
  }
}

// ---------- timeline ----------
// Dataview reruns this view after every note edit, so what you are looking at is kept on window between runs.
const UI = (window.__compassPlanner ??= {});
if (UI.today !== TODAY) Object.assign(UI, { today: TODAY, day: TODAY, picked: null, gridScroll: {} });
let tlDay = UI.day;
let picked = UI.picked; // key of a pool task chosen by tap; the next tap on the timeline places it
const scrollerOf = el => { for (let p = el?.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p; } return null; };
const SNAP = 15, PXM = 0.8; // 15 minute steps, 48 px per hour
// the app's Size setting zooms the page: pointer positions arrive zoomed, block positions are not
const ZM = () => dv.container.currentCSSZoom || 1;
const durOf = r => { const m = meta(r.raw); return m.start !== null && m.end > m.start ? m.end - m.start : Math.max(SNAP, Math.ceil(withBuffer(m.spread ? m.share ?? GUESS : (m.est ?? GUESS) / spanDays(m.est)) / 5) * 5); };
// a time on a spread task keeps its days (the time is the same on each of them)
const timeOn = (line, day, s, e) => {
  const m = meta(line);
  if (m.spread && onDate(m, day)) return setTime(line, s, e);
  // a task longer than a day put on the hours is spread from that day, with the same time on each of its days
  if (!m.spread && !m.recur && m.start === null && spanDays(m.est) > 1) return setTime(planLine(line, day), s, s + Math.max(SNAP, Math.ceil(withBuffer(m.est / spanDays(m.est)) / 5) * 5));
  return setScheduled(setTime(line, s, e), day);
};
const place = (r, day, s, e) => act(r, line => timeOn(line, day, s, e), line => timeOn(line, day, s, e));
const unTime = r => act(r, line => setTime(line, null), line => setTime(line, null));

// Pointer drag that works with a mouse (press and move) and on a phone (press and hold, then move).
let drag = null;
function draggable(el, r, kind, extra = {}) {
  el.addEventListener("touchmove", ev => { if (drag?.active) ev.preventDefault(); }, { passive: false });
  el.addEventListener("pointerdown", ev => {
    if (ev.button > 0 || ev.target.closest("input, .pln-x") || (kind !== "resize" && ev.target.closest(".pln-rs"))) return;
    if (kind === "resize") ev.stopPropagation();
    const d = { r, kind, x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, active: false, el, ...extra, touch: ev.pointerType === "touch" };
    if (kind === "block") d.offset = Math.round((ev.clientY - el.getBoundingClientRect().top) / (PXM * ZM()) / SNAP) * SNAP; // grab point inside the block
    drag = d;
    const begin = () => {
      if (drag !== d) return;
      d.active = true; d.ghost = h("div", { class: "pln-drag" }, document.body, label(r.raw)); moveTo(d.x, d.y);
      d.scroller = setInterval(() => autoScroll(d), 50);
      document.addEventListener("touchmove", stopScroll, { passive: false, capture: true });
    };
    if (d.touch) d.timer = setTimeout(begin, 300);
    const move = e => {
      if (drag !== d) return;
      const far = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (!d.active) { if (d.touch) { if (far > 8) cancel(); return; } if (far < 5) return; begin(); }
      d.x = e.clientX; d.y = e.clientY; moveTo(d.x, d.y);
    };
    const up = e => {
      cleanup();
      if (!d.active) return;
      d.justDragged = true; setTimeout(() => (d.justDragged = false), 0);
      // on a phone, holding a task and letting go where it was opens its menu (after the click that follows the
      // touch, which would close it again); holding and moving drags it
      if (d.touch && kind !== "resize" && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 10) {
        const open = () => { clearTimeout(t); document.removeEventListener("click", swallow, true); taskMenu(e, r); };
        const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); open(); };
        const t = setTimeout(open, 400);
        document.addEventListener("click", swallow, true);
        return;
      }
      void drop(d, e.clientX, e.clientY);
    };
    const cancel = () => { cleanup(); };
    const cleanup = () => { clearTimeout(d.timer); clearInterval(d.scroller); document.removeEventListener("touchmove", stopScroll, { capture: true }); document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", cancel); d.ghost?.remove(); clearHints(); if (drag === d) drag = null; if (d.active) { suppressClick = true; setTimeout(() => (suppressClick = false), 50); } };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
  });
}
let suppressClick = false;
const stopScroll = ev => { if (drag?.active) ev.preventDefault(); };
// Hold a dragged task near the top or bottom edge of the hours (or of the screen) for a moment to scroll them.
function autoScroll(d) {
  const gs = root.querySelector(".pln-gs");
  if (!gs) return;
  const b = gs.getBoundingClientRect(), top = Math.max(b.top, 0), bottom = Math.min(b.bottom, window.innerHeight);
  const inside = d.x > b.left && d.x < b.right && d.y > top && d.y < bottom;
  const dir = !inside ? 0 : d.y < top + 36 ? -1 : d.y > bottom - 36 ? 1 : 0;
  if (dir !== d.edgeDir) { d.edgeDir = dir; d.edgeSince = Date.now(); return; }
  if (!dir || Date.now() - d.edgeSince < 350) return;
  const before = gs.scrollTop; gs.scrollTop += dir * 10;
  if (gs.scrollTop === before) { const page = scrollerOf(gs); if (page) page.scrollTop += dir * 10; }
  moveTo(d.x, d.y);
}
const clearHints = () => { for (const x of root.querySelectorAll(".is-drop")) x.classList.remove("is-drop"); root.querySelector(".pln-blk.is-ghost")?.remove(); };
function gridMinute(grid, y, offset = 0) {
  const rect = grid.getBoundingClientRect();
  const raw = Number(grid.dataset.start) + (y - rect.top) / (PXM * ZM()) - offset;
  return Math.max(Number(grid.dataset.start), Math.min(Number(grid.dataset.end) - SNAP, Math.round(raw / SNAP) * SNAP));
}
function target(x, y) {
  const el = document.elementFromPoint(x, y);
  return { grid: el?.closest(".pln-grid"), day: el?.closest(".pln-day[data-day]"), pool: el?.closest(".pln-pool") };
}
const gridDay = grid => grid.dataset.day || tlDay;
function moveTo(x, y) {
  const d = drag; if (!d?.ghost) return;
  d.ghost.style.left = `${x + 12}px`; d.ghost.style.top = `${y + 8}px`;
  clearHints();
  const t = target(x, y);
  if (t.grid) {
    const m = meta(d.r.raw);
    let s, e;
    if (d.kind === "resize") { s = m.start; e = Math.max(s + SNAP, gridMinute(t.grid, y) + SNAP); }
    else { const dur = durOf(d.r); s = gridMinute(t.grid, y, d.kind === "block" ? d.offset : 0); e = s + dur; }
    d.ghost.textContent = `${clock(s)} - ${clock(e)}  ${label(d.r.raw)}`;
    h("div", { class: "pln-blk is-ghost", style: `top:${(s - t.grid.dataset.start) * PXM}px;height:${(e - s) * PXM}px;left:2px;right:2px` }, t.grid);
  } else if (d.kind !== "resize" && t.day) { t.day.classList.add("is-drop"); d.ghost.textContent = `${dayLabel(t.day.dataset.day)}: ${label(d.r.raw)}`; }
  else if (d.kind === "block" && t.pool) { t.pool.classList.add("is-drop"); d.ghost.textContent = `Remove the time: ${label(d.r.raw)}`; }
  else d.ghost.textContent = label(d.r.raw);
}
async function drop(d, x, y) {
  const t = target(x, y), m = meta(d.r.raw);
  if (t.grid) {
    if (d.kind === "resize") { const e = Math.max(m.start + SNAP, gridMinute(t.grid, y) + SNAP); if (e !== m.end) await place(d.r, gridDay(t.grid), m.start, e); return; }
    const s = gridMinute(t.grid, y, d.kind === "block" ? d.offset : 0);
    await place(d.r, gridDay(t.grid), s, s + durOf(d.r));
  } else if (d.kind === "resize") return;
  else if (t.day && t.day.classList.contains("pln-lane") && m.start !== null) {
    // a block dropped on a day's "no time yet" row keeps (or moves to) that day without a time
    const day = t.day.dataset.day, fn = line => { const l = setTime(line, null); return onDate(meta(l), day) ? l : planLine(l, day); };
    await act(d.r, fn, fn);
  }
  else if (t.day) { const day = t.day.dataset.day; if (m.spread) { if (day !== m.start0) await shift(d.r, daysUntil(day) - daysUntil(m.start0)); } else if (day !== m.sched) await schedule(d.r, day); }
  else if (d.kind === "block" && t.pool) await unTime(d.r);
}

// ---------- selection ----------
// Drag across empty hours (on a phone: press and hold, then move) to select a range, like cells in a spreadsheet:
// the same hours on every day from the first to the last day you cross. Shift-click extends it, a click on empty
// hours or Escape clears it. The box above the hours sums it up and can fill the free time in it.
let sel = UI.sel ?? null; // { d0, d1, s, e }: first and last day (ISO), start and end minute
let selAnchor = UI.selAnchor ?? null;
const setSel = v => { sel = UI.sel = v; };
// A note edit makes Dataview run this view again, which can happen in the middle of a drag: then the newest run's
// planner is the one on screen, so the drag draws on and redraws that one.
UI.render = render; UI.root = root;
const liveRoot = () => (root.isConnected ? root : UI.root ?? root);
const redraw = () => (root.isConnected ? render() : UI.render?.());
const clearSel = () => { setSel(null); redraw(); };
const selFrom = (a, b) => { const [d0, d1] = a.day <= b.day ? [a.day, b.day] : [b.day, a.day]; return { d0, d1, s: Math.min(a.m, b.m), e: Math.max(a.m, b.m) + SNAP }; };
const selDayList = s => { const out = []; for (let d = s.d0; d <= s.d1 && out.length < 62; d = iso(addDays(asDate(d), 1))) out.push(d); return out; };
const shortDay = d => `${asDate(d).toLocaleDateString(undefined, { weekday: "short" })} ${d.slice(8, 10)}-${d.slice(5, 7)}${d.slice(0, 4) === TODAY.slice(0, 4) ? "" : `-${d.slice(0, 4)}`}`;
const selTitle = s => `${s.d0 === s.d1 ? shortDay(s.d0) : `${shortDay(s.d0)} to ${shortDay(s.d1)}`}, ${clock(s.s)} - ${clock(s.e)}${s.d0 === s.d1 ? "" : " each day"}`;
// Each selected day gets a light fill; one frame goes around all of them, like a range in a spreadsheet, with a
// running dashed border. The frame needs the laid-out grids, so it is drawn a frame after the hours are built.
function drawSelOn(grid) {
  grid.querySelector(".pln-sel")?.remove();
  const d = grid.dataset.day;
  if (!sel || d < sel.d0 || d > sel.d1) return;
  const g0 = +grid.dataset.start, s = Math.max(sel.s, g0), e = Math.min(sel.e, +grid.dataset.end);
  if (e <= s) return;
  h("div", { class: "pln-sel", style: `top:${(s - g0) * PXM}px;height:${(e - s) * PXM}px` }, grid);
  if (!UI.selFramePending) { UI.selFramePending = true; requestAnimationFrame(() => { UI.selFramePending = false; drawFrame(); }); }
}
function drawFrame() {
  const r = liveRoot();
  for (const x of r.querySelectorAll(".pln-selframe")) x.remove();
  if (!sel) return;
  const parts = [...r.querySelectorAll(".pln-grid[data-day] > .pln-sel")];
  if (!parts.length) return;
  const box = parts[0].parentElement.parentElement, br = box.getBoundingClientRect();
  if (getComputedStyle(box).position === "static") box.style.position = "relative";
  const rs = parts.map(p => p.getBoundingClientRect());
  const left = Math.min(...rs.map(x => x.left)), right = Math.max(...rs.map(x => x.right)), top = Math.min(...rs.map(x => x.top)), bottom = Math.max(...rs.map(x => x.bottom));
  const f = h("div", { class: "pln-selframe", style: `left:${Math.ceil(left - br.left + box.scrollLeft)}px;top:${Math.round(top - br.top + box.scrollTop)}px;width:${Math.floor(right - left) - 1}px;height:${Math.round(bottom - top)}px` }, box);
  h("span", {}, f, `${clock(sel.s)} - ${clock(sel.e)}`);
}
const drawSel = () => { for (const g of liveRoot().querySelectorAll(".pln-grid[data-day]")) drawSelOn(g); drawFrame(); };
const noTouchScroll = ev => ev.preventDefault();
function selectable(grid) {
  grid.addEventListener("pointerdown", ev => {
    if (ev.button > 0 || picked || drag || ev.target.closest(".pln-blk, .pln-x, .pln-rs, input")) return;
    const at = (x, y) => { const g = document.elementFromPoint(x, y)?.closest(".pln-grid[data-day]"); return g && liveRoot().contains(g) ? { day: g.dataset.day, m: gridMinute(g, y) } : null; };
    const a = { day: grid.dataset.day, m: gridMinute(grid, ev.clientY) };
    if (ev.shiftKey && selAnchor) { ev.preventDefault(); setSel(selFrom(selAnchor, a)); suppressClick = true; setTimeout(() => (suppressClick = false), 50); render(); return; }
    const o = { x: ev.clientX, y: ev.clientY, active: false, touch: ev.pointerType === "touch" };
    const begin = () => {
      o.active = true; selAnchor = UI.selAnchor = a; setSel(selFrom(a, a)); drawSel();
      o.scroller = setInterval(() => { autoScroll(o); update(); }, 50);
      document.addEventListener("touchmove", noTouchScroll, { passive: false, capture: true });
    };
    const update = () => { const b = at(o.x, o.y); if (b) { setSel(selFrom(a, b)); drawSel(); } };
    if (o.touch) o.timer = setTimeout(begin, 300);
    const move = e => {
      const far = Math.hypot(e.clientX - o.x, e.clientY - o.y);
      if (!o.active) { if (o.touch) { if (far > 8) cleanup(); return; } if (far < 5) return; begin(); }
      o.x = e.clientX; o.y = e.clientY; update();
    };
    const up = () => { const was = o.active; cleanup(); if (was) { UI.selReveal = true; redraw(); } };
    const cleanup = () => {
      clearTimeout(o.timer); clearInterval(o.scroller);
      document.removeEventListener("touchmove", noTouchScroll, { capture: true });
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", cleanup);
      if (o.active) { suppressClick = true; setTimeout(() => (suppressClick = false), 50); }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cleanup);
  });
}
if (UI.selKey) document.removeEventListener("keydown", UI.selKey);
UI.selKey = ev => { if (ev.key === "Escape" && sel && root.isConnected) clearSel(); };
document.addEventListener("keydown", UI.selKey);

// Minutes of a list of intervals inside [s, e], overlaps counted once.
function unionIn(list, s, e) {
  const xs = list.map(b => [Math.max(b.s, s), Math.min(b.e, e)]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let t = 0, cur = null;
  for (const [a, b] of xs) { if (!cur || a > cur[1]) { if (cur) t += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b); }
  return cur ? t + cur[1] - cur[0] : t;
}
// What is in the selection, per day and in total.
function selStats(s) {
  const days = selDayList(s), out = { days: [], total: 0, tasks: 0, busy: 0, free: 0, inside: [], untimed: [], due: [], cost: 0, untimedCost: 0 };
  for (const day of days) {
    const timed = timedOn(day), w = s.e - s.s;
    const T = timed.filter(r => !meta(r.raw).event).map(r => ({ r, s: meta(r.raw).start, e: Math.max(meta(r.raw).end, meta(r.raw).start + SNAP) }));
    const B = [...timed.filter(r => meta(r.raw).event).map(r => ({ s: meta(r.raw).start, e: meta(r.raw).end })), ...workOn(day),
      ...timed.filter(r => commuteOf(r)).flatMap(r => { const p = padded(r), m = meta(r.raw); return [{ s: p.s, e: m.start }, { s: Math.max(m.end, m.start + SNAP), e: p.e }]; })];
    const tasks = unionIn(T, s.s, s.e), all = unionIn([...T, ...B], s.s, s.e);
    out.days.push({ day, total: w, tasks, busy: all - tasks, free: w - all });
    out.total += w; out.tasks += tasks; out.busy += all - tasks; out.free += w - all;
    for (const b of T) if (b.s < s.e && b.e > s.s) out.inside.push({ ...b, day });
    out.untimed.push(...untimedOn(day));
    out.due.push(...ALL.filter(r => { const m = meta(r.raw); return m.due === day && !m.done; }));
  }
  for (const b of out.inside) out.cost += meta(b.r.raw).cost ?? 0;
  for (const r of out.untimed) out.untimedCost += meta(r.raw).cost ?? 0;
  return out;
}
const eur = n => n.toLocaleString(undefined, { style: "currency", currency: "EUR" });
// Fill the selection: each day's tasks without a time, then next steps, go into the free time inside it, most urgent
// first. Today never before now. A task longer than a day is left out (it would spread past the selection).
function selFill(s) {
  const nowMin = NOW.getHours() * 60 + NOW.getMinutes(), used = new Set(), fits = [];
  const next = suggestedOrder(pool()).filter(r => { const m = meta(r.raw); return !m.recur && spanDays(m.est) <= 1; });
  for (const day of selDayList(s)) {
    if (day < TODAY) continue;
    const busy = [...timedOn(day).map(padded), ...workOn(day)];
    const from = Math.max(s.s, day === TODAY ? Math.ceil(nowMin / SNAP) * SNAP : 0);
    const cands = [...suggestedOrder(untimedOn(day)).filter(r => { const m = meta(r.raw); return m.spread || spanDays(m.est) <= 1; }), ...next];
    for (const r of cands) {
      if (used.has(r.key)) continue;
      const c = commuteOf(r), dur = durOf(r) + 2 * c;
      let s0 = from;
      for (let moved = true; moved;) { moved = false; for (const b of busy) if (s0 < b.e && s0 + dur > b.s) { s0 = Math.ceil(b.e / 5) * 5; moved = true; } }
      if (s0 + dur > s.e) continue;
      used.add(r.key); busy.push({ s: s0, e: s0 + dur }); fits.push({ r, day, s: s0 + c, e: s0 + dur - c });
    }
  }
  return fits;
}
// Above the hours on a wide screen, under them on a phone (where the hours fill the screen); scrolled into view
// when a selection is made.
function selPanel(box, where) {
  if (!sel || where !== ((root.getBoundingClientRect().width || window.innerWidth) < 700 ? "below" : "above")) return;
  const st = selStats(sel);
  const p = h("div", { class: "pln-selbox" }, box);
  if (UI.selReveal) { UI.selReveal = false; requestAnimationFrame(() => p.scrollIntoView({ block: "nearest" })); }
  const hd = h("div", { class: "pln-selhd" }, p);
  h("span", { class: "pln-seltitle" }, hd, selTitle(sel));
  h("button", { class: "pln-btn", title: "Clear the selection (Escape)" }, hd, "✕").addEventListener("click", clearSel);
  const pct = x => (st.total ? (100 * x) / st.total : 0);
  const bar = h("div", { class: "pln-selbar", title: "Tasks, busy (work, commute, events) and free time in the selection" }, p);
  h("div", { class: "is-tasks", style: `width:${pct(st.tasks)}%` }, bar); h("div", { class: "is-busy", style: `width:${pct(st.busy)}%` }, bar);
  const nums = h("div", { class: "pln-selnums" }, p);
  for (const [k, v, c] of [["Selected", st.total], ["Tasks", st.tasks, "is-tasks"], ["Busy", st.busy, "is-busy"], ["Free", st.free, "is-free"]]) { const t = h("div", { class: c ?? "" }, nums); h("b", {}, t, fmtEst(v)); h("span", {}, t, k); }
  if (st.days.length > 1) h("div", { class: "pln-sub" }, p, `Free per day: ${st.days.map(d => `${asDate(d.day).toLocaleDateString(undefined, { weekday: "short" })} ${fmtEst(d.free)}`).join(" · ")}`);
  const notes = [];
  if (st.cost) notes.push(`cost of these tasks ${eur(st.cost)}`);
  if (st.untimed.length) notes.push(`${st.untimed.length} more on ${st.days.length > 1 ? "these days" : "this day"} without a time (${plusBuffer(minutes(st.untimed).total)}${st.untimedCost ? `, ${eur(st.untimedCost)}` : ""})`);
  if (st.due.length) notes.push(`${st.due.length} due on ${st.days.length > 1 ? "these days" : "this day"}`);
  if (notes.length) h("div", { class: "pln-sub" }, p, notes.join(" · ").replace(/^./, c => c.toUpperCase()));
  const ticked = (UI.selTicked ??= {});
  if (st.inside.length) {
    const ul = h("div", { class: "pln-sellist" }, p);
    for (const b of st.inside.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : x.s - y.s))) {
      const m = meta(b.r.raw), row = h("div", { class: `pln-selrow${m.done ? " is-done" : ""}` }, ul); menuOn(row, b.r);
      const cb = h("input", { type: "checkbox", title: "Tick the tasks to add a commute to (or remove it from)" }, row);
      cb.checked = ticked[b.r.key] ?? !m.event; cb.addEventListener("change", () => { ticked[b.r.key] = cb.checked; redraw(); });
      h("span", { class: "pln-bt" }, row, `${st.days.length > 1 ? `${asDate(b.day).toLocaleDateString(undefined, { weekday: "short" })} ` : ""}${clock(b.s)} - ${clock(b.e)}`);
      h("span", { class: "pln-text" }, row, label(b.r.raw)).addEventListener("click", () => openAt(b.r));
      if (m.commute) h("span", { class: "pln-chip", title: "Commute before and after (the [commute::] field)" }, row, `🚶 ${fmtEst(m.commute)}`);
      if (m.cost !== null) h("span", { class: "pln-chip" }, row, eur(m.cost));
    }
  }
  const tools = h("div", { class: "pln-bar", style: "margin:6px 0 0" }, p);
  const fits = selFill(sel);
  if (fits.length) {
    h("button", { class: "pln-btn mod-cta", title: "Puts tasks into the free time of the selection: each day's tasks without a time first, then next steps, most urgent first" }, tools, `Fill the free time (${fits.length})`)
      .addEventListener("click", () => void bulk(fits.map(f => f.r), `Put ${fits.length} task${fits.length === 1 ? "" : "s"} into ${selTitle(sel)}`, (line, r) => { const f = fits.find(x => x.r === r); return timeOn(line, f.day, f.s, f.e); }));
  } else if (st.free) h("span", { class: "pln-sub" }, tools, "No task without a time fits into the free time here.");
  const picks = st.inside.filter(b => ticked[b.r.key] ?? !meta(b.r.raw).event).map(b => b.r);
  if (picks.length) {
    const mins = UI.commuteMin ?? COMMUTE_DEFAULT;
    const wrap = h("span", { class: "pln-commute" }, tools);
    const add = h("button", { class: "pln-btn", title: "Writes [commute:: …] on the ticked tasks: the planner then draws the travel before and after each, and it moves with the task" }, wrap, `🚶 Add commute (${picks.length})`);
    const inp = h("input", { type: "number", min: "5", step: "5", value: String(mins), title: "Minutes each way (default: commute_minutes in your Ideal Week)" }, wrap);
    h("span", { class: "pln-sub" }, wrap, "min each way");
    inp.addEventListener("change", () => { UI.commuteMin = Math.max(5, Number(inp.value) || COMMUTE_DEFAULT); });
    add.addEventListener("click", () => { const c = UI.commuteMin ?? COMMUTE_DEFAULT; void bulk(picks, `Add ${fmtEst(c)} commute before and after ${picks.length} task${picks.length === 1 ? "" : "s"}`, line => setCommute(line, c)); });
    const has = picks.filter(r => commuteOf(r));
    if (has.length) h("button", { class: "pln-btn", title: "Takes the [commute::] field off the ticked tasks" }, wrap, `Remove commute (${has.length})`)
      .addEventListener("click", () => void bulk(has, `Remove the commute from ${has.length} task${has.length === 1 ? "" : "s"}`, line => setCommute(line, 0)));
  }
}

// ---------- commute around a task ----------
// A task away from home carries [commute:: 45m]: the planner draws that much travel before and after it, so it
// moves with the task, and Fill the gaps and the selection leave room for it. Add it from a selection.
const COMMUTE_DEFAULT = Number(dv.page(IDEAL_PATH)?.commute_minutes ?? 0) || 30;
const commuteOf = r => meta(r.raw).commute || 0;
const padded = r => { const m = meta(r.raw), c = m.commute || 0; return { s: m.start - c, e: Math.max(m.end, m.start + SNAP) + c }; };
const COMMUTE_RE = /\s*\[commute::[^\]]*\]/;
function setCommute(line, min) {
  const plain = line.replace(COMMUTE_RE, "");
  if (!min) return plain;
  const field = ` [commute:: ${fmtEst(min).replace(" ", "")}]`;
  const at = plain.search(/\s(📅|⏳|🛫|➕|✅|❌|🔁|🆔|⛔|[🔺⏫🔼🔽⏬]|\^[\w-]+$)/u);
  return at < 0 ? plain.replace(/\s*$/, field) : plain.slice(0, at) + field + plain.slice(at);
}
function commuteBlocks(grid, day, g0, g1, timed) {
  for (const r of timed) {
    const m = meta(r.raw), c = m.commute;
    if (!c || m.start === null) continue;
    const end = Math.max(m.end, m.start + SNAP);
    for (const [s0, e0, what] of [[m.start - c, m.start, "there"], [end, end + c, "back"]]) {
      const s = Math.max(s0, g0), e = Math.min(e0, g1);
      if (e <= s) continue;
      const el = h("div", { class: `pln-work is-commute is-trip${what === "back" ? " is-back" : ""}`, style: `top:${(s - g0) * PXM}px;height:${Math.max(10, (e - s) * PXM - 2)}px${areaStyle(r.area) || `;--blk:var(--interactive-accent)`}`, title: `Commute ${what} for "${label(r.raw)}", ${clock(s0)} - ${clock(e0)} ([commute:: ${fmtEst(c)}] on the task; it moves with the task)` }, grid);
      if ((e - s) * PXM >= 14) h("b", {}, el, `🚶 ${fmtEst(c)}`);
    }
  }
}

// Fill the gaps: untimed tasks of the shown day go into free time, most urgent first, never past your day end.
function fillPlan(untimed, timed) {
  const dayStart = parseClock(state.dayStart) ?? 7 * 60, dayEnd = Math.min(parseClock(state.dayEnd) ?? 21 * 60, 24 * 60);
  const nowMin = NOW.getHours() * 60 + NOW.getMinutes();
  let cursor = tlDay === TODAY ? Math.max(dayStart, Math.ceil(nowMin / SNAP) * SNAP) : dayStart;
  // blocks already on the day, plus work and commute when the work schedule is on
  const busy = [...timed.map(padded), ...workOn(tlDay).map(b => ({ s: b.s, e: b.e }))].sort((a, b) => a.s - b.s);
  const fits = [], noRoom = [];
  for (const r of suggestedOrder(untimed)) {
    const c = commuteOf(r), dur = durOf(r) + 2 * c; // a task with a commute needs the travel around it too
    let s0 = cursor;
    for (const b of busy) if (s0 < b.e && s0 + dur > b.s) s0 = Math.ceil(b.e / 5) * 5;
    if (s0 + dur > dayEnd) { noRoom.push(r); continue; }
    fits.push({ r, s: s0 + c, e: s0 + dur - c }); busy.push({ s: s0, e: s0 + dur }); busy.sort((a, b) => a.s - b.s);
    cursor = s0 + dur;
  }
  return { fits, noRoom };
}

// A task to drag onto the hours (or tap, then tap an hour). On a day's row it shows that day's share.
function poolItem(parent, r, { day = null } = {}) {
  const m = meta(r.raw);
  const it = h("div", { class: `pln-pi${picked === r.key ? " is-picked" : ""}${suggestion?.keys?.includes(r.key) ? " is-suggested" : ""}`, title: "Drag onto the hours, or tap it and then tap an hour", ...(AREA_COLORS[r.area] ? { style: `--blk:${AREA_COLORS[r.area]}` } : {}) }, parent);
  h("span", { class: "pln-text" }, it, label(r.raw));
  const cs = h("span", { class: "pln-chips" }, it);
  h("span", { class: `pln-chip${m.est === null ? " is-guess" : ""}`, title: m.spread ? `This day's share of the task` : m.est === null ? `No estimate yet; planned as ${GUESS} minutes` : "Estimate" }, cs, m.spread ? fmtEst(m.share ?? GUESS) : m.est === null ? `~${GUESS}m` : fmtEst(m.est));
  if (m.spread && day) h("span", { class: "pln-chip", title: `Spread over ${m.ndays} days` }, cs, `${daysUntil(day) - daysUntil(m.start0) + 1}/${m.ndays}`);
  else if (!m.spread && !m.recur && spanDays(m.est) > 1) h("span", { class: "pln-chip is-soon", title: `${fmtEst(m.est)} is more than your ${state.capacity} hours a day: putting it on the hours spreads it over ${spanDays(m.est)} days, ${fmtEst(m.est / spanDays(m.est))} a day plus buffer` }, cs, `⇉ ${spanDays(m.est)} days`);
  if (m.recur) h("span", { class: "pln-chip", title: "Repeating task" }, cs, "🔁");
  if (m.due) { const dd = daysUntil(m.due); h("span", { class: `pln-chip${dd < 0 ? " is-due" : dd <= 2 ? " is-soon" : ""}` }, cs, dd < 0 ? "overdue" : dd === 0 ? "due today" : `due ${dd}d`); }
  it.addEventListener("click", () => { if (suppressClick) return; picked = picked === r.key ? null : r.key; render(); });
  draggable(it, r, "pool");
  menuOn(it, r);
  return it;
}
// The hours shown: your day's start to its end, widened to fit every block.
function hourRange(timed) {
  const W = Object.values(WORK).flat(); // work and commute always fit on the hours
  const starts = [...timed.map(r => padded(r).s), ...W.map(b => b.s)], ends = [...timed.map(r => padded(r).e), ...W.map(b => b.e)];
  const g0 = Math.floor(Math.min(parseClock(state.dayStart) ?? 7 * 60, ...starts) / 60) * 60;
  const g1 = Math.min(24 * 60, Math.ceil(Math.max(parseClock(state.dayEnd) ?? 21 * 60, ...ends) / 60) * 60);
  return { g0, g1 };
}
// One day's hours with its time blocks. Every grid knows its day, so the day view (one grid) and the week view
// (a grid per day) share the same dragging, resizing and dropping.
function hourGrid(parent, day, g0, g1, timed, { labels = true } = {}) {
  const grid = h("div", { class: `pln-grid${picked ? " is-picking" : ""}`, style: `height:${(g1 - g0) * PXM}px`, "data-start": g0, "data-end": g1, "data-day": day }, parent);
  for (let t = g0; t < g1; t += 30) { const ln = h("div", { class: `pln-hr${t % 60 ? " is-half" : ""}`, style: `top:${(t - g0) * PXM}px` }, grid); if (labels && !(t % 60)) h("span", {}, ln, clock(t)); }
  // the Ideal Week behind the hours: task time tinted, other blocks grey with their name
  for (const b of bandsOn(day)) {
    const s = Math.max(b.s, g0), e = Math.min(b.e, g1);
    if (e <= s) continue;
    const band = h("div", { class: `pln-ideal${b.tasks ? " is-tasks" : ""}${b.busy ? " is-busy" : ""}`, style: `top:${(s - g0) * PXM}px;height:${(e - s) * PXM}px`, title: `${b.busy ? "Work schedule" : "Ideal Week"}: ${b.what} ${clock(b.s)} - ${clock(b.e)}${b.tasks ? " (time for tasks)" : b.busy ? " (kept free of tasks)" : ""}` }, grid);
    h("span", {}, band, b.what);
  }
  // work and commute: blocks in the Work colour, not movable here (the Work tab's Work schedule changes them). On the
  // Study and Personal tabs they are only a light shade: the time is taken, but the page stays about its own area.
  const otherArea = AREA && AREA !== "work";
  for (const b of workOn(day)) {
    const s = Math.max(b.s, g0), e = Math.min(b.e, g1);
    if (e <= s) continue;
    const el = h("div", { class: `pln-work${b.work ? "" : " is-commute"}${otherArea ? " is-other" : ""}`, style: `top:${(s - g0) * PXM}px;height:${Math.max(12, (e - s) * PXM - 2)}px;--blk:${AREA_COLORS.work}`, title: `${b.what} ${clock(b.s)} - ${clock(b.e)}: kept free of tasks. Change it in the Work schedule on the Work tab.` }, grid);
    if (otherArea && !b.work) continue;
    h("b", {}, el, b.what);
    if (!otherArea && (e - s) * PXM >= 28) h("span", { class: "pln-bt" }, el, ` ${clock(b.s)} - ${clock(b.e)}`);
  }
  // on an area tab, other areas' tasks with a time are a light shade: the time is taken, the page stays about its area
  if (AREA) for (const r of EVERY.filter(r => r.area !== AREA && !EVENT_RE.test(r.raw))) {
    const m = meta(r.raw);
    if (!onDate(m, day) || m.start === null || m.done) continue;
    const s = Math.max(m.start, g0), e = Math.min(m.end, g1);
    if (e <= s) continue;
    h("div", { class: "pln-work is-other", style: `top:${(s - g0) * PXM}px;height:${Math.max(12, (e - s) * PXM - 2)}px;--blk:${AREA_COLORS[r.area] ?? "var(--text-faint)"}`, title: `${r.area ?? "No area"}: ${label(r.raw)} ${clock(m.start)} - ${clock(m.end)}. Plan it on its own tab or Home.` }, grid);
  }
  commuteBlocks(grid, day, g0, g1, timed);
  const nowMin = NOW.getHours() * 60 + NOW.getMinutes();
  if (day === TODAY && nowMin >= g0 && nowMin < g1) h("div", { class: "pln-now", style: `top:${(nowMin - g0) * PXM}px` }, grid);
  grid.addEventListener("click", ev => {
    if (!suppressClick && !picked && sel && !ev.target.closest(".pln-blk")) { clearSel(); return; }
    if (suppressClick || !picked || ev.target.closest(".pln-blk")) return;
    const r = byKey.get(picked); picked = null;
    if (!r) { render(); return; }
    const s = gridMinute(grid, ev.clientY);
    void place(r, day, s, s + durOf(r));
  });
  selectable(grid);
  // blocks, side by side where they overlap
  const blocks = timed.map(r => ({ r, s: meta(r.raw).start, e: Math.max(meta(r.raw).end, meta(r.raw).start + SNAP) })).sort((a, b) => a.s - b.s || b.e - a.e);
  const laneEnd = [];
  for (const b of blocks) { let l = laneEnd.findIndex(e => e <= b.s); if (l < 0) { l = laneEnd.length; laneEnd.push(0); } laneEnd[l] = b.e; b.lane = l; }
  for (const b of blocks) b.cols = Math.max(...blocks.filter(o => o.s < b.e && b.s < o.e).map(o => o.lane)) + 1;
  for (const b of blocks) {
    const m = meta(b.r.raw), w = 100 / b.cols;
    const el = h("div", { class: `pln-blk${m.event ? " is-event" : ""}${m.done ? " is-done" : ""}`, style: `top:${(b.s - g0) * PXM}px;height:${Math.max(18, (b.e - b.s) * PXM - 2)}px;left:calc(${b.lane * w}% + 2px);width:calc(${w}% - 4px)${areaStyle(b.r.area)}` }, grid);
    const top = h("div", {}, el);
    if (!m.event) { const cb = h("input", { type: "checkbox", class: "task-list-item-checkbox", style: "margin:0 4px 0 0;vertical-align:middle" }, top); cb.checked = m.done; cb.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); toggle(b.r); }); }
    h("span", { class: "pln-bt" }, top, `${clock(b.s)} - ${clock(b.e)} `);
    h("span", {}, top, label(b.r.raw));
    el.addEventListener("click", ev => { if (suppressClick || ev.target.closest("input, .pln-x, .pln-rs")) return; openAt(b.r); });
    if (m.event) { el.title = "Calendar event: re-import the calendar to change it"; continue; }
    el.title = "Drag to move, drag the bottom edge to change the length, click to open";
    h("span", { class: "pln-x", title: "Remove the time (stays on this day)" }, el, "✕").addEventListener("click", ev => { ev.stopPropagation(); void unTime(b.r); });
    const rs = h("div", { class: "pln-rs" }, el);
    draggable(rs, b.r, "resize");
    draggable(el, b.r, "block");
    menuOn(el, b.r);
  }
  drawSelOn(grid);
  return blocks;
}
const timedOn = day => ALL.filter(r => { const m = meta(r.raw); return onDate(m, day) && m.start !== null; });
const untimedOn = day => tasksOn(day).filter(r => { const m = meta(r.raw); return m.start === null && !m.done && !m.event; });

function timeline(root) {
  const week = state.tlMode === "week";
  const box = h("div", { class: "pln-box" }, root);
  const hd = h("h4", {}, box, week ? "Week " : "Timeline ");
  const seg = h("span", { class: "pln-seg" }, hd);
  for (const [v, t, tip] of [["day", "Day", "One day as hours"], ["week", "Week", "The week as hours, a column per day"]]) {
    const b = h("button", { class: `pln-btn${(week ? "week" : "day") === v ? " is-on" : ""}`, title: tip }, seg, t);
    b.addEventListener("click", () => { state.tlMode = v; save(); render(); });
  }
  if (week) return weekView(box, hd);
  const nav = h("span", { style: "font-weight:normal;margin-left:6px" }, hd);
  const pb = h("button", { class: "pln-btn" }, nav, "‹"); pb.addEventListener("click", () => { tlDay = iso(addDays(asDate(tlDay), -1)); render(); });
  h("span", { style: "margin:0 6px" }, nav, tlDay === TODAY ? `Today, ${dayLabel(tlDay)}` : dayLabel(tlDay));
  const nb = h("button", { class: "pln-btn" }, nav, "›"); nb.addEventListener("click", () => { tlDay = iso(addDays(asDate(tlDay), 1)); render(); });
  if (tlDay !== TODAY) { const tb = h("button", { class: "pln-btn", style: "margin-left:4px" }, nav, "Today"); tb.addEventListener("click", () => { tlDay = TODAY; render(); }); }

  const timed = timedOn(tlDay);
  const untimed = untimedOn(tlDay);
  const { fits, noRoom } = fillPlan(untimed, timed);

  const tools = h("div", { class: "pln-bar", style: "margin:2px 0 8px" }, box);
  if (fits.length) {
    const fb = h("button", { class: "pln-btn mod-cta", title: "Puts this day's tasks without a time into the free time, most urgent first" }, tools, `Fill the gaps (${fits.length})`);
    fb.addEventListener("click", () => void bulk(fits.map(p => p.r), `Put ${fits.length} task${fits.length === 1 ? "" : "s"} on the timeline of ${dayLabel(tlDay)}`, (line, r) => { const p = fits.find(x => x.r === r); return timeOn(line, tlDay, p.s, p.e); }));
  }
  const dp = h("button", { class: "pln-btn" }, tools, "Day Planner week ↗");
  dp.addEventListener("click", () => { if (!app.commands.executeCommandById("obsidian-day-planner:show-weekly-view")) notify("Turn on the Day Planner plugin for its week view."); });
  h("span", { class: "pln-sub" }, tools, picked ? "Now tap an hour to put the chosen task there. Tap it again to cancel." : "Drag a task onto an hour (on a phone: press and hold, or tap it and then tap an hour). Drag a block to move it, its bottom edge to change its length, back to the list to remove its time, or onto a day above to move it there. Drag across empty hours to select a range and see what is in it.");
  if (noRoom.length) h("p", { class: "pln-sub", style: "color:var(--color-red);margin:0 0 6px" }, box, `${noRoom.length} task${noRoom.length === 1 ? " does" : "s do"} not fit before ${state.dayEnd}: drag ${noRoom.length === 1 ? "it" : "them"} onto another day in the week.`);

  selPanel(box, "above");
  const wrap = h("div", { class: "pln-tlw" }, box);
  const poolEl = h("div", { class: "pln-pool" }, wrap);
  h("h5", {}, poolEl, untimed.length ? `On this day, no time yet (${untimed.length})` : "On this day, no time yet: none");
  for (const r of untimed) poolItem(poolEl, r, { day: tlDay });
  const next = pool();
  h("h5", {}, poolEl, `Next steps (${next.length})`);
  if (!next.length) h("div", { class: "pln-sub" }, poolEl, "No unplanned next steps.");
  for (const r of next) poolItem(poolEl, r);

  const gs = h("div", { class: "pln-gs" }, wrap);
  const { g0, g1 } = hourRange(timed);
  const blocks = hourGrid(gs, tlDay, g0, g1, timed);
  // open at the current hour (or the first block)
  const nowMin = NOW.getHours() * 60 + NOW.getMinutes();
  const focus = tlDay === TODAY ? nowMin - 60 : (blocks[0]?.s ?? g0) - 30;
  const kept = UI.gridScroll[tlDay];
  requestAnimationFrame(() => { gs.scrollTop = kept ?? Math.max(0, (focus - g0) * PXM); });
  gs.addEventListener("scroll", () => { UI.gridScroll[tlDay] = gs.scrollTop; });
  selPanel(box, "below");
}

// Week: a column of hours per day (three days at a time on a narrow screen), each day's tasks without a time in a
// row under its date, next steps on the side. Everything is written as in the day view: ⏳ for the day,
// "HH:MM - HH:MM" after the checkbox (Day Planner's format), 🛫 and ⏳ for a task spread over days.
function weekView(box, hd) {
  const width = root.getBoundingClientRect().width || window.innerWidth;
  // seven days; below about 600 px they sit in a strip that scrolls sideways (about three on screen), opening at the
  // day you were on, with the hours pinned on the left. The list goes on top below 900 px.
  const narrow = width < 600, n = 7, stacked = width < 900;
  const first = iso(addDays(mondayOf(TODAY_D), state.weekOffset * 7));
  const days = Array.from({ length: n }, (_, i) => iso(addDays(asDate(first), i)));
  const short = d => `${asDate(d).toLocaleDateString(undefined, { weekday: "short" })} ${d.slice(8, 10)}-${d.slice(5, 7)}`;
  const nav = h("span", { style: "font-weight:normal;margin-left:6px" }, hd);
  const move = k => { state.weekOffset += k > 0 ? 1 : -1; save(); render(); };
  h("button", { class: "pln-btn", title: "Week before" }, nav, "‹").addEventListener("click", () => move(-1));
  h("span", { style: "margin:0 6px" }, nav, `${short(days[0])} to ${short(days[n - 1])}-${days[n - 1].slice(0, 4)}`);
  h("button", { class: "pln-btn", title: "Week after" }, nav, "›").addEventListener("click", () => move(1));
  if (state.weekOffset !== 0) {
    const tb = h("button", { class: "pln-btn", style: "margin-left:4px" }, nav, "This week");
    tb.addEventListener("click", () => { state.weekOffset = 0; save(); render(); });
  }
  const tools = h("div", { class: "pln-bar", style: "margin:2px 0 8px" }, box);
  const dp = h("button", { class: "pln-btn" }, tools, "Day Planner week ↗");
  dp.addEventListener("click", () => { if (!app.commands.executeCommandById("obsidian-day-planner:show-weekly-view")) notify("Turn on the Day Planner plugin for its week view."); });
  h("span", { class: "pln-sub" }, tools, picked ? "Now tap an hour in any day to put the chosen task there. Tap it again to cancel."
    : "Drag a next step onto a day and an hour (on a phone: press and hold, or tap it and then tap an hour). A day's tasks without a time wait in the row under its date; drag them into the hours. Drag a block to another day or hour, its bottom edge to change its length, onto a day's row to take its time off, or back to the list. Tap a date to open that day. Drag across empty hours, over several days if you like, to select a range and see what is in it.");

  // the answer first: how full these days are, and which day is over
  const loads = days.map(d => { const own = dayLoad(d).all; return { d, own, m: withBuffer(own) }; });
  const total = loads.reduce((t, x) => t + x.own, 0), over = loads.filter(x => x.m > capMin(x.d));
  h("p", { class: "pln-answer" }, box, `${plusBuffer(total)} planned of ${fmtEst(days.reduce((t, d) => t + capMin(d), 0))} ${IDEAL_ON ? "of task time in your Ideal Week" : ""} on these ${n} days.${over.length ? ` Over: ${over.map(x => `${short(x.d)} by ${fmtEst(x.m - capMin(x.d))}`).join(", ")}.` : " Every day fits."}`.replace("  on", " on"));
  selPanel(box, "above");
  const wrap = h("div", { class: `pln-wkw${stacked ? " is-narrow" : ""}` }, box);
  const poolEl = h("div", { class: "pln-pool" }, wrap);
  const next = pool();
  h("h5", {}, poolEl, `Next steps (${next.length})`);
  if (!next.length) h("div", { class: "pln-sub" }, poolEl, "No unplanned next steps.");
  for (const r of next) poolItem(poolEl, r);

  const strip = narrow ? h("div", { class: "pln-cal-strip" }, wrap) : wrap;
  const cal = h("div", { class: `pln-cal${narrow ? " is-strip" : ""}`, style: `--n:${n}` }, strip);
  const head = h("div", { class: "pln-cal-row" }, cal); h("div", {}, head);
  const lanes = h("div", { class: "pln-cal-row" }, cal); h("div", { class: "pln-cal-gut", title: "Planned for the day, no time yet" }, lanes, "no time");
  for (const day of days) {
    const cap = capMin(day);
    const open = tasksOn(day).filter(r => !meta(r.raw).done);
    const L = dayLoad(day), planned = withBuffer(L.all);
    const dh = h("div", { class: `pln-cal-dh${day === TODAY ? " is-today" : ""}${day < TODAY ? " is-past" : ""}`, title: "Open this day in the day view" }, head);
    h("div", {}, dh, day === TODAY ? `Today ${short(day).split(" ")[1]}` : short(day));
    const capEl = h("div", { class: `pln-cap${planned > cap ? (day > TODAY ? " is-full" : " is-over") : planned > cap * 0.85 ? " is-full" : ""}`, title: "Planned time with buffer, against your hours per day" }, dh);
    h("div", { style: `width:${cap ? Math.min(100, (100 * planned) / cap) : 0}%` }, capEl);
    h("div", { class: "pln-sub" }, dh, loadText(L, cap));
    dh.addEventListener("click", () => { tlDay = day; state.tlMode = "day"; save(); render(); });
    const lane = h("div", { class: "pln-day pln-lane", "data-day": day }, lanes);
    birthdayMarks(lane, day);
    for (const r of untimedOn(day)) poolItem(lane, r, { day });
    for (const r of ALL.filter(r => { const m = meta(r.raw); return m.due === day && !m.done && !onDate(m, day); })) {
      const dl = h("div", { class: "pln-due", title: "Deadline on this day (not planned for it)" }, lane, `⚑ ${label(r.raw)}`);
      dl.addEventListener("click", () => openAt(r));
    }
    projectDueMarks(lane, day, true);
  }
  const gs = h("div", { class: "pln-gs pln-cal-body" }, cal);
  const cols = h("div", { class: "pln-cal-row" }, gs);
  const { g0, g1 } = hourRange(days.flatMap(timedOn));
  const hours = h("div", { class: "pln-cal-hours", style: `height:${(g1 - g0) * PXM}px` }, cols);
  for (let t = g0; t < g1; t += 60) h("span", { style: `top:${(t - g0) * PXM}px` }, hours, clock(t));
  const firstBlock = [];
  for (const day of days) firstBlock.push(...hourGrid(cols, day, g0, g1, timedOn(day), { labels: false }).map(b => b.s));
  const nowMin = NOW.getHours() * 60 + NOW.getMinutes();
  const focus = days.includes(TODAY) ? nowMin - 60 : (firstBlock.length ? Math.min(...firstBlock) : g0) - 30;
  const key = `week:${first}`;
  requestAnimationFrame(() => {
    if (!narrow) { gs.scrollTop = UI.gridScroll[key] ?? Math.max(0, (focus - g0) * PXM); return; }
    // the strip scrolls both ways: it opens at the day you were on (today in this week) and the hour of your first block,
    // or where you left it
    const at = days.indexOf(days.includes(tlDay) ? tlDay : TODAY), colW = (cal.scrollWidth - 38) / n, saved = UI.stripScroll?.[key];
    strip.scrollLeft = saved?.x ?? Math.max(0, at) * colW;
    strip.scrollTop = saved?.y ?? Math.max(0, gs.offsetTop - head.offsetHeight + (focus - g0) * PXM);
  });
  if (narrow) strip.addEventListener("scroll", () => { (UI.stripScroll ??= {})[key] = { x: strip.scrollLeft, y: strip.scrollTop }; }, { passive: true });
  gs.addEventListener("scroll", () => { UI.gridScroll[key] = gs.scrollTop; });
  selPanel(box, "below");
}

function item(parent, r, { day, showSched } = {}) {
  const m = meta(r.raw);
  const row = h("div", { class: `pln-item${m.done ? " is-done" : ""}` }, parent);
  const cb = h("input", { type: "checkbox", class: "task-list-item-checkbox" }, row);
  cb.checked = m.done;
  cb.addEventListener("click", e => { e.preventDefault(); toggle(r); });
  const body = h("div", { class: "pln-text" }, row);
  const tx = h("div", {}, body, label(r.raw));
  tx.addEventListener("click", () => openAt(r));
  const cs = h("div", {}, body); chips(cs, r, m, { showSched });
  menuOn(row, r);
  if (m.done) return;
  const acts = h("span", { class: "pln-acts" }, row);
  if (!m.event) h("span", { title: "Edit task: dates, priority, length, price… (or right-click the task)" }, acts, "✎").addEventListener("click", () => edit(r));
  if (m.recur) return; // the Tasks plugin owns a repeating task's dates
  if (!m.spread && m.sched && spanDays(m.est) > 1) h("span", { title: `Longer than your ${state.capacity} hours a day: spread it over ${spanDays(m.est)} days from ${dayLabel(m.sched)}` }, acts, "⇉").addEventListener("click", () => schedule(r, m.sched));
  h("span", { title: m.spread ? "All its days one day earlier" : "Day earlier" }, acts, "‹").addEventListener("click", () => shift(r, -1));
  h("span", { title: m.spread ? "All its days one day later" : "Day later" }, acts, "›").addEventListener("click", () => shift(r, 1));
  h("span", { title: "Take off the plan" }, acts, "✕").addEventListener("click", () => schedule(r, null));
}

render();
