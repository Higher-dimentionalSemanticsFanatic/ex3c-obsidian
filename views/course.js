// One course. Usage, in a course note: await dv.view("Meta/views/course")
// Shows the term, the exam countdown and every lecture note of this course (notes whose course property links here)
// with its recall questions and open Unclear items. Two buttons:
// - New lecture note: makes "<date> <topic>.md" next to the course from the lecture template and lists it under Lectures.
// - Plan backwards from the exam: two review steps per lecture, spread over the weeks before the exam (answer the
//   recall questions first, then reread), written under ## Exam prep after you confirm. Undo puts it back.
let page = input?.path ? dv.page(input.path) : dv.current();
const obs = (() => { try { return require("obsidian"); } catch (e) { return {}; } })();
const notify = msg => (obs.Notice ? new obs.Notice(msg) : console.warn(msg));
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const asDate = s => new Date(`${s}T12:00:00`);
const addDays = (s, n) => { const d = asDate(s); d.setDate(d.getDate() + n); return iso(d); };
const days = (a, b) => Math.round((asDate(b) - asDate(a)) / 86400000);
const TODAY = iso(new Date());
const dmy = s => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : "not set");
const str = v => (v == null ? "" : typeof v === "object" && v.toFormat ? v.toFormat("yyyy-MM-dd") : String(v)).slice(0, 10);
const TEMPLATE = "Templates/Lecture.md";
const UNDO_KEY = "compass-proto-planner-undo"; // shared with the planner, so its Undo bar covers this too

function h(tag, attrs = {}, parent, text) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "class") el.className = v; else if (k === "style") el.style.cssText = v; else el.setAttribute(k, v); }
  if (text !== undefined) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}
