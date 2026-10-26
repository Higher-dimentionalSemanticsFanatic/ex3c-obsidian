// Typed quick capture. Usage: await dv.view("Meta/views/capture")
// Type a task the way you would say it; the words that mean a date, time, length, priority, project, person,
// price or repeat become Obsidian Tasks fields, and the rest is the task text. A live preview shows the line
// before it is written. Tasks go to 08 Tasks/Tasks.md under ## Inbox, or into a project note under ## Inline tasks.
const INBOX = { path: "08 Tasks/Tasks.md", heading: "## Inbox" };
// On an area tab (Work, Study, Personal, or one you added) a task gets that area's tag unless you typed another area or it goes into
// a project note that has its own area property.
const AREA_KEYS = app.plugins?.plugins?.["ex3c-agenda"]?.areaKeys?.() ?? ["work", "study", "personal"];
const TAB_AREA = AREA_KEYS.includes(input?.area) ? input.area : null;
const PROJECT_HEADING = "## Inline tasks";
const obs = (() => { try { return require("obsidian"); } catch (e) { return {}; } })();
const notify = msg => (obs.Notice ? new obs.Notice(msg) : console.warn(msg));

// ---------- dates ----------
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; };
const dmy = s => `${new Date(`${s}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" })} ${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
const clock = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const dayIndex = w => DAYS.findIndex(d => w.length >= 3 && d.startsWith(w));
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// ---------- notes the @ and + words can point at ----------
const notesOf = (pred) => dv.pages().where(p => !/^(Templates|\.trash|scripts|wiki)\//.test(p.file.path) && !(p.file.tags ?? []).includes("#example") && pred(p)).array()
  .map(p => ({ name: p.file.name, path: p.file.path, slug: slug(p.file.name) }));
const PROJECTS = notesOf(p => String(p.type ?? "") === "project");
const PEOPLE = notesOf(p => p.file.path.startsWith("05 People/"));
const match = (list, word) => { const w = slug(word); return list.find(n => n.slug === w) || list.find(n => n.slug.startsWith(w)) || list.find(n => n.slug.includes(w)) || null; };

// ---------- the parser ----------
// Returns the parts it understood and the task line it would write. Words in "quotes" are always kept as text.
function parse(input) {
  const out = { text: [], tags: [], fields: [], warnings: [] };
  // fields typed the Dataview way: "price:: 12", "shop:: ikea", "[est:: 1h]"; price, qty and est are read as below
  input = input.replace(/\[([\w-]+)::\s*([^\]]*)\]|(?<![\w"])([\w-]+)::\s*("[^"]*"|\S+)/g, (all, k1, v1, k2, v2) => {
    const k = (k1 || k2).toLowerCase(), v = (v1 ?? v2).replace(/^"|"$/g, "").trim();
    if (["price", "qty", "est"].includes(k)) return ` ${k} ${v} `;
    if (v) out.fields.push(`[${k}:: ${v}]`);
    return " ";
  });
  const toks = (input.match(/"[^"]*"|\S+/g) || []);
  const base = today();
  const low = i => (toks[i] || "").toLowerCase().replace(/[,;]$/, "").replace(/\.$/, "");
  // a date starting at toks[i]: [isoDate, tokensUsed] or null. loose = after a word like due, do or start, where
  // short forms such as "1-3" and "sun" are dates too; on their own they stay text
  const dateAt = (i, loose) => {
    const w = low(i), w2 = low(i + 1);
    if (["today", "tonight"].includes(w)) return [iso(base), 1];
    if (["tomorrow", "tmr", "tmrw"].includes(w)) return [iso(addDays(base, 1)), 1];
    const toNextMonday = ((8 - base.getDay()) % 7) || 7;
    if (w === "next" && w2 === "week") return [iso(addDays(base, toNextMonday)), 2];
    // "fri" is the coming Friday; "next fri" is Friday of next week (weeks start on Monday)
    if (w === "next" && dayIndex(w2) >= 0) return [iso(addDays(base, toNextMonday + (dayIndex(w2) + 6) % 7)), 2];
    // "sun" is also an everyday word, so on its own only "sunday" counts
    if (dayIndex(w) >= 0 && /^[a-z]+$/.test(w) && (loose || w !== "sun")) return [iso(addDays(base, (dayIndex(w) - base.getDay() + 7) % 7 || 7)), 1];
    if (w === "in" && /^\d+$/.test(w2)) { const u = low(i + 2); const k = /^days?$/.test(u) ? 1 : /^weeks?$/.test(u) ? 7 : /^months?$/.test(u) ? 30 : 0; if (k) return [iso(addDays(base, Number(w2) * k)), 3]; }
    const m = w.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?$/);
    // on its own "1-3" is a range ("chapters 1-3"); a date needs a year or a two-digit day or month, like 24-10 or 01-03
    if (m && (loose || m[3] || m[1].length === 2 || m[2].length === 2) && !(m[3] === undefined && w.includes("."))) {
      let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : base.getFullYear();
      let d = new Date(y, Number(m[2]) - 1, Number(m[1]), 12);
      if (d.getMonth() !== Number(m[2]) - 1) return null;
      if (!m[3] && d < base) d = new Date(y + 1, Number(m[2]) - 1, Number(m[1]), 12);
      return [iso(d), 1];
    }
    return null;
  };
  // a clock time: 14:00, 9:30, 2pm, 2:30pm; bare = also a plain hour like "14" or "5" (after "at", "from", "to")
  const clockOf = (s, bare) => {
    const m = String(s).toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
    if (!m || (!m[2] && !m[3] && !bare)) return null;
    let hh = Number(m[1]); const mm = Number(m[2] || 0);
    if (m[3]) { if (hh < 1 || hh > 12) return null; hh = hh % 12 + (m[3] === "pm" ? 12 : 0); }
    else if (bare && !m[2] && hh >= 1 && hh <= 6) hh += 12; // "at 5" means 17:00
    return hh < 24 && mm < 60 ? hh * 60 + mm : null;
  };
  // a length starting at toks[i]: [minutes, tokensUsed]. 30m, 1h, 1h30, 1.5h, 90min, "2 h", "45 min", "1 hour"
  const lenAt = i => {
    const w = low(i), m = w.match(/^(\d+(?:[.,]\d+)?)(?:h|hr|hrs|hours?)(?:(\d{1,2})m?)?$|^(\d+)(?:m|min|mins|minutes?)$/);
    if (m) return [m[3] ? Number(m[3]) : Math.round(parseFloat(m[1].replace(",", ".")) * 60 + Number(m[2] || 0)), 1];
    if (/^\d+(?:[.,]\d+)?$/.test(w)) {
      const u = low(i + 1), n = parseFloat(w.replace(",", "."));
      if (/^(h|hr|hrs|hours?)$/.test(u)) return [Math.round(n * 60), 2];
      if (/^(m|min|mins|minutes?)$/.test(u)) return [Math.round(n), 2];
    }
    return null;
  };
  // a price starting at toks[i]: [amount, tokensUsed]. €12, 12€, 12 eur, 12eur, eur 12, 12.50, 12,50, $12, price 12
  const NUM = "(\\d+(?:[.,]\\d{1,2})?)", CUR = "(?:€|\\$|£|eur|euro|euros|usd|gbp)";
  const priceAt = (i, loose) => {
    const w = low(i);
    let m = w.match(new RegExp(`^${CUR}${NUM}$|^${NUM}${CUR}$`));
    if (m) return [m[1] || m[2], 1];
    if (new RegExp(`^${NUM}$`).test(w) && new RegExp(`^${CUR}$`).test(low(i + 1))) return [w, 2];
    if (new RegExp(`^${CUR}$`).test(w) && new RegExp(`^${NUM}$`).test(low(i + 1))) return [low(i + 1), 2];
    if (loose && new RegExp(`^${NUM}$`).test(w)) return [w, 1];
    if (/^\d+[.,]\d{2}$/.test(w)) return [w, 1]; // 12.50: two decimals is always money
    return null;
  };
  const PRI = { "!!!": "🔺", "!!": "🔺", "!urgent": "🔺", "!highest": "🔺", "!": "⏫", "!high": "⏫", "!med": "🔼", "!medium": "🔼", "!low": "🔽", "!lowest": "⏬" };
  const PRIW = { urgent: "🔺", highest: "🔺", high: "⏫", med: "🔼", medium: "🔼", normal: "", low: "🔽", lowest: "⏬" };
  const DO = ["do", "on", "plan", "sched", "scheduled"], DUE = ["by", "due", "before", "deadline"], START = ["start", "starts", "from"];
  const UNIT = /^(day|week|month|year|weekday|days|weeks|months|years)$/;
  let lastLen = false;
  for (let i = 0; i < toks.length; i++) {
    const raw = toks[i], w = low(i), n1 = low(i + 1), n2 = low(i + 2);
    const wasLen = lastLen; lastLen = false;
    if (/^".*"$/.test(raw)) { out.text.push(raw.slice(1, -1)); continue; }
    // dates after a word: "do fri" (⏳), "due 24-10" / "by fri" (📅), "start 1-11" (🛫)
    const kd = DO.includes(w) ? "date" : DUE.includes(w) ? "due" : START.includes(w) ? "startDate" : null;
    if (kd && dateAt(i + 1, true)) { const [d, n] = dateAt(i + 1, true); out[kd] = d; i += n; continue; }
    // repeat: "every week", "every 2 days", "every monday", "every weekday"
    if (w === "every" && (UNIT.test(n1) || dayIndex(n1) >= 0 && /^[a-z]+$/.test(n1))) { out.repeat = `every ${dayIndex(n1) >= 0 ? DAYS[dayIndex(n1)] : n1}`; i += 1; continue; }
    if (w === "every" && /^\d+$/.test(n1) && UNIT.test(n2)) { out.repeat = `every ${n1} ${n2}`; i += 2; continue; }
    // time: 14:00, 2pm, 9:30-11, 2-4pm, "at 14", "from 9 to 11", "until 16:00"
    if (["at", "from"].includes(w) && /^[\d:]+(am|pm)?-[\d:]+(am|pm)?$/.test(n1) && /:|am|pm/.test(n1)) continue; // "at 14:30-15"
    const rg = w.match(/^([\d:]+(?:am|pm)?)-([\d:]+(?:am|pm)?)$/);
    if (rg) {
      const sfx = (rg[2].match(/(am|pm)$/) || [""])[0];
      let a = clockOf(rg[1], !!sfx) ?? null, b = clockOf(rg[2], true);
      if (sfx && !/(am|pm)$/.test(rg[1])) { const a2 = clockOf(rg[1] + sfx, false); if (a2 !== null && a2 < b) a = a2; }
      if (a !== null && b !== null && (/:|am|pm/.test(rg[1]) || sfx)) { out.start = a; out.end = b; continue; }
    }
    let t = clockOf(w, false), used = 0;
    if (t === null && ["at", "from"].includes(w) && clockOf(n1, true) !== null) { t = clockOf(n1, true); used = 1; }
    if (t !== null) {
      out.start = t; i += used;
      if (["to", "until", "till"].includes(low(i + 1)) && clockOf(low(i + 2), true) !== null) { out.end = clockOf(low(i + 2), true); i += 2; }
      continue;
    }
    if (["until", "till"].includes(w) && out.start !== undefined && clockOf(n1, true) !== null) { out.end = clockOf(n1, true); i++; continue; }
    // length: 30m, 1h30, "2 h", "45 min"; "1h 30m" adds up; "for 2 h" and "est 2h" too
    const lk = ["for", "est", "takes"].includes(w) && lenAt(i + 1) ? 1 : 0;
    const ln = lenAt(i + lk);
    if (ln) { out.est = (wasLen ? out.est || 0 : 0) + ln[0]; i += lk + ln[1] - 1; lastLen = true; continue; }
    // priority: !, !!, !low, or "prio high", "priority low"
    if (PRI[w]) { out.pri = PRI[w]; continue; }
    if (["prio", "priority"].includes(w) && n1 in PRIW) { out.pri = PRIW[n1]; i++; continue; }
    // project and person: @cpmx, +alex, or "project cpmx" and "with alex" when such a note exists
    if (/^@[\w-]+$/.test(raw)) { const p = match(PROJECTS, raw.slice(1)); out.project = p || { name: raw.slice(1), slug: slug(raw.slice(1)), path: null }; if (!p) out.warnings.push(`No project note matches "${raw.slice(1)}": the task gets the tag and goes to the inbox.`); continue; }
    if (w === "project" && n1 && match(PROJECTS, n1)) { out.project = match(PROJECTS, n1); i++; continue; }
    if (/^\+[\w-]+$/.test(raw)) { const p = match(PEOPLE, raw.slice(1)); out.person = p || { name: raw.slice(1), slug: slug(raw.slice(1)) }; if (!p) out.warnings.push(`No person note matches "${raw.slice(1)}".`); continue; }
    if (w === "with" && n1.length >= 3 && PEOPLE.find(n => n.slug === slug(n1) || n.slug.startsWith(`${slug(n1)}-`))) { out.person = PEOPLE.find(n => n.slug === slug(n1) || n.slug.startsWith(`${slug(n1)}-`)); out.text.push(raw, toks[i + 1]); i++; continue; } // "Lunch with Alex" keeps its words
    // area: #work, or "area work"
    if (w === "area" && AREA_KEYS.includes(n1)) { out.tags.push(`#${n1}`); i++; continue; }
    // price and quantity: €12, 12 eur, price 12, 12.50; x3, 3x, qty 3, 3 pcs
    const pk = ["price", "cost", "costs"].includes(w) && priceAt(i + 1, true) ? 1 : 0;
    const pr = priceAt(i + pk, pk === 1);
    if (pr) { out.price = String(pr[0]).replace(",", "."); i += pk + pr[1] - 1; continue; }
    const q = w.match(/^x(\d+)$|^(\d+)x$/);
    if (q) { out.qty = q[1] || q[2]; continue; }
    if (["qty", "quantity"].includes(w) && /^\d+$/.test(n1)) { out.qty = n1; i++; continue; }
    if (/^\d+$/.test(w) && /^(pcs|pieces?|pack|packs)$/.test(n1)) { out.qty = w; i++; continue; }
    // a date on its own: today, fri, next mon, in 3 days, 24-10 (writes ⏳)
    const d = dateAt(i, false);
    if (d) { out.date = d[0]; i += d[1] - 1; continue; }
    if (/^#[\w/-]+$/.test(raw)) { out.tags.push(raw); continue; }
    out.text.push(raw);
  }
  // the Tasks plugin needs a date to repeat from
  if (out.repeat && !out.date && !out.due) out.date = iso(base);
  if (out.start !== undefined) {
    if (!out.date) out.date = iso(base);
    if (out.end === undefined) out.end = out.start + (out.est || 30);
    if (out.end <= out.start) out.warnings.push("The end time is before the start time.");
  }
  const title = out.text.join(" ").trim();
  if (!title) out.warnings.push("The task has no text yet.");
  const bits = [];
  if (out.start !== undefined) bits.push(`${clock(out.start)} - ${clock(out.end)}`);
  bits.push(title);
  const typedArea = out.tags.some(t => AREA_KEYS.includes(t.slice(1).toLowerCase()));
  const projectArea = out.project?.path ? String(dv.page(out.project.path)?.area ?? "").toLowerCase() : "";
  if (TAB_AREA && !typedArea && !AREA_KEYS.includes(projectArea)) out.tags.push(`#${TAB_AREA}`);
  bits.push(...out.tags);
  if (out.project) bits.push(`#project/${out.project.slug}`);
  if (out.person) bits.push(`#p/${out.person.slug}`);
  if (out.est) bits.push(`[est:: ${out.est >= 60 ? `${Math.floor(out.est / 60)}h${out.est % 60 ? ` ${out.est % 60}m` : ""}` : `${out.est}m`}]`);
  if (out.price) bits.push(`[price:: ${out.price}]`);
  if (out.qty) bits.push(`[qty:: ${out.qty}]`);
  bits.push(...out.fields);
  if (out.pri) bits.push(out.pri);
  if (out.repeat) bits.push(`🔁 ${out.repeat}`);
  // the Tasks plugin only repeats a task that has a date, so a repeat without one starts on its first day
  // and a repeat on a weekday starts on the first such day (a time alone means today, which may be the wrong day)
  if (out.repeat && !out.due) {
    const d = out.date ? new Date(`${out.date}T12:00:00`) : new Date(base), wd = DAYS.findIndex(x => out.repeat === `every ${x}`);
    if (wd >= 0) d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7));
    else if (out.repeat === "every weekday") while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    out.date = iso(d);
  }
  bits.push(`➕ ${iso(base)}`);
  if (out.startDate) bits.push(`🛫 ${out.startDate}`);
  if (out.date) bits.push(`⏳ ${out.date}`);
  if (out.due) bits.push(`📅 ${out.due}`);
  out.title = title;
  out.line = `- [ ] ${bits.filter(Boolean).join(" ")}`;
  out.target = out.project?.path ? { path: out.project.path, heading: PROJECT_HEADING, label: `${out.project.name} › Inline tasks` } : { ...INBOX, label: "Tasks › Inbox" };
  return out;
}

// ---------- writing ----------
async function append(target, lines) {
  let file = app.vault.getAbstractFileByPath(target.path);
  if (!file) { notify(`Note not found: ${target.path}`); return false; }
  await app.vault.process(file, data => {
    const L = data.split("\n");
    let h = L.findIndex(l => l.trim() === target.heading);
    if (h < 0) { while (L.length && L[L.length - 1].trim() === "") L.pop(); L.push("", target.heading); h = L.length - 1; }
    const level = target.heading.match(/^#+/)[0].length;
    let end = L.length;
    for (let i = h + 1; i < L.length; i++) { const m = L[i].match(/^(#+)\s/); if (m && m[1].length <= level) { end = i; break; } }
    let at = end;
    while (at > h + 1 && (L[at - 1].trim() === "" || /^\s*[-*+] \[ \]\s*$/.test(L[at - 1]))) at--;
    L.splice(at, 0, ...lines);
    return L.join("\n");
  });
  return true;
}

// ---------- page ----------
function h(tag, attrs = {}, parent, text) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "class") el.className = v; else if (k === "style") el.style.cssText = v; else el.setAttribute(k, v); }
  if (text !== undefined) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}
const KEEP = (window.__compassCapture ??= { draft: "", added: [] });
const root = h("div", { class: "qc" }, dv.container);
h("style", {}, root, `
.qc { font-size: 13px; }
.qc textarea { width: 100%; min-height: 2.6em; font-size: 15px; padding: 8px 10px; border-radius: 8px; resize: vertical; box-sizing: border-box; }
.qc-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin: 6px 0; }
.qc-chip { font-size: 11px; padding: 1px 7px; border-radius: 9px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); }
.qc-chip b { font-weight: 600; }
.qc-line { font-family: var(--font-monospace); font-size: 11px; color: var(--text-muted); overflow-wrap: anywhere; margin: 4px 0; }
.qc-warn { color: var(--color-orange); font-size: 12px; }
.qc-help { font-size: 12px; color: var(--text-muted); }
.qc-help code { font-size: 11px; }
.qc-props { border-collapse: collapse; width: 100%; margin: 6px 0; }
.qc-props th, .qc-props td { text-align: left; vertical-align: top; padding: 3px 6px; border-bottom: 1px solid var(--background-modifier-border); }
.qc-props code { white-space: nowrap; line-height: 2; margin: 0 4px 0 0; padding: 1px 5px; border-radius: 4px; background: var(--code-background, var(--background-secondary)); }
.qc-props td:first-child { width: 8em; } .qc-props td:last-child { width: 28%; }
@media (max-width: 560px) { .qc-props thead { display: none; } .qc-props tr { display: block; padding: 4px 0; border-bottom: 1px solid var(--background-modifier-border); } .qc-props td, .qc-props td:first-child, .qc-props td:last-child { display: block; width: auto; border: 0; padding: 1px 0; } .qc-props td:last-child { color: var(--text-faint); } }
.qc-added { font-size: 12px; margin: 2px 0; cursor: pointer; }
.qc-added:hover { color: var(--text-accent); }
`);
const ta = h("textarea", { placeholder: "e.g. Call the dentist fri 14:00 30m !", rows: "1", "aria-label": "Type a task" }, root);
ta.value = KEEP.draft;
const preview = h("div", {}, root);
const bar = h("div", { class: "qc-row" }, root);
const add = h("button", { class: "mod-cta" }, bar, "Add");
h("span", { class: "qc-help" }, bar, "Enter adds · Shift+Enter for another task on a new line");
const help = h("details", { class: "qc-help" }, root);
h("summary", {}, help, "Available properties");
// one row per property: what it is, what you can type (no special keys needed), what lands in the task line
const ROWS = [
  ["Do on (plan)", "<code>today</code> <code>tomorrow</code> <code>fri</code> <code>next mon</code> <code>in 3 days</code> <code>24-10</code> <code>do 1-11</code>", "⏳ scheduled"],
  ["Deadline", "<code>due fri</code> <code>by 24-10</code> <code>deadline 1-11-2026</code>", "📅 due"],
  ["Start", "<code>start mon</code> <code>from 24-10</code> (hidden until then)", "🛫 start"],
  ["Time", "<code>14:00</code> <code>2pm</code> <code>9:30-11</code> <code>2-4pm</code> <code>at 14</code> <code>from 9 to 11</code>", "a block on the timeline (today if no day)"],
  ["Length", "<code>30m</code> <code>1h30</code> <code>2 h</code> <code>45 min</code> <code>for 1 hour</code>", "[est:: ]"],
  ["Priority", "<code>!</code> high, <code>!!</code> urgent, <code>!low</code>, or <code>prio high</code> <code>prio low</code>", "⏫ 🔺 🔽"],
  ["Price", "<code>12 eur</code> <code>price 12</code> <code>12.50</code> <code>12,50</code> <code>€12</code>", "[price:: ]"],
  ["Quantity", "<code>x3</code> <code>qty 3</code> <code>3 pcs</code>", "[qty:: ]"],
  ["Project", "<code>@cpmx</code> or <code>project cpmx</code>", "#project/… and goes into that note"],
  ["Person", "<code>+alex</code> or <code>with alex</code> (keeps the words)", "#p/…"],
  ["Area", `${AREA_KEYS.map(k => `<code>#${k}</code>`).join(" ")} or <code>area ${AREA_KEYS[0] || "work"}</code>`, "the area tag"],
  ["Repeat", "<code>every week</code> <code>every 2 days</code> <code>every monday</code> <code>every weekday</code>", "🔁"],
  ["Any field", "<code>shop:: ikea</code> <code>link:: \"some text\"</code>", "[shop:: ikea]"],
];
help.insertAdjacentHTML("beforeend", `<table class="qc-props"><thead><tr><th>Property</th><th>Type</th><th>Writes</th></tr></thead><tbody>${
  ROWS.map(([a, b, c]) => `<tr><td><b>${a}</b></td><td>${b}</td><td>${c}</td></tr>`).join("")}</tbody></table>
<p>Words in "quotes" always stay text, for example <code>"Friday meeting notes"</code>. On their own, <code>1-3</code> and <code>sun</code> stay text; write <code>do 1-3</code> or <code>on sun</code> for a date.</p>`);
const addedBox = h("div", {}, root);

const linesOf = () => ta.value.split("\n").map(s => s.trim()).filter(Boolean);
function showPreview() {
  KEEP.draft = ta.value;
  preview.replaceChildren();
  for (const text of linesOf()) {
    const p = parse(text);
    const row = h("div", { class: "qc-row" }, preview);
    const chip = (k, v) => { const c = h("span", { class: "qc-chip" }, row); h("b", {}, c, `${k} `); c.appendChild(document.createTextNode(v)); };
    if (p.startDate) chip("Start", dmy(p.startDate));
    if (p.date) chip("Do", dmy(p.date));
    if (p.start !== undefined) chip("Time", `${clock(p.start)} - ${clock(p.end)}`);
    if (p.due) chip("Due", dmy(p.due));
    if (p.est) chip("Length", p.est >= 60 ? `${Math.floor(p.est / 60)}h${p.est % 60 ? ` ${p.est % 60}m` : ""}` : `${p.est}m`);
    if (p.pri) chip("Priority", p.pri);
    if (p.project) chip("Project", p.project.name);
    if (p.person) chip("Person", p.person.name);
    if (p.price) chip("Price", `€${p.price}${p.qty ? ` x${p.qty}` : ""}`);
    else if (p.qty) chip("Qty", p.qty);
    if (p.repeat) chip("Repeats", p.repeat);
    for (const f of p.fields) chip("Field", f.slice(1, -1));
    chip("Goes to", p.target.label);
    h("div", { class: "qc-line" }, preview, p.line);
    for (const w of p.warnings) h("div", { class: "qc-warn" }, preview, w);
  }
  add.disabled = !linesOf().length;
}
async function commit() {
  const parsed = linesOf().map(parse).filter(p => p.title);
  if (!parsed.length) return;
  const groups = new Map();
  for (const p of parsed) { const k = `${p.target.path}|${p.target.heading}`; if (!groups.has(k)) groups.set(k, { target: p.target, items: [] }); groups.get(k).items.push(p); }
  for (const { target, items } of groups.values()) {
    if (await append(target, items.map(p => p.line))) for (const p of items) KEEP.added.unshift({ title: p.title, path: target.path, label: target.label });
  }
  KEEP.added = KEEP.added.slice(0, 5);
  notify(parsed.length === 1 ? `Added to ${parsed[0].target.label}` : `Added ${parsed.length} tasks`);
  ta.value = ""; KEEP.draft = "";
  grow(); showPreview(); showAdded(); ta.focus();
}
function showAdded() {
  addedBox.replaceChildren();
  if (!KEEP.added.length) return;
  h("div", { class: "qc-help", style: "margin-top:6px" }, addedBox, "Just added (click to open):");
  for (const a of KEEP.added) h("div", { class: "qc-added" }, addedBox, `✓ ${a.title}  →  ${a.label}`).addEventListener("click", () => app.workspace.openLinkText(a.path, "", false));
}
const grow = () => { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight + 2}px`; };
ta.addEventListener("input", () => { grow(); showPreview(); });
ta.addEventListener("keydown", ev => { if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); void commit(); } });
add.addEventListener("click", () => void commit());
// EX3C Agenda and Dataview redraw this box after every note change; if you were typing in it, keep typing.
ta.addEventListener("focus", () => { KEEP.focused = true; });
ta.addEventListener("blur", () => setTimeout(() => { if (ta.isConnected) KEEP.focused = false; }, 0)); // a redraw removes the box: not a real blur
if (KEEP.focused) setTimeout(() => { if (ta.isConnected) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 0);
grow(); showPreview(); showAdded();
window.__compassCaptureParse = parse; // for tests
