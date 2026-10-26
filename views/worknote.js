// Writes your Work schedule into a note Day Planner can read. Usage: await dv.view("Meta/views/worknote")
// The #work lines under "## Blocks" in 03 Planning/Ideal Week.md (the Work tab's Work schedule writes them) and the note's
// commute_minutes become dated task lines in 10 Areas/Work/Work schedule.md, from today to the end of the third week
// after this one: "- [ ] 07:30 - 16:30 Work #work #event ⏳ 2026-10-27". #event makes them fixed busy time, not tasks.
// The EX3C AgendA app runs this at start-up and whenever the Ideal Week changes; it writes only when something changed.
const IDEAL = "03 Planning/Ideal Week.md", NOTE = input?.path ?? "10 Areas/Work/Work schedule.md";
const DAYN = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const pad = n => String(n).padStart(2, "0");
const clock = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function daysOf(spec) {
  const out = new Set();
  for (const part of String(spec).toLowerCase().split(/\s*,\s*/)) {
    if (part === "daily" || part === "every day") DAYN.forEach((d, i) => out.add(i));
    else if (part === "weekdays") [0, 1, 2, 3, 4].forEach(i => out.add(i));
    else if (part === "weekend") [5, 6].forEach(i => out.add(i));
    else { const [a, b] = part.split(/\s*-\s*/).map(x => DAYN.indexOf(x.slice(0, 3))); if (a < 0) continue; if (b === undefined) out.add(a); else if (b >= 0) for (let i = a; ; i = (i + 1) % 7) { out.add(i); if (i === b) break; } }
  }
  return [...out];
}
const LINE_RE = /^\s*[-*+]\s+([A-Za-z][A-Za-z, -]*?)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s+(.+)$/;
const src = app.vault.getAbstractFileByPath(IDEAL);
if (!src) return;
// read the file itself, not the Dataview index, which may not have caught up with the edit that triggered this
const text = await app.vault.cachedRead(src);
const commute = Number(app.metadataCache.getFileCache(src)?.frontmatter?.commute_minutes ?? 0) || 0;
const perDay = {};
for (const l of text.split("\n")) {
  const m = l.match(LINE_RE);
  if (!m || !/(^|\s)#work\b/i.test(m[6])) continue;
  const what = m[6].replace(/(^|\s)#work\b/gi, " ").trim() || "Work";
  for (const i of daysOf(m[1])) (perDay[i] ??= []).push({ s: +m[2] * 60 + +m[3], e: +m[4] * 60 + +m[5], what });
}
const file = app.vault.getAbstractFileByPath(NOTE);
if (!Object.keys(perDay).length && !file) return; // no work schedule and no note: nothing to do
const start = new Date(); start.setHours(12, 0, 0, 0);
const end = new Date(start); end.setDate(end.getDate() + (6 - (start.getDay() + 6) % 7) + 21); // Sunday, three weeks on
const lines = [];
for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
  for (const b of perDay[(d.getDay() + 6) % 7] ?? []) {
    if (b.e <= b.s) continue;
    const day = iso(d);
    if (commute) lines.push(`- [ ] ${clock(b.s - commute)} - ${clock(b.s)} Commute #work #event ⏳ ${day}`);
    lines.push(`- [ ] ${clock(b.s)} - ${clock(b.e)} ${b.what} #work #event ⏳ ${day}`);
    if (commute) lines.push(`- [ ] ${clock(b.e)} - ${clock(b.e + commute)} Commute #work #event ⏳ ${day}`);
  }
}
const body = `---
tags:
  - generated
area: work
---
Generated from your Work schedule (the \`#work\` lines in [[Ideal Week]]), from today to the end of the third week after this one. Refreshed automatically; edits here are overwritten. Change your hours in the Work schedule on the Work tab.

## Work blocks
${lines.length ? lines.join("\n") : "No work days in your Work schedule."}
`;
if (file) { if ((await app.vault.read(file)) !== body) await app.vault.modify(file, body); }
else {
  const dir = NOTE.split("/").slice(0, -1).join("/");
  if (dir && !app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
  await app.vault.create(NOTE, body);
}
