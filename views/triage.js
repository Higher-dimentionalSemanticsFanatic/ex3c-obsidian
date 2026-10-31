// Inbox triage. Usage: await dv.view("Meta/views/triage")
// 08 Tasks/Tasks.md has three lists: ## Inbox (just captured), ## Soon (plan within a month of capture),
// ## Eventually (no time frame). Each inbox task without a date gets three buttons:
//   Today      writes ⏳ today and stays where it is (the planner and today's note show it)
//   Soon       moves it under ## Soon with 🔼 medium (unless it has a priority): the planner counts down to a month after ➕
// Soon lines (## Soon, or #soon anywhere) written before Soon meant 🔼 get it once, from a list you confirm, with undo.
//   Eventually moves it under ## Eventually: the planner leaves it out until you move it back
const PATH = "08 Tasks/Tasks.md";
const obs = (() => { try { return require("obsidian"); } catch (e) { return {}; } })();
const notify = m => (obs.Notice ? new obs.Notice(m, 8000) : console.warn(m));
const pad = n => String(n).padStart(2, "0");
const d = new Date(), TODAY = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TASK_RE = /^[-*+] \[ \] (.*)$/;
const dated = l => /[⏳📅]\s*\d{4}-\d{2}-\d{2}/u.test(l);
const clean = l => l.replace(TASK_RE, "$1").replace(/\s*➕ \d{4}-\d{2}-\d{2}/u, "").replace(/\[[\w-]+::[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
const file = app.vault.getAbstractFileByPath(PATH);
const root = dv.container.createEl("div", { cls: "trg" });
root.createEl("style", { text: `.trg { font-size: 13px; } .trg h4 { margin: 0 0 4px; } .trg-sub { color: var(--text-muted); font-size: 12px; margin: 4px 0 0; }
.trg-row { display: flex; gap: 6px; align-items: center; padding: 4px 0; border-top: 1px solid var(--background-modifier-border); flex-wrap: wrap; }
.trg-row .t { flex: 1 1 200px; min-width: 0; cursor: pointer; } .trg button { font-size: 12px; padding: 1px 9px; height: auto; }` });
if (!file) { root.createEl("p", { cls: "trg-sub", text: `${PATH} not found.` }); return; }
const L = (await app.vault.read(file)).split("\n");
const section = name => { const s = L.findIndex(l => new RegExp(`^##\\s+${name}\\s*$`, "i").test(l)); if (s < 0) return []; let e = L.findIndex((l, i) => i > s && /^#{1,6}\s/.test(l)); if (e < 0) e = L.length; return L.slice(s + 1, e).map((l, k) => ({ l, i: s + 1 + k })).filter(x => TASK_RE.test(x.l)); };
const waiting = section("Inbox").filter(x => !dated(x.l));
const soon = section("Soon").length, later = section("Eventually").length;
async function change(line, fn) { await app.vault.process(file, data => { const A = data.split("\n"), i = A.indexOf(line); return i < 0 ? data : fn(A, i).join("\n"); }); }
const addDate = l => { const out = l.replace(/\s*⏳ \d{4}-\d{2}-\d{2}/u, ""); const m = out.match(/\s(?:[🔺⏫🔼🔽⏬🔁➕🛫📅✅❌🆔⛔]|\^[\w-]+\s*$)/u); return m ? `${out.slice(0, m.index)} ⏳ ${TODAY}${out.slice(m.index)}` : `${out.trimEnd()} ⏳ ${TODAY}`; };
// 🔼 medium unless the line already has a priority, before its date fields like the Tasks plugin writes it
const PRI_RE = /[🔺⏫🔼🔽⏬]/u;
const addMedium = l => { if (PRI_RE.test(l)) return l; const m = l.match(/\s(?:[🔁➕🛫⏳📅✅❌🆔⛔]|\^[\w-]+\s*$)/u); return m ? `${l.slice(0, m.index)} 🔼${l.slice(m.index)}` : `${l.trimEnd()} 🔼`; };
// moves a line to the end of a ## section (made if missing, after Inbox), dropping an empty "- " placeholder there
function moveTo(A, i, heading) {
  const [line] = A.splice(i, 1);
  let s = A.findIndex(l => new RegExp(`^##\\s+${heading}\\s*$`, "i").test(l));
  if (s < 0) { const inb = A.findIndex(l => /^##\s+Inbox\s*$/i.test(l)); let e = A.findIndex((l, k) => k > inb && /^#{1,6}\s/.test(l)); if (e < 0) e = A.length; A.splice(e, 0, `## ${heading}`, ""); s = e; }
  let e = A.findIndex((l, k) => k > s && /^#{1,6}\s/.test(l)); if (e < 0) e = A.length;
  for (let k = s + 1; k < e; k++) if (/^\s*-\s*$/.test(A[k])) { A.splice(k, 1); e--; break; }
  let at = e; while (at > s + 1 && A[at - 1].trim() === "") at--;
  A.splice(at, 0, line);
  if (at + 1 < A.length && /^#{1,6}\s/.test(A[at + 1])) A.splice(at + 1, 0, "");
  return A;
}
root.createEl("h4", { text: waiting.length ? `Inbox (${waiting.length})` : "Inbox: nothing to sort" });
for (const x of waiting) {
  const row = root.createEl("div", { cls: "trg-row" });
  const t = row.createEl("span", { cls: "t", text: clean(x.l) });
  t.addEventListener("click", () => app.workspace.openLinkText(PATH, "", false, { eState: { line: x.i } }));
  row.createEl("button", { text: "Today", cls: "mod-cta", attr: { title: "Plan it for today (⏳)" } }).addEventListener("click", () => change(x.l, (A, i) => { A[i] = addDate(A[i]); return A; }));
  row.createEl("button", { text: "Soon", attr: { title: "Move it to ## Soon with 🔼 medium: plan it within a month" } }).addEventListener("click", () => change(x.l, (A, i) => { A[i] = addMedium(A[i]); return moveTo(A, i, "Soon"); }));
  row.createEl("button", { text: "Eventually", attr: { title: "Move it to ## Eventually: no time frame, out of the planner" } }).addEventListener("click", () => change(x.l, (A, i) => moveTo(A, i, "Eventually")));
}
// once: Soon lines without a priority get 🔼, after you have seen the list; Undo puts them back as they were
const STORE = app.plugins.plugins["ex3c-agenda"] ?? {}, UNDO = STORE.__soonUndo;
const oldSoon = [...section("Soon").filter(x => TASK_RE.test(x.l.trim()) && !PRI_RE.test(x.l)).map(x => ({ path: PATH, line: x.l })),
  ...dv.pages().file.tasks.where(t => !t.completed && /(^|\s)#soon\b/i.test(t.text) && !PRI_RE.test(t.text) && t.path !== PATH).array().map(t => ({ path: t.path, text: t.text }))];
async function rewrite(items, fn) {
  const done = [];
  for (const [path, list] of Object.entries(Object.groupBy ? Object.groupBy(items, x => x.path) : items.reduce((g, x) => ((g[x.path] ??= []).push(x), g), {}))) {
    const f = app.vault.getAbstractFileByPath(path); if (!f) continue;
    await app.vault.process(f, data => { const A = data.split("\n"); for (const x of list) { const i = A.findIndex(l => (x.line ? l === x.line : /^\s*[-*+] \[ \] /.test(l) && l.includes(x.text))); if (i < 0) continue; const after = fn(A[i]); if (after !== A[i]) { done.push({ path, before: A[i], after }); A[i] = after; } } return A.join("\n"); });
  }
  return done;
}
if (oldSoon.length) {
  const box = root.createEl("div", { cls: "trg-sub", attr: { style: "margin-top:8px" } });
  box.createEl("div", { text: `${oldSoon.length} Soon task${oldSoon.length === 1 ? " has" : "s have"} no priority. Soon now means 🔼 medium; give ${oldSoon.length === 1 ? "it" : "them"} 🔼 once?` });
  const ul = box.createEl("ul", { attr: { style: "margin:4px 0" } });
  for (const x of oldSoon.slice(0, 20)) ul.createEl("li", { text: `${clean(x.line ?? `- [ ] ${x.text}`)}${x.path === PATH ? "" : `  (${x.path.split("/").pop().replace(/\.md$/, "")})`}` });
  if (oldSoon.length > 20) ul.createEl("li", { text: `and ${oldSoon.length - 20} more` });
  box.createEl("button", { text: `Give ${oldSoon.length === 1 ? "it" : `all ${oldSoon.length}`} 🔼 medium` }).addEventListener("click", async () => {
    const done = await rewrite(oldSoon, addMedium);
    STORE.__soonUndo = done;
    notify(`${done.length} Soon task${done.length === 1 ? "" : "s"} now 🔼 medium. Undo is under the inbox until you restart Obsidian.`);
  });
} else if (UNDO?.length) {
  const box = root.createEl("div", { cls: "trg-sub", attr: { style: "margin-top:8px" } });
  box.createEl("span", { text: `${UNDO.length} Soon task${UNDO.length === 1 ? "" : "s"} got 🔼 medium. ` });
  box.createEl("button", { text: "Undo" }).addEventListener("click", async () => {
    let n = 0;
    for (const u of UNDO) { const f = app.vault.getAbstractFileByPath(u.path); if (!f) continue; await app.vault.process(f, data => { const A = data.split("\n"), i = A.indexOf(u.after); if (i < 0) return data; A[i] = u.before; n++; return A.join("\n"); }); }
    STORE.__soonUndo = null;
    notify(`Undone: ${n} of ${UNDO.length} back as they were${n < UNDO.length ? " (the others were edited since)" : ""}.`);
  });
}
const sub = root.createEl("p", { cls: "trg-sub", text: `Soon ${soon} · Eventually ${later} · ` });
sub.createEl("a", { text: "open the Tasks note", attr: { style: "cursor:pointer" } }).addEventListener("click", () => app.workspace.openLinkText(PATH, "", false));
