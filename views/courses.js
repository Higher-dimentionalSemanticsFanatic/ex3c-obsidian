// Courses widget for the Study tab. Usage: await dv.view("Meta/views/courses")
// One row per course note (kind: course, status not done): exam countdown, next deadline, progress, this week's
// planned study time against hours-per-week, lectures without recall questions, open Unclear items.
// Below: every study deadline in the next four weeks. Sample courses (tagged example) are left out.
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const asDate = s => new Date(`${s}T12:00:00`);
const addDays = (s, n) => { const d = asDate(s); d.setDate(d.getDate() + n); return iso(d); };
const days = (a, b) => Math.round((asDate(b) - asDate(a)) / 86400000);
const TODAY = iso(new Date());
const MONDAY = addDays(TODAY, -((asDate(TODAY).getDay() + 6) % 7)), SUNDAY = addDays(MONDAY, 6);
const dmy = s => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : "");
const str = v => (v == null ? "" : typeof v === "object" && v.toFormat ? v.toFormat("yyyy-MM-dd") : String(v)).slice(0, 10);
const parseEst = s => { const v = String(s ?? "").trim().toLowerCase().replace(",", "."); if (/^\d+(\.\d+)?$/.test(v)) return parseFloat(v); let m = 0, hit = false; for (const x of v.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)(?![a-z])/g)) { hit = true; m += parseFloat(x[1]) * (x[2].startsWith("h") ? 60 : 1); } return hit ? m : null; };
const fmt = m => { const h = Math.floor(m / 60), r = Math.round(m % 60); return [h ? `${h}h` : "", r ? `${r}m` : ""].filter(Boolean).join(" ") || "0h"; };
const label = t => t.text.replace(/\[[\w-]+::[^\]]*\]/g, "").replace(/\s*(📅|⏳|🛫|➕|✅) \d{4}-\d{2}-\d{2}/gu, "").replace(/\[\[(?:\d{4}-\d{2}-\d{2} )?([^\]|]+)(\|[^\]]+)?\]\]/g, "$1").replace(/[🔺⏫🔼🔽⏬]/gu, "").replace(/\s+/g, " ").trim();
const due = t => t.text.match(/📅 (\d{4}-\d{2}-\d{2})/u)?.[1] ?? null;
const sched = t => t.text.match(/⏳ (\d{4}-\d{2}-\d{2})/u)?.[1] ?? null;
const open = p => app.workspace.openLinkText(p, "", false);

