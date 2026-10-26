// Inbox triage. Usage: await dv.view("Meta/views/triage")
// 08 Tasks/Tasks.md has three lists: ## Inbox (just captured), ## Soon (plan within a month of capture),
// ## Eventually (no time frame). Each inbox task without a date gets three buttons:
//   Today      writes ⏳ today and stays where it is (the planner and today's note show it)
//   Soon       moves it under ## Soon: the planner offers it first among undated tasks and counts down to a month after ➕
//   Eventually moves it under ## Eventually: the planner leaves it out until you move it back
const PATH = "08 Tasks/Tasks.md";
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
  row.createEl("button", { text: "Soon", attr: { title: "Move it to ## Soon: plan it within a month" } }).addEventListener("click", () => change(x.l, (A, i) => moveTo(A, i, "Soon")));
  row.createEl("button", { text: "Eventually", attr: { title: "Move it to ## Eventually: no time frame, out of the planner" } }).addEventListener("click", () => change(x.l, (A, i) => moveTo(A, i, "Eventually")));
}
const sub = root.createEl("p", { cls: "trg-sub", text: `Soon ${soon} · Eventually ${later} · ` });
sub.createEl("a", { text: "open the Tasks note", attr: { style: "cursor:pointer" } }).addEventListener("click", () => app.workspace.openLinkText(PATH, "", false));