// The same confirm overlay as the planner: count, list, Yes or Cancel.
function confirmBox(title, lines, yesText = "Yes, add them") {
  return new Promise(resolve => {
    const back = h("div", { style: "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px" }, document.body);
    const card = h("div", { style: "background:var(--background-primary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:10px;max-width:560px;width:100%;padding:14px 16px;box-shadow:var(--shadow-l)" }, back);
    h("div", { style: "font-weight:600;font-size:15px;margin-bottom:6px" }, card, `${title}?`);
    const ul = h("ul", { style: "max-height:45vh;overflow:auto;font-size:13px;margin:4px 0;padding-left:18px" }, card);
    for (const l of lines) h("li", {}, ul, l);
    h("div", { style: "color:var(--text-muted);font-size:12px;margin:6px 0 10px" }, card, "You can undo this afterwards with Undo here or at the top of the planner.");
    const row = h("div", { style: "display:flex;gap:8px;justify-content:flex-end" }, card);
    const no = h("button", {}, row, "Cancel"), yes = h("button", { class: "mod-cta" }, row, yesText);
    const done = v => { document.removeEventListener("keydown", key, true); back.remove(); resolve(v); };
    const key = e => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
    document.addEventListener("keydown", key, true);
    no.addEventListener("click", () => done(false)); yes.addEventListener("click", () => done(true));
    back.addEventListener("click", e => { if (e.target === back) done(false); });
    yes.focus();
  });
}
function askText(title, placeholder) {
  return new Promise(resolve => {
    const back = h("div", { style: "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px" }, document.body);
    const card = h("div", { style: "background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:10px;max-width:440px;width:100%;padding:14px 16px" }, back);
    h("div", { style: "font-weight:600;margin-bottom:8px" }, card, title);
    const inp = h("input", { type: "text", placeholder, style: "width:100%;margin-bottom:10px" }, card);
    const row = h("div", { style: "display:flex;gap:8px;justify-content:flex-end" }, card);
    const no = h("button", {}, row, "Cancel"), yes = h("button", { class: "mod-cta" }, row, "Create");
    const done = v => { back.remove(); resolve(v); };
    no.addEventListener("click", () => done(null));
    yes.addEventListener("click", () => done(inp.value.trim() || null));
    inp.addEventListener("keydown", e => { if (e.key === "Enter") done(inp.value.trim() || null); if (e.key === "Escape") done(null); });
    back.addEventListener("click", e => { if (e.target === back) done(null); });
    setTimeout(() => inp.focus(), 0);
  });
}
// Lines of a "## Heading" section of a note's text.
const section = (text, name) => { const L = text.split("\n"); const i = L.findIndex(l => l.trim() === `## ${name}`); if (i < 0) return []; const out = []; for (let j = i + 1; j < L.length && !/^#{1,2}\s/.test(L[j]); j++) out.push(L[j]); return out; };
const recallCount = text => section(text, "Recall questions").filter(l => /\S::\S/.test(l) && !/^\s*[-*] \[/.test(l)).length;
async function appendUnder(path, heading, lines) {
  const f = app.vault.getAbstractFileByPath(path);
  await app.vault.process(f, data => {
    const L = data.split("\n");
    let i = L.findIndex(l => l.trim() === heading);
    if (i < 0) { L.push("", heading); i = L.length - 1; }
    let end = i + 1; while (end < L.length && !/^#{1,2}\s/.test(L[end])) end++;
    let at = end; while (at > i + 1 && L[at - 1].trim() === "") at--;
    L.splice(at, 0, ...lines);
    return L.join("\n");
  });
}
function saveUndo(title, path, lines) {
  try { localStorage.setItem(UNDO_KEY, JSON.stringify({ title, at: Date.now(), items: lines.map(l => ({ path, before: null, after: l })) })); } catch (e) {}
}
async function undoLast() {
  let u = null; try { u = JSON.parse(localStorage.getItem(UNDO_KEY) || "null"); } catch (e) {}
  if (!u?.items?.length) return;
  let back = 0;
  for (const [path, its] of Object.entries(u.items.reduce((m, it) => ((m[it.path] ??= []).push(it), m), {}))) {
    const f = app.vault.getAbstractFileByPath(path); if (!f) continue;
    await app.vault.process(f, data => { const L = data.split("\n"); for (const it of its) { const i = L.indexOf(it.after); if (i < 0) continue; if (it.before === null) L.splice(i, 1); else L[i] = it.before; back++; } return L.join("\n"); });
  }
  try { localStorage.removeItem(UNDO_KEY); } catch (e) {}
  notify(`Undone: ${back} line${back === 1 ? "" : "s"} put back.`);
}

const root = h("div", { class: "crs" }, dv.container);
h("style", {}, root, `
.crs { font-size: 13px; }
.crs-head { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline; margin-bottom: 6px; }
.crs-chip { font-size: 11px; padding: 1px 8px; border-radius: 9px; border: 1px solid var(--background-modifier-border); }
.crs-chip.is-soon { color: var(--color-orange); border-color: var(--color-orange); }
.crs table { width: 100%; border-collapse: collapse; font-size: 12px; }
.crs td, .crs th { padding: 3px 6px; border-top: 1px solid var(--background-modifier-border); text-align: left; }
.crs .is-missing { color: var(--color-red); }
.crs-bar { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
.crs-sub { color: var(--text-muted); font-size: 11px; }
`);

async function render() {
  root.querySelectorAll(":scope > :not(style)").forEach(e => e.remove());
  if (!page) { h("p", {}, root, "Open this in a course note."); return; }
  page = dv.page(page.file.path) ?? page; // fresh index data after our own writes
  const exam = str(page.exam), ts = str(page["term-start"]), te = str(page["term-end"]);
  const head = h("div", { class: "crs-head" }, root);
  h("span", {}, head, `Term ${dmy(ts)} to ${dmy(te)}`);
  if (exam) { const d = days(TODAY, exam); h("span", { class: `crs-chip${d <= 21 ? " is-soon" : ""}` }, head, d >= 0 ? `Exam ${dmy(exam)}, in ${d} day${d === 1 ? "" : "s"}` : `Exam was ${dmy(exam)}`); }
  else h("span", { class: "crs-chip" }, head, "No exam date yet (set exam: YYYY-MM-DD)");
  if (page["hours-per-week"]) h("span", { class: "crs-sub" }, head, `${page["hours-per-week"]}h a week`);

  const lectures = dv.pages().where(p => p.course?.path === page.file.path && (p.file.tags ?? []).includes("#lecture")).sort(p => `${str(p.date) || "9999"} ${String(p.lecture ?? "").padStart(3, "0")} ${p.file.name}`).array();
  const prep = (page.file.tasks ?? []).where(t => t.section?.subpath === "Exam prep").array();
  const table = h("table", {}, root);
  const hr = h("tr", {}, table); for (const t of ["Date", "Lecture", "Recall questions", "Unclear", "Review steps"]) h("th", {}, hr, t);
  const info = [];
  for (const p of lectures) {
    const text = await app.vault.cachedRead(app.vault.getAbstractFileByPath(p.file.path));
    const q = recallCount(text);
    const unclear = p.file.tasks.where(t => !t.completed && t.section?.subpath === "Unclear" && t.text.trim()).length;
    const planned = prep.filter(t => t.text.includes(`[[${p.file.name}]]`) || t.outlinks?.some?.(l => l.path === p.file.path)).length;
    info.push({ p, q, planned });
    const tr = h("tr", {}, table);
    h("td", {}, tr, dmy(str(p.date)));
    const a = h("a", { class: "internal-link" }, h("td", {}, tr), p.file.name.replace(/^\d{4}-\d{2}-\d{2}\s*/, ""));
    a.addEventListener("click", () => app.workspace.openLinkText(p.file.path, "", false));
    h("td", { class: q ? "" : "is-missing" }, tr, q ? String(q) : "none yet");
    h("td", {}, tr, unclear ? `${unclear} open` : "");
    h("td", {}, tr, planned ? `${planned} planned` : "");
  }
  if (!lectures.length) h("p", { class: "crs-sub" }, root, "No lecture notes yet. Use New lecture note.");

  const bar = h("div", { class: "crs-bar" }, root);
  const nl = h("button", {}, bar, "New lecture note");
  nl.addEventListener("click", newLecture);
  const pb = h("button", { class: "mod-cta" }, bar, "Plan backwards from the exam");
  pb.addEventListener("click", () => planBackwards(info, exam));
  let u = null; try { u = JSON.parse(localStorage.getItem(UNDO_KEY) || "null"); } catch (e) {}
  if (u?.items?.some(it => it.path === page.file.path)) {
    const ub = h("button", { class: "mod-warning" }, bar, `Undo: ${u.title}`);
    ub.addEventListener("click", async () => { ub.disabled = true; await undoLast(); setTimeout(render, 400); });
  }
  h("div", { class: "crs-sub" }, root, "Review steps: answer the lecture's recall questions from memory first, then reread what you missed.");
}

async function newLecture() {
  const topic = await askText("New lecture note: topic", "e.g. Eigenvalues");
  if (!topic) return;
  const folder = page.file.folder, name = `${TODAY} ${topic.replace(/[\\/:*?"<>|#^[\]]/g, "")}`;
  const path = `${folder}/${name}.md`;
  if (app.vault.getAbstractFileByPath(path)) { notify("That lecture note already exists."); return; }
  const tpl = app.vault.getAbstractFileByPath(TEMPLATE);
  const templater = app.plugins.plugins["templater-obsidian"]?.templater;
  let file;
  if (tpl && templater?.create_new_note_from_template) file = await templater.create_new_note_from_template(tpl, app.vault.getAbstractFileByPath(folder), name, false);
  else file = await app.vault.create(path, tpl ? await app.vault.read(tpl) : "");
  const n = dv.pages().where(p => p.course?.path === page.file.path && (p.file.tags ?? []).includes("#lecture")).length + 1;
  await app.fileManager.processFrontMatter(file, fm => { fm.course = `[[${page.file.name}]]`; fm.lecture = n; fm.area = "study"; });
  await appendUnder(page.file.path, "## Lectures", [`- [ ] Recall questions for [[${file.basename}]] [est:: 15m] 📅 ${addDays(TODAY, 1)}`]);
  await app.workspace.getLeaf(false).openFile(file);
}

async function planBackwards(info, exam) {
  if (!exam) { notify("Set the course's exam date first (exam: YYYY-MM-DD in the properties)."); return; }
  const start = addDays(TODAY, 1), end = addDays(exam, -3);
  const span = days(start, end);
  if (span < 4) { notify("The exam is too close to spread reviews out. Plan the last days by hand in the planner."); return; }
  const todo = info.filter(x => !x.planned);
  if (!todo.length) { notify(info.length ? "Every lecture already has review steps." : "No lecture notes yet."); return; }
  // first review in the first 70% of the time left, a second, shorter one in the last 30%, both spread evenly
  const cut = Math.floor(span * 0.7);
  const at = (i, n, from, len) => addDays(start, from + Math.floor((i + 0.5) * len / n));
  const lines = [];
  todo.forEach((x, i) => {
    const q = x.q ? `answer its ${x.q} recall question${x.q === 1 ? "" : "s"} first, then reread what you missed` : "write its recall questions first, then answer them";
    lines.push(`- [ ] Review [[${x.p.file.name}]]: ${q} [est:: 30m] ⏳ ${at(i, todo.length, 0, cut)}`);
  });
  todo.forEach((x, i) => lines.push(`- [ ] Review again [[${x.p.file.name}]]: recall questions only [est:: 15m] ⏳ ${at(i, todo.length, cut + 1, span - cut - 1)}`));
  const pretty = l => l.replace(/^- \[ \] /, "").replace(/\[\[(?:\d{4}-\d{2}-\d{2} )?([^\]]+)\]\]/, "$1").replace(/ \[est:: ([^\]]+)\]/, " ($1)").replace(/⏳ (\d{4})-(\d{2})-(\d{2})/, "on $3-$2-$1");
  const title = `Add ${lines.length} review steps to ${page.file.name}, between ${dmy(start)} and ${dmy(end)}`;
  if (!(await confirmBox(title, lines.map(pretty)))) return;
  await appendUnder(page.file.path, "## Exam prep", lines);
  saveUndo(`${lines.length} review steps in ${page.file.name}`, page.file.path, lines);
  notify(`Added ${lines.length} review steps under Exam prep. Undo is here and at the top of the planner.`);
  setTimeout(render, 600);
}

await render();
