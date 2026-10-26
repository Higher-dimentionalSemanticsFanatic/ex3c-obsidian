// The Ideal Week drawn as a week of blocks. Usage: await dv.view("Meta/views/idealweek")
// Reads the lines under "## Blocks" in 03 Planning/Ideal Week.md, one block per line:
//   - Mon-Fri 08:00 - 10:00 Deep work #tasks
// Days: Mon ... Sun, a range (Mon-Fri), a list (Mon,Wed,Fri), Daily, Weekdays or Weekend. #tasks marks time for
// tasks: while "Use this week in the planner" is on, the planner uses those hours as each weekday's capacity and
// shows the blocks behind its week view.
const PATH = input?.path ?? "03 Planning/Ideal Week.md";
const DAYN = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = n => String(n).padStart(2, "0");
const clock = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const fmt = m => { const h = Math.floor(m / 60), r = m % 60; return [h ? `${h}h` : "", r ? `${r}m` : ""].filter(Boolean).join(" ") || "0h"; };
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
const page = dv.page(PATH);
const blocks = [], bad = [];
for (const l of page?.file.lists.array() ?? []) {
  if (l.task || (l.section?.subpath && l.section.subpath !== "Blocks")) continue;
  const m = String(l.text).match(/^\s*([A-Za-z][A-Za-z, -]*?)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s+(.+)$/);
  if (!m) { if (String(l.text).trim()) bad.push(l.text); continue; }
  const days = daysOf(m[1]), s = +m[2] * 60 + +m[3], e = +m[4] * 60 + +m[5];
  if (!days.length || e <= s) { bad.push(l.text); continue; }
  blocks.push({ days, s, e, line: l.line, what: m[6].replace(/(^|\s)#(tasks|work)\b/gi, " ").trim(), tasks: /(^|\s)#tasks\b/i.test(m[6]), work: /(^|\s)#work\b/i.test(m[6]) });
}

const root = dv.container.createEl("div", { cls: "iw" });
root.createEl("style", { text: `
.iw { font-size: 12px; }
.iw-scroll { overflow-x: auto; }
.iw-grid { display: grid; grid-template-columns: 40px repeat(7, minmax(72px, 1fr)); min-width: 560px; }
.iw-head { font-weight: 600; padding: 2px 4px; border-left: 1px solid var(--background-modifier-border); }
.iw-head .iw-sub { font-weight: normal; color: var(--text-muted); font-size: 11px; }
.iw-col, .iw-hours { position: relative; }
.iw-col { border-left: 1px solid var(--background-modifier-border); }
.iw-hr { position: absolute; left: 0; right: 0; border-top: 1px dotted var(--background-modifier-border); }
.iw-hours span { position: absolute; right: 4px; transform: translateY(-6px); font-size: 10px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.iw-b { position: absolute; left: 2px; right: 2px; box-sizing: border-box; border-radius: 5px; padding: 1px 4px; overflow: hidden; line-height: 1.2; cursor: pointer;
  background: var(--background-secondary-alt); border: 1px solid var(--background-modifier-border); }
.iw-b.is-tasks { background: color-mix(in srgb, var(--interactive-accent) 22%, var(--background-primary)); border-color: var(--interactive-accent); }
.iw-b.is-work { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--text-faint) 22%, var(--background-primary)) 0 6px, var(--background-primary) 6px 12px); border-color: var(--text-muted); }
.iw-b.is-commute { background: transparent; border-style: dashed; color: var(--text-muted); font-size: 10px; }
.iw-b small { color: var(--text-muted); display: block; font-variant-numeric: tabular-nums; }
.iw-note { color: var(--text-muted); margin: 4px 0 8px; }
.iw-warn { color: var(--color-orange); margin: 4px 0 8px; }
` });

// work blocks get the commute (commute_minutes in this note) before and after them, drawn but not editable on their own
const COMMUTE = Number(page?.commute_minutes ?? 0) || 0;
if (COMMUTE) for (const b of blocks.filter(b => b.work)) blocks.push({ days: b.days, s: b.s - COMMUTE, e: b.s, line: b.line, what: "Commute", commute: true }, { days: b.days, s: b.e, e: b.e + COMMUTE, line: b.line, what: "Commute", commute: true });
const workMin = blocks.filter(b => b.work).reduce((t, b) => t + (b.e - b.s) * b.days.length, 0);
const taskMin = i => blocks.filter(b => b.tasks && b.days.includes(i)).reduce((t, b) => t + b.e - b.s, 0);
const week = DAYN.reduce((t, d, i) => t + taskMin(i), 0);
// the same switch as in the planner's settings (Meta/EX3C Agenda Config.md, planner_use_ideal_week)
const CFG = "Meta/EX3C Agenda Config.md";
const using = dv.page(CFG)?.planner_use_ideal_week === true;
const sw = root.createEl("label", { cls: "iw-note", attr: { style: "display:block" } });
const box = sw.createEl("input", { attr: { type: "checkbox" } });
box.checked = using;
sw.appendText(" Use this week in the planner");
box.addEventListener("change", async () => { const f = app.vault.getAbstractFileByPath(CFG); if (f) await app.fileManager.processFrontMatter(f, fm => { fm.planner_use_ideal_week = box.checked; }); });
if (page?.example === true) root.createEl("p", { cls: "iw-note", text: "These are example blocks: change the lines under Blocks to your own week, then delete the example property." });
if (!blocks.length) root.createEl("p", { cls: "iw-note", text: "No blocks yet. Add lines under ## Blocks, like: - Mon-Fri 09:00 - 12:00 Deep work #tasks" });
else root.createEl("p", { cls: "iw-note", text: `Time for tasks (#tasks): ${fmt(week)} a week.${workMin ? ` Work (#work): ${fmt(workMin)} a week${COMMUTE ? `, with ${fmt(COMMUTE)} commute each way` : ""}.` : ""} ${using ? "The planner uses each day's task time as that day's hours and shows these blocks behind its week view." : "Switched off: the planner uses your Hours per day and does not show these blocks."} ${workMin ? "Work and commute always show in the planner as blocks, switch or not." : ""} Click a block to edit its line; the Work tab's Work schedule edits the #work lines.` });
if (bad.length) root.createEl("p", { cls: "iw-warn", text: `Not understood (${bad.length}): ${bad.slice(0, 3).join(" · ")}. Write lines as "Mon-Fri 08:00 - 10:00 Deep work".` });
if (!blocks.length) return;

const g0 = Math.floor(Math.min(...blocks.map(b => b.s)) / 60) * 60, g1 = Math.ceil(Math.max(...blocks.map(b => b.e)) / 60) * 60, PX = 0.6;
const grid = root.createEl("div", { cls: "iw-scroll" }).createEl("div", { cls: "iw-grid" });
grid.createEl("div");
LABEL.forEach((d, i) => { const hd = grid.createEl("div", { cls: "iw-head", text: d }); hd.createEl("div", { cls: "iw-sub", text: taskMin(i) ? `${fmt(taskMin(i))} tasks` : "no task time" }); });
const hours = grid.createEl("div", { cls: "iw-hours", attr: { style: `height:${(g1 - g0) * PX}px` } });
for (let t = g0; t < g1; t += 60) hours.createEl("span", { text: clock(t), attr: { style: `top:${(t - g0) * PX}px` } });
const open = line => app.workspace.openLinkText(PATH, "", false, { eState: { line } });
DAYN.forEach((d, i) => {
  const col = grid.createEl("div", { cls: "iw-col", attr: { style: `height:${(g1 - g0) * PX}px` } });
  for (let t = g0; t < g1; t += 60) col.createEl("div", { cls: "iw-hr", attr: { style: `top:${(t - g0) * PX}px` } });
  for (const b of blocks.filter(b => b.days.includes(i))) {
    const el = col.createEl("div", { cls: `iw-b${b.tasks ? " is-tasks" : ""}${b.work ? " is-work" : ""}${b.commute ? " is-commute" : ""}`, attr: { style: `top:${(b.s - g0) * PX}px;height:${Math.max(14, (b.e - b.s) * PX - 2)}px`, title: `${b.what} ${clock(b.s)} - ${clock(b.e)}${b.tasks ? " (time for tasks)" : ""}` } });
    el.createSpan({ text: b.what });
    if ((b.e - b.s) * PX >= 26) el.createEl("small", { text: `${clock(b.s)} - ${clock(b.e)}` });
    el.addEventListener("click", () => open(b.line));
  }
});