const all = dv.pages().where(p => p.kind === "course" && !/(^|\/)(templates|\.trash)\//i.test(p.file.path) && !/^(done|archived)$/i.test(String(p.status ?? ""))).array();
const real = all.filter(p => !(p.file.tags ?? []).includes("#example"));
const courses = real.sort((a, b) => (str(a.exam) || "9999").localeCompare(str(b.exam) || "9999"));
const root = dv.container.createEl("div", { cls: "crsw" });
const newBtn = root.createEl("button", { text: "+ New course", attr: { title: "QuickAdd New course: a course note in 10 Areas/Study/<name>/ from Templates/Course.md" } });
newBtn.addEventListener("click", () => app.commands.executeCommandById("quickadd:choice:lifeos-new-course"));
root.createEl("style", { text: `
.crsw { font-size: 13px; }
.crsw-row { border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 8px 10px; margin: 6px 0; background: var(--background-primary); cursor: pointer; }
.crsw-row:hover { border-color: var(--interactive-accent); }
.crsw-top { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }
.crsw-name { font-weight: 600; font-size: 14px; }
.crsw-sub { color: var(--text-muted); font-size: 12px; }
.crsw-warn { color: var(--color-orange); font-size: 12px; }
.crsw-bar { height: 5px; border-radius: 3px; background: var(--background-modifier-border); margin: 5px 0 3px; overflow: hidden; }
.crsw-bar > div { height: 5px; background: var(--interactive-accent); }
.crsw table { width: 100%; border-collapse: collapse; font-size: 12px; }
.crsw td { padding: 3px 6px; border-top: 1px solid var(--background-modifier-border); }
.crsw .is-soon { color: var(--color-orange); }
.crsw .is-late { color: var(--color-red); }
` });
if (!courses.length) { root.createEl("p", { text: "No courses yet. Press + New course to make one; how it works: Guide, 25 Workflow - Study.", cls: "crsw-sub" }); return; }

const upcoming = [];
for (const c of courses) {
  const lectures = dv.pages().where(p => p.course?.path === c.file.path && (p.file.tags ?? []).includes("#lecture")).array();
  const tasks = [...c.file.tasks.array(), ...lectures.flatMap(l => l.file.tasks.array())].filter(t => t.text.trim());
  const done = tasks.filter(t => t.completed).length;
  const next = tasks.filter(t => !t.completed && due(t)).sort((a, b) => due(a).localeCompare(due(b)))[0];
  const week = tasks.filter(t => !t.completed && sched(t) && sched(t) >= MONDAY && sched(t) <= SUNDAY).reduce((s, t) => s + (parseEst(t.est ?? t.text.match(/\[est::\s*([^\]]+)\]/)?.[1]) ?? 15), 0);
  const unclear = lectures.flatMap(l => l.file.tasks.array()).filter(t => !t.completed && t.section?.subpath === "Unclear" && t.text.trim()).length;
  let noRecall = 0;
  for (const l of lectures.filter(l => str(l.date) >= addDays(TODAY, -7))) {
    const text = await app.vault.cachedRead(app.vault.getAbstractFileByPath(l.file.path));
    const i = text.indexOf("## Recall questions"), rest = i < 0 ? "" : text.slice(i).split(/\n## /)[0];
    if (!/\S::\S/.test(rest.split("\n").slice(1).join("\n"))) noRecall++;
  }
  for (const t of tasks) if (!t.completed && due(t) && due(t) <= addDays(TODAY, 28)) upcoming.push({ t, c });
  const exam = str(c.exam);
  if (exam && exam >= TODAY && exam <= addDays(TODAY, 28)) upcoming.push({ exam, c });

  const row = root.createEl("div", { cls: "crsw-row" });
  row.addEventListener("click", () => open(c.file.path));
  const top = row.createEl("div", { cls: "crsw-top" });
  top.createEl("span", { cls: "crsw-name", text: c.course ?? c.file.name });
  if (exam) { const d = days(TODAY, exam); top.createEl("span", { cls: d <= 21 ? "is-soon" : "crsw-sub", text: d >= 0 ? `exam ${dmy(exam)}, ${d} day${d === 1 ? "" : "s"}` : `exam was ${dmy(exam)}` }); }
  top.createEl("span", { cls: "crsw-sub", text: `term ${dmy(str(c["term-start"]))} to ${dmy(str(c["term-end"]))}` });
  const bar = row.createEl("div", { cls: "crsw-bar" }); bar.createEl("div", { attr: { style: `width:${tasks.length ? Math.round(100 * done / tasks.length) : 0}%` } });
  const nd = next ? days(TODAY, due(next)) : null;
  row.createEl("div", { cls: "crsw-sub", text: `${done} of ${tasks.length} steps done${next ? ` · next: ${label(next)}, ${dmy(due(next))} (${nd < 0 ? `${-nd} days late` : nd === 0 ? "today" : `${nd} day${nd === 1 ? "" : "s"}`})` : ""}` });
  const target = Number(c["hours-per-week"]) || 0;
  row.createEl("div", { cls: "crsw-sub", text: `this week planned: ${fmt(week)}${target ? ` of ${target}h` : ""}` });
  if (noRecall) row.createEl("div", { cls: "crsw-warn", text: `${noRecall} lecture${noRecall === 1 ? "" : "s"} from the last week without recall questions` });
  if (unclear) row.createEl("div", { cls: "crsw-warn", text: `${unclear} unclear item${unclear === 1 ? "" : "s"} to ask` });
}

root.createEl("h4", { text: "Coming up, next four weeks", attr: { style: "margin:12px 0 4px" } });
if (!upcoming.length) root.createEl("div", { cls: "crsw-sub", text: "No study deadlines in the next four weeks." });
const table = root.createEl("table");
for (const u of upcoming.sort((a, b) => (a.exam ?? due(a.t)).localeCompare(b.exam ?? due(b.t)))) {
  const d = u.exam ?? due(u.t), n = days(TODAY, d);
  const tr = table.createEl("tr");
  tr.createEl("td", { text: dmy(d), cls: n < 0 ? "is-late" : n <= 3 ? "is-soon" : "" });
  const td = tr.createEl("td"); const a = td.createEl("a", { cls: "internal-link", text: u.exam ? "Exam" : label(u.t) });
  a.addEventListener("click", () => (u.t ? app.workspace.openLinkText(u.t.path, "", false, { eState: { line: u.t.line } }) : open(u.c.file.path)));
  tr.createEl("td", { cls: "crsw-sub", text: u.c.course ?? u.c.file.name });
}
