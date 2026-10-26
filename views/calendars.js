// Calendar links and local .ics files. Usage: await dv.view("Meta/views/calendars")
// Calendar links (Google, iCloud, Outlook "secret address in iCal format") are kept in Meta/EX3C Agenda Config.md
// (calendar_links) and fetched by the EX3C AgendA plugin into "Meta/calendars/<name> (calendar).md"; the app
// refreshes them at start-up when older than six hours. With { refresh: "stale" | "all" } this view only refreshes.
// Finds every .ics file in the vault and, on Import, writes "<name> (calendar).md" next to it: one line per
// event from 14 days ago to 120 days ahead, as "- [ ] 09:00 - 10:00 Title #event ⏳ 2026-10-12", so Day Planner
// shows the events as blocks and the planner treats them as fixed. Re-importing rewrites that note.
// Limits: times in a TZID zone are read as local time; recurring events support DAILY, WEEKLY (BYDAY), MONTHLY,
// YEARLY with INTERVAL, COUNT, UNTIL, and EXDATE.
const PAST = 14, AHEAD = 120;
const obs = (() => { try { return require("obsidian"); } catch (e) { return {}; } })();
const notify = m => (obs.Notice ? new obs.Notice(m) : console.warn(m));
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function unfold(text) { return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, ""); }
function parseDate(value, params) {
  const v = String(value).trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const allDay = !m[4] || /VALUE=DATE(?!-)/.test(params || "");
  if (allDay && !m[4]) return { date: new Date(+m[1], +m[2] - 1, +m[3]), allDay: true };
  const d = m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return { date: d, allDay: false };
}
function parseIcs(text) {
  const events = [];
  let cur = null;
  for (const line of unfold(text).split("\n")) {
    if (line === "BEGIN:VEVENT") { cur = { exdates: [] }; continue; }
    if (line === "END:VEVENT") { if (cur?.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":"); if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(";");
    const value = line.slice(i + 1);
    const p = params.join(";");
    if (name === "SUMMARY") cur.summary = value.replace(/\\,/g, ",").replace(/\;/g, ";").replace(/\\n/gi, " ").trim();
    else if (name === "DTSTART") cur.start = parseDate(value, p);
    else if (name === "DTEND") cur.end = parseDate(value, p);
    else if (name === "RRULE") cur.rrule = Object.fromEntries(value.split(";").map(kv => kv.split("=")));
    else if (name === "EXDATE") for (const v of value.split(",")) { const d = parseDate(v, p); if (d) cur.exdates.push(iso(d.date)); }
    else if (name === "STATUS") cur.status = value;
  }
  return events.filter(e => e.status !== "CANCELLED");
}
function occurrences(ev, from, to) {
  const out = [];
  const start = ev.start.date;
  const durMs = ev.end ? ev.end.date - start : (ev.start.allDay ? 86400000 : 3600000);
  const push = d => { if (d >= from && d <= to && !ev.exdates.includes(iso(d))) out.push(new Date(d)); };
  if (!ev.rrule) { push(start); return out.map(d => ({ start: d, end: new Date(d.getTime() + durMs) })); }
  const r = ev.rrule, interval = Number(r.INTERVAL || 1), count = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? parseDate(r.UNTIL)?.date : null;
  const days = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const byday = r.BYDAY ? r.BYDAY.split(",").map(x => days[x.slice(-2)]).filter(x => x !== undefined) : null;
  let n = 0;
  for (let i = 0; i < 2000 && n < count; i++) {
    const base = new Date(start);
    if (r.FREQ === "DAILY") base.setDate(base.getDate() + i * interval);
    else if (r.FREQ === "WEEKLY") base.setDate(base.getDate() + i * 7 * interval);
    else if (r.FREQ === "MONTHLY") base.setMonth(base.getMonth() + i * interval);
    else if (r.FREQ === "YEARLY") base.setFullYear(base.getFullYear() + i * interval);
    else break;
    const candidates = r.FREQ === "WEEKLY" && byday ? byday.map(wd => { const d = new Date(base); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + ((wd + 6) % 7)); return d; }).filter(d => d >= start).sort((a, b) => a - b) : [base];
    for (const d of candidates) {
      if (until && d > until) { n = count; break; }
      if (n >= count) break;
      n++;
      push(d);
    }
    if (base > to) break;
  }
  return out.map(d => ({ start: d, end: new Date(d.getTime() + durMs) }));
}
function eventLines(text) {
  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - PAST);
  const to = new Date(); to.setHours(23, 59, 59, 0); to.setDate(to.getDate() + AHEAD);
  const lines = [];
  for (const ev of parseIcs(text)) {
    for (const o of occurrences(ev, from, to)) {
      const title = (ev.summary || "Untitled event").replace(/#/g, "");
      if (ev.start.allDay) lines.push({ key: iso(o.start) + " 00:00", line: `- [ ] ${title} #event ⏳ ${iso(o.start)}` });
      else lines.push({ key: iso(o.start) + " " + hm(o.start), line: `- [ ] ${hm(o.start)} - ${hm(o.end)} ${title} #event ⏳ ${iso(o.start)}` });
    }
  }
  return lines.sort((a, b) => a.key.localeCompare(b.key)).map(x => x.line);
}
function calendarNote(source, lines, area = "") {
  const stamp = new Date();
  return `---\ntags:\n  - calendar\n${area ? `area: ${area}\n` : ""}fetched: ${stamp.toISOString()}\n---\nGenerated from ${source} on ${pad(stamp.getDate())}-${pad(stamp.getMonth() + 1)}-${stamp.getFullYear()} ${hm(stamp)}. Refreshed automatically; edits here are overwritten.\n\n## Events\n${lines.join("\n")}\n`;
}
async function writeNote(target, body) {
  const folder = target.split("/").slice(0, -1).join("/");
  if (folder && !app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
  const existing = app.vault.getAbstractFileByPath(target);
  if (existing) await app.vault.modify(existing, body); else await app.vault.create(target, body);
}
// ---- calendar links ----
const CFG = "Meta/EX3C Agenda Config.md";
const LINK_DIR = "Meta/calendars";
const plugin = app.plugins.plugins["ex3c-agenda"];
// a link: { name, url, area (one of your areas: its events take that area's colour in the planner), off (switched off) }
const AREAS = app.plugins.plugins["ex3c-agenda"]?.areaKeys?.() ?? ["work", "study", "personal"];
const areaName = a => app.plugins.plugins["ex3c-agenda"]?.areaName?.(a) || a[0].toUpperCase() + a.slice(1);
const links = () => (Array.isArray(dv.page(CFG)?.calendar_links) ? dv.page(CFG).calendar_links : []).filter(l => l && l.url).map(l => ({ name: String(l.name || "Calendar").replace(/[\\/:*?"<>|#^[\]]/g, " ").trim() || "Calendar", url: String(l.url), area: /^[a-z0-9-]+$/.test(String(l.area || "")) ? String(l.area) : "", off: l.off === true }));
const plain = l => ({ name: l.name, url: l.url, ...(l.area ? { area: l.area } : {}), ...(l.off ? { off: true } : {}) });
const linkTarget = l => `${LINK_DIR}/${l.name} (calendar).md`;
async function fetchLink(l) {
  if (!plugin?.fetchText) throw new Error("the EX3C AgendA plugin is needed to fetch calendar links");
  const text = await plugin.fetchText(l.url);
  if (!/BEGIN:VCALENDAR/.test(text)) throw new Error("that address did not return a calendar (.ics)");
  const lines = eventLines(text);
  await writeNote(linkTarget(l), calendarNote(`the calendar link "${l.name}"`, lines, l.area));
  return lines.length;
}
// switched off: the note keeps no events (so the planner and Day Planner show none) until you switch it on again
const offNote = l => writeNote(linkTarget(l), `---\ntags:\n  - calendar\n${l.area ? `area: ${l.area}\n` : ""}off: true\n---\nThe calendar link "${l.name}" is switched off on the Calendars page; switch it on to fetch its events again.\n\n## Events\n`);
async function saveLinks(list) {
  const f = app.vault.getAbstractFileByPath(CFG);
  if (f) await app.fileManager.processFrontMatter(f, fm => { fm.calendar_links = list.map(plain); });
}
const updateLink = (l, change) => saveLinks(links().map(x => (x.url === l.url ? { ...x, ...change } : x)));
if (input?.refresh) {
  for (const l of links().filter(x => !x.off)) {
    const fetched = dv.page(linkTarget(l))?.fetched;
    const age = fetched ? Date.now() - new Date(String(fetched)).getTime() : Infinity;
    if (input.refresh === "all" || !(age < 6 * 3600000)) {
      try { const n = await fetchLink(l); if (input.refresh === "all") notify(`${l.name}: ${n} events`); }
      catch (e) { console.warn(`Calendar link ${l.name}`, e); if (input.refresh === "all") notify(`${l.name}: ${e.message}`); }
    }
  }
  return;
}

async function importFile(file) {
  const text = await app.vault.read(file);
  const lines = eventLines(text);
  const target = `${file.parent?.path && file.parent.path !== "/" ? file.parent.path + "/" : ""}${file.basename} (calendar).md`;
  await writeNote(target, calendarNote(`[[${file.path}]]`, lines).replace("Refreshed automatically", "Re-import to update"));
  return { target, count: lines.length };
}

const root = dv.container.createEl("div", { cls: "lifeos-widget" });
root.createEl("h4", { text: "Calendar links" });
root.createEl("p", { attr: { style: "color:var(--text-muted);font-size:12px" }, text: "Paste a calendar's secret iCal address (Google: Settings › your calendar › Secret address in iCal format; iCloud: Share › Public calendar; Outlook: Publish › ICS). Events from 14 days back to 120 days ahead become fixed blocks in the planner and in Day Planner, refreshed when the app starts. The address is stored in Meta/EX3C Agenda Config.md and syncs with your vault, so treat that note as private. Use either this or Day Planner's remote calendars for a calendar, not both, or its events show twice." });
const areaPicker = (parent, value) => {
  const sel = parent.createEl("select", { attr: { "aria-label": "Area", title: "Its events take this area's colour in the planner" } });
  for (const a of ["", ...AREAS]) sel.createEl("option", { text: a ? areaName(a) : "No area (grey)", attr: { value: a } });
  // an area you have since switched off still shows, so the link keeps it until you pick another
  if (value && !AREAS.includes(value)) sel.createEl("option", { text: `${areaName(value)} (off)`, attr: { value } });
  sel.value = value || "";
  return sel;
};
for (const l of links()) {
  const row = root.createEl("div", { attr: { style: `display:flex;gap:8px;align-items:center;margin:4px 0;flex-wrap:wrap${l.off ? ";opacity:.6" : ""}` } });
  const page = dv.page(linkTarget(l));
  // on/off: off empties its note, on fetches it again
  const sw = row.createEl("input", { attr: { type: "checkbox", title: l.off ? "Switched off: switch on to fetch its events again" : "On: switch off to hide its events everywhere, without losing the link" } });
  sw.checked = !l.off;
  sw.addEventListener("change", async () => {
    sw.disabled = true;
    try {
      if (sw.checked) { await updateLink(l, { off: false }); notify(`${l.name}: ${await fetchLink({ ...l, off: false })} events`); }
      else { await updateLink(l, { off: true }); await offNote(l); notify(`${l.name} switched off`); }
    } catch (e) { notify(`${l.name}: ${e.message}`); }
    sw.disabled = false;
  });
  row.createEl("strong", { text: l.name });
  row.createEl("span", { attr: { style: "flex:1;min-width:10em;color:var(--text-muted);font-size:12px" }, text: l.off ? "switched off" : page?.fetched ? (() => { const t = new Date(String(page.fetched)); return `${page.file.tasks.length} events, refreshed ${pad(t.getDate())}-${pad(t.getMonth() + 1)} ${hm(t)}`; })() : "not fetched yet" });
  // its area: the events' colour in the planner (the note's area property), no refetch needed
  const sel = areaPicker(row, l.area);
  sel.addEventListener("change", async () => {
    await updateLink(l, { area: sel.value });
    const f = app.vault.getAbstractFileByPath(linkTarget(l));
    if (f) await app.fileManager.processFrontMatter(f, fm => { if (sel.value) fm.area = sel.value; else delete fm.area; });
  });
  const ob = row.createEl("button", { text: "Open note" });
  ob.disabled = !page;
  ob.addEventListener("click", () => app.workspace.openLinkText(linkTarget(l), "", false));
  const rb = row.createEl("button", { text: "Refresh" });
  rb.disabled = l.off;
  rb.addEventListener("click", async () => { rb.disabled = true; try { notify(`${l.name}: ${await fetchLink(l)} events`); } catch (e) { notify(`${l.name}: ${e.message}`); } rb.disabled = false; });
  // Remove asks once more: it forgets the address and moves the note to the trash
  const xb = row.createEl("button", { text: "Remove" });
  let armed = null;
  xb.addEventListener("click", async () => {
    if (!armed) { xb.setText("Sure? Remove"); xb.addClass("mod-warning"); armed = setTimeout(() => { armed = null; xb.setText("Remove"); xb.removeClass("mod-warning"); }, 4000); return; }
    clearTimeout(armed);
    await saveLinks(links().filter(x => x.url !== l.url)); const f = app.vault.getAbstractFileByPath(linkTarget(l)); if (f) await app.vault.trash(f, false);
  });
}
const add = root.createEl("div", { attr: { style: "display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 14px" } });
const nameIn = add.createEl("input", { attr: { type: "text", placeholder: "Name, e.g. Work", style: "width:9em" } });
const urlIn = add.createEl("input", { attr: { type: "url", placeholder: "https://… or webcal://… .ics address", style: "flex:1;min-width:14em" } });
const areaIn = areaPicker(add, "");
const ab = add.createEl("button", { text: "Add and fetch", cls: "mod-cta" });
ab.addEventListener("click", async () => {
  const l = { name: nameIn.value.trim() || "Calendar", url: urlIn.value.trim(), area: areaIn.value, off: false };
  if (!/^(https?|webcal):\/\//i.test(l.url)) { notify("Paste the calendar's https:// or webcal:// address."); return; }
  ab.disabled = true;
  try { const n = await fetchLink(l); await saveLinks([...links().filter(x => x.url !== l.url), l]); notify(`${l.name}: ${n} events`); }
  catch (e) { notify(`Could not add ${l.name}: ${e.message}`); }
  ab.disabled = false;
});
root.createEl("h4", { text: "Calendar files (.ics in the vault)" });
const files = app.vault.getFiles().filter(f => f.extension === "ics" && !f.path.startsWith(".trash/"));
if (!files.length) root.createEl("p", { text: "No .ics files in the vault yet. Put one anywhere in the vault (for example in this folder) and reopen this note." });
for (const f of files) {
  const row = root.createEl("div", { attr: { style: "display:flex;gap:8px;align-items:center;margin:6px 0" } });
  row.createEl("span", { text: f.path, attr: { style: "flex:1" } });
  const b = row.createEl("button", { text: "Import" });
  b.addEventListener("click", async () => {
    try { const r = await importFile(f); notify(`Imported ${r.count} events into ${r.target}`); b.setText(`Imported ${r.count}`); }
    catch (e) { console.error(e); notify(`Could not import ${f.path}: ${e.message}`); }
  });
}
