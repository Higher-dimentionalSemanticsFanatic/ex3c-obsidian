// Work schedule. Usage: await dv.view("Meta/views/workschedule")
// An editor for the work part of your Ideal Week: it reads and writes the #work lines under "## Blocks" in
// 03 Planning/Ideal Week.md ("Tue-Thu 07:30 - 16:30 Work #work") and the note's commute_minutes. The Ideal Week switch
// (planner_use_ideal_week in the config note) turns it on in the planner: work and the commute before and after it
// are kept free of tasks and drawn behind the week view.
const IDEAL = "03 Planning/Ideal Week.md", CFG = "Meta/EX3C Agenda Config.md";
const DAYS = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];
const DAYN = DAYS.map(d => d[0]);
const page = dv.page(IDEAL) ?? {};
const pad = n => String(n).padStart(2, "0");
const clock = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const parseClock = s => { const m = String(s ?? "").trim().match(/^(\d{1,2})[:.](\d{2})$/); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
const fmt = m => { const h = Math.floor(m / 60), r = m % 60; return [h ? `${h}h` : "", r ? `${r}m` : ""].filter(Boolean).join(" ") || "0h"; };
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
const LINE_RE = /^\s*([A-Za-z][A-Za-z, -]*?)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s+(.+)$/;
// the work hours per weekday, from the #work lines (the first one on a day counts)
const hours = {};
for (const [k] of DAYS) hours[k] = null;
for (const l of page.file?.lists?.array() ?? []) {
  const m = String(l.text).match(LINE_RE);
  if (!m || !/(^|\s)#work\b/i.test(m[6])) continue;
  for (const i of daysOf(m[1])) if (!hours[DAYN[i]]) hours[DAYN[i]] = { s: +m[2] * 60 + +m[3], e: +m[4] * 60 + +m[5] };
}
let commute = Number(page.commute_minutes ?? 0) || 0;
const using = dv.page(CFG)?.planner_use_ideal_week === true;
// days with the same hours next to each other become one line: Tue-Thu 07:30 - 16:30 Work #work
function workLines() {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const h = hours[DAYN[i]]; if (!h || h.e <= h.s) continue;
    let j = i; while (j + 1 < 7 && hours[DAYN[j + 1]] && hours[DAYN[j + 1]].s === h.s && hours[DAYN[j + 1]].e === h.e) j++;
    const name = k => DAYS[k][1];
    out.push(`- ${i === j ? name(i) : `${name(i)}-${name(j)}`} ${clock(h.s)} - ${clock(h.e)} Work #work`);
    i = j;
  }
  return out;
}
async function saveWork() {
  const f = app.vault.getAbstractFileByPath(IDEAL); if (!f) return;
  await app.vault.process(f, data => {
    const L = data.split("\n");
    let start = L.findIndex(l => /^##\s+Blocks\s*$/.test(l));
    if (start < 0) { const r = L.findIndex(l => /^##\s+Rules/.test(l)); const at = r < 0 ? L.length : r; L.splice(at, 0, "## Blocks", ""); start = at; }
    let end = L.findIndex((l, k) => k > start && /^#{1,6}\s/.test(l)); if (end < 0) end = L.length;
    const kept = L.slice(start + 1, end).filter(l => !(LINE_RE.test(l.replace(/^\s*-\s*/, "")) && /(^|\s)#work\b/i.test(l)));
    while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
    L.splice(start + 1, end - start - 1, ...kept, ...workLines(), "");
    return L.join("\n");
  });
}
const saveCommute = async v => { const f = app.vault.getAbstractFileByPath(IDEAL); if (f) await app.fileManager.processFrontMatter(f, fm => { fm.commute_minutes = v; }); };
const saveSwitch = async v => { const f = app.vault.getAbstractFileByPath(CFG); if (f) await app.fileManager.processFrontMatter(f, fm => { fm.planner_use_ideal_week = v; }); };

const root = dv.container.createEl("div", { cls: "wsch" });
root.createEl("style", { text: `
.wsch { font-size: 13px; }
.wsch h4 { margin: 0 0 4px; }
.wsch-sub { color: var(--text-muted); font-size: 12px; margin: 2px 0 8px; }
.wsch-grid { display: grid; grid-template-columns: auto auto auto auto 1fr; gap: 4px 8px; align-items: center; }
.wsch-grid input[type=text] { width: 4.6em; text-align: center; }
.wsch-grid .is-off { color: var(--text-faint); }
.wsch-grid input.is-off { opacity: .55; }
.wsch-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 8px 0 0; }
.wsch-row input[type=number] { width: 4.5em; }
.wsch-bar { position: relative; height: 18px; border-radius: 4px; background: var(--background-modifier-border); min-width: 120px; touch-action: none; user-select: none; -webkit-user-select: none; }
.wsch-bar span { position: absolute; top: 0; bottom: 0; border-radius: 4px; }
.wsch-bar .w { cursor: grab; }
.wsch-bar.is-dragging .w { cursor: grabbing; }
.wsch-bar .w i { position: absolute; top: 2px; bottom: 2px; width: 4px; border-radius: 2px; background: var(--background-primary); opacity: .8; cursor: ew-resize; }
.wsch-bar .w .hl { left: 2px; } .wsch-bar .w .hr { right: 2px; }
@media (max-width: 520px) { .wsch-grid { grid-template-columns: auto auto auto auto; } .wsch-bar { grid-column: 1 / -1; margin: 0 0 6px; height: 22px; } }
.wsch-bar .w { background: color-mix(in srgb, var(--interactive-accent) 70%, transparent); }
.wsch-bar .c { background: color-mix(in srgb, var(--text-faint) 55%, transparent); }
` });
root.createEl("h4", { text: "Work schedule" });
const total = DAYS.reduce((t, [k]) => t + (hours[k] && hours[k].e > hours[k].s ? hours[k].e - hours[k].s : 0), 0);
const workdays = DAYS.filter(([k]) => hours[k] && hours[k].e > hours[k].s).length;
root.createEl("p", { cls: "wsch-sub", text: workdays
  ? `${fmt(total)} of work on ${workdays} day${workdays === 1 ? "" : "s"}${commute ? `, plus ${fmt(commute * 2 * workdays)} of commuting` : ""}. The planner shows it as blocks on the hours and plans tasks around it. Stored as #work lines in your Ideal Week, and written out day by day to 10 Areas/Work/Work schedule so Day Planner shows it too.`
  : "Fill in the days you work. They are written into your Ideal Week as #work blocks, show in the planner as blocks that tasks are planned around, and appear in Day Planner through 10 Areas/Work/Work schedule." });
const sw = root.createEl("label", { cls: "wsch-row" });
const swi = sw.createEl("input", { attr: { type: "checkbox" } });
swi.checked = using;
sw.appendText(" Also use the rest of my Ideal Week (#tasks hours and blocks) in the planner");
swi.addEventListener("change", () => void saveSwitch(swi.checked));

const grid = root.createEl("div", { cls: "wsch-grid", attr: { style: "margin-top:8px" } });
// A day you switch off keeps its hours for when you switch it back on (while Obsidian stays open); a day that never
// had hours starts from your other workdays' hours instead of 09:00 - 17:00.
const MEM = (window.__ex3cWorkHours ??= {});
const R0 = 5 * 60, R1 = 23 * 60;
for (const [k] of DAYS) if (hours[k]) MEM[k] = { ...hours[k] };
const typical = DAYS.map(([k]) => hours[k]).find(Boolean) ?? null;
for (const [k, name] of DAYS) {
  const h = hours[k], shown = h ?? MEM[k] ?? typical;
  const on = grid.createEl("label");
  const cb = on.createEl("input", { attr: { type: "checkbox" } });
  cb.checked = !!h;
  on.appendText(` ${name}`);
  const s = grid.createEl("input", { attr: { type: "text", value: shown ? clock(shown.s) : "", placeholder: "09:00", "aria-label": `${name} start`, ...(h ? {} : { class: "is-off" }) } });
  grid.createEl("span", { cls: h ? "" : "is-off", text: "to" });
  const e = grid.createEl("input", { attr: { type: "text", value: shown ? clock(shown.e) : "", placeholder: "17:00", "aria-label": `${name} end`, ...(h ? {} : { class: "is-off" }) } });
  // the day from 05:00 to 23:00: commute grey, work in colour. Drag an end of the work part to change the start or the
  // end, its middle to move the whole day (15-minute steps); the times update as you drag and are saved on release.
  const bar = grid.createEl("div", { cls: "wsch-bar" });
  const pct = m => Math.max(0, Math.min(100, ((m - R0) / (R1 - R0)) * 100));
  const draw = x => {
    bar.empty();
    bar.title = x ? `${clock(x.s - commute)} leave · ${clock(x.s)} - ${clock(x.e)} work · home ${clock(x.e + commute)}. Drag an end to change it, the middle to move it.` : "Day off";
    if (!x || x.e <= x.s) return;
    if (commute) for (const [a, b] of [[x.s - commute, x.s], [x.e, x.e + commute]]) bar.createEl("span", { cls: "c", attr: { style: `left:${pct(a)}%;right:${100 - pct(b)}%` } });
    const w = bar.createEl("span", { cls: "w", attr: { style: `left:${pct(x.s)}%;right:${100 - pct(x.e)}%` } });
    w.createEl("i", { cls: "hl" }); w.createEl("i", { cls: "hr" });
  };
  draw(h);
  bar.addEventListener("pointerdown", ev => {
    const cur0 = hours[k]; if (!cur0) return;
    const r = bar.getBoundingClientRect(), at = cx => R0 + ((cx - r.left) / r.width) * (R1 - R0);
    const xs = r.left + (pct(cur0.s) / 100) * r.width, xe = r.left + (pct(cur0.e) / 100) * r.width, grab = Math.max(8, Math.min(14, (xe - xs) / 4));
    const mode = Math.abs(ev.clientX - xs) <= grab ? "s" : Math.abs(ev.clientX - xe) <= grab ? "e" : ev.clientX > xs && ev.clientX < xe ? "m" : null;
    if (!mode) return;
    ev.preventDefault(); try { bar.setPointerCapture(ev.pointerId); } catch (err) { /* not a real pointer */ } bar.addClass("is-dragging");
    const m0 = at(ev.clientX); let cur = { ...cur0 };
    const move = e2 => {
      const d = Math.round((at(e2.clientX) - m0) / 15) * 15;
      cur = mode === "s" ? { s: Math.max(0, Math.min(cur0.s + d, cur0.e - 15)), e: cur0.e } : mode === "e" ? { s: cur0.s, e: Math.min(24 * 60 - 1, Math.max(cur0.e + d, cur0.s + 15)) }
        : { s: Math.max(0, Math.min(cur0.s + d, 24 * 60 - 1 - (cur0.e - cur0.s))), e: 0 };
      if (mode === "m") cur.e = cur.s + (cur0.e - cur0.s);
      draw(cur); s.value = clock(cur.s); e.value = clock(cur.e);
    };
    const up = () => {
      bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up); bar.removeEventListener("pointercancel", up); bar.removeClass("is-dragging");
      if (cur.s !== cur0.s || cur.e !== cur0.e) { hours[k] = cur; MEM[k] = { ...cur }; void saveWork(); }
    };
    bar.addEventListener("pointermove", move); bar.addEventListener("pointerup", up); bar.addEventListener("pointercancel", up);
  });
  const commit = () => {
    if (!cb.checked) { if (hours[k]) MEM[k] = { ...hours[k] }; hours[k] = null; }
    else { const a = parseClock(s.value) ?? shown?.s ?? 9 * 60, b = parseClock(e.value) ?? shown?.e ?? 17 * 60; hours[k] = { s: a, e: b > a ? b : a + 8 * 60 }; MEM[k] = { ...hours[k] }; }
    void saveWork();
  };
  cb.addEventListener("change", commit);
  s.addEventListener("change", () => { cb.checked = true; commit(); });
  e.addEventListener("change", () => { cb.checked = true; commit(); });
}
const row = root.createEl("div", { cls: "wsch-row" });
const cl = row.createEl("label", { text: "Commute, each way " });
const ci = cl.createEl("input", { attr: { type: "number", min: "0", max: "240", step: "5", value: String(commute) } });
cl.appendText(" min");
ci.addEventListener("change", () => void saveCommute(Math.max(0, Number(ci.value) || 0)));
const copy = row.createEl("button", { text: "Monday's hours to Tue-Fri" });
copy.addEventListener("click", () => { if (!hours.mon) return; for (const k of ["tue", "wed", "thu", "fri"]) hours[k] = { ...hours.mon }; void saveWork(); });
