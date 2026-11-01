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
  const out = { text: [], tags: [], fields: [], warnings: [], notes: [] };
  // weekdays: "mon tue fri" or "mon-fri" without every = one task per day; with every = one task that repeats on those days
  const wdays = [], everyDays = [];
  // the syntax the task line uses is understood too: ⏳ 2026-10-30, 📅, 🛫, ⏫ 🔺 🔽, 🔁 every week, 10:00 - 11:00
  const PRI_EMOJI = { "🔺": "!!", "⏫": "!", "🔼": "!med", "🔽": "!low", "⏬": "!lowest" }, DATE_EMOJI = { "⏳": "do", "📅": "due", "🛫": "start" };
  input = input
    .replace(/(^|\s)(\d{1,2}:\d{2})\s+-\s+(\d{1,2}:\d{2})(?=\s|$)/g, "$1$2-$3")
    .replace(/(⏳|📅|🛫)\uFE0F?\s*(\d{4})-(\d{2})-(\d{2})/gu, (all, e, y, m, d) => ` ${DATE_EMOJI[e]} ${d}-${m}-${y} `)
    .replace(/🔁\uFE0F?\s*/gu, " ")
    .replace(/[🔺⏫🔼🔽⏬]\uFE0F?/gu, e => ` ${PRI_EMOJI[e.replace(/\uFE0F/, "")]} `);
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
  // weekdays starting at toks[i]: [[day indexes], tokensUsed]. "mon", "mon-fri", "mon to fri", "mon,wed,fri"
  const isDay = x => /^[a-z]+$/.test(x) ? dayIndex(x) : -1;
  const span = (a, b) => { const r = []; for (let k = a; ; k = (k + 1) % 7) { r.push(k); if (k === b || r.length > 7) break; } return r; };
  const daysAt = i => {
    const raw = (toks[i] || "").toLowerCase().replace(/[;.]$/, "");
    const parts = raw.split(",").filter(Boolean);
    const one = x => /^[a-z]+-[a-z]+$/.test(x) && x.split("-").every(y => isDay(y) >= 0) ? span(isDay(x.split("-")[0]), isDay(x.split("-")[1])) : isDay(x) >= 0 ? [isDay(x)] : null;
    if (parts.length > 1 && parts.every(one)) return [parts.flatMap(one), 1];
    const w = low(i);
    if (/^[a-z]+-[a-z]+$/.test(w) && one(w)) return [one(w), 1];
    if (isDay(w) >= 0 && ["to", "till", "until", "-"].includes(low(i + 1)) && isDay(low(i + 2)) >= 0) return [span(isDay(w), isDay(low(i + 2))), 3];
    if (isDay(w) >= 0) return [[isDay(w)], 1];
    return null;
  };
  let lastLen = false;
  for (let i = 0; i < toks.length; i++) {
    const raw = toks[i], w = low(i), n1 = low(i + 1), n2 = low(i + 2);
    const wasLen = lastLen; lastLen = false;
    if (/^".*"$/.test(raw)) { out.text.push(raw.slice(1, -1)); continue; }
    // dates after a word: "do fri" (⏳), "due 24-10" / "by fri" (📅), "start 1-11" (🛫)
    const kd = DO.includes(w) ? "date" : DUE.includes(w) ? "due" : START.includes(w) ? "startDate" : null;
    if (kd && dateAt(i + 1, true)) { const [d, n] = dateAt(i + 1, true); out[kd] = d; i += n; continue; }
    // repeat on weekdays: "every mon wed fri", "every mon-fri", "every tue and thu"
    if (w === "every" && daysAt(i + 1)) {
      let j = i + 1, got;
      while ((got = daysAt(j)) || (["and", "&", "+"].includes(low(j)) && daysAt(j + 1))) { if (!got) { j++; continue; } everyDays.push(...got[0]); j += got[1]; }
      out.repeat = "every week"; i = j - 1; continue;
    }
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
    // weekdays on their own: one is a date (the coming one); several make one task per day, unless a repeat came first
    const wd = daysAt(i);
    if (wd && (w !== "sun" || wdays.length || everyDays.length || daysAt(i + 1) || (i > 0 && daysAt(i - 1)))) {
      (out.repeat === "every week" ? everyDays : wdays).push(...wd[0]); i += wd[1] - 1;
      if (["and", "&", "+"].includes(low(i + 1)) && daysAt(i + 2)) i++; // "mon and thu": the and goes with the days
      continue;
    }
    // a date on its own: today, fri, next mon, in 3 days, 24-10 (writes ⏳)
    const d = dateAt(i, false);
    if (d) { out.date = d[0]; i += d[1] - 1; continue; }
    // the tags the task line uses for a project and a person route the task the same way as @ and +
    if (/^#project\/[\w-]+$/.test(raw)) { const p = match(PROJECTS, raw.slice(9)); out.project = p || { name: raw.slice(9), slug: slug(raw.slice(9)), path: null }; if (!p) out.warnings.push(`No project note matches "${raw.slice(9)}": the task gets the tag and goes to the inbox.`); continue; }
    if (/^#p\/[\w-]+$/.test(raw)) { const p = match(PEOPLE, raw.slice(3)); out.person = p || { name: raw.slice(3), slug: slug(raw.slice(3)) }; continue; }
    if (/^#[\w/-]+$/.test(raw)) { out.tags.push(raw); continue; }
    out.text.push(raw);
  }
  // weekdays: the coming one (for a repeat today counts), listed in week order from Monday
  const NAMES = DAYS.map(x => x[0].toUpperCase() + x.slice(1));
  const upcoming = (k, incl) => iso(addDays(base, (k - base.getDay() + 7) % 7 || (incl ? 0 : 7)));
  const uniq = a => [...new Set(a)].sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7));
  if (everyDays.length) {
    const ks = uniq(everyDays);
    out.repeat = ks.length === 1 ? `every ${DAYS[ks[0]]}` : ks.join() === "1,2,3,4,5" ? "every weekday" : `every week on ${ks.map(k => NAMES[k]).join(", ")}`;
    if (!out.date && !out.due) out.date = ks.map(k => upcoming(k, true)).sort()[0];
  } else if (wdays.length === 1) {
    if (!out.date) out.date = upcoming(wdays[0], false);
  } else if (wdays.length > 1) {
    const ks = uniq(wdays);
    if (out.repeat) out.warnings.push(`Several days and a repeat: write "every ${ks.map(k => DAYS[k].slice(0, 3)).join(" ")}" to repeat on these days.`);
    else if (!out.date) {
      out.dates = ks.map(k => upcoming(k, false)).sort();
      out.date = out.dates[0];
      out.notes.push(`${out.dates.length} tasks, one for each day. For one task that repeats on these days every week, start with every: "every ${ks.map(k => DAYS[k].slice(0, 3)).join(" ")}".`);
    }
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
  // a study task is 🔺 highest unless you gave it a priority ("prio normal" keeps it without one)
  const isStudy = out.tags.some(t => t.toLowerCase() === "#study") || (!typedArea && projectArea === "study");
  if (out.pri === undefined && isStudy) out.pri = "🔺";
  if (out.pri) bits.push(out.pri);
  if (out.repeat) bits.push(`🔁 ${out.repeat}`);
  // the Tasks plugin only repeats a task that has a date, so a repeat without one starts on its first day
  // and a repeat on a weekday starts on the first such day (a time alone means today, which may be the wrong day)
  if (out.repeat && !out.due && !everyDays.length) {
    const d = out.date ? new Date(`${out.date}T12:00:00`) : new Date(base), wd = DAYS.findIndex(x => out.repeat === `every ${x}`);
    if (wd >= 0) d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7));
    else if (out.repeat === "every weekday") while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    out.date = iso(d);
  }
  bits.push(`➕ ${iso(base)}`);
  if (out.startDate) bits.push(`🛫 ${out.startDate}`);
  const lineOn = date => `- [ ] ${[...bits, date ? `⏳ ${date}` : "", out.due ? `📅 ${out.due}` : ""].filter(Boolean).join(" ")}`;
  out.title = title;
  out.lines = (out.dates || [out.date]).map(lineOn);
  out.line = out.lines[0];
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
.qc-props td:first-child { width: 8em; } .qc-props td:last-child { width: 30%; }
.qc-ins { cursor: pointer; } .qc-ins:hover, .qc-ins:focus-visible { color: var(--text-accent); outline: 1px solid var(--interactive-accent); }
.qc-note { color: var(--text-faint); }
.qc-props { table-layout: fixed; } .qc-props td { overflow-wrap: anywhere; } .qc-props code.qc-ins { display: inline-block; white-space: normal; } .qc-props td:last-child .qc-note { display: block; font-size: 11px; }
@media (max-width: 560px) { .qc-props, .qc-props tbody { display: block; table-layout: auto; } .qc-props colgroup, .qc-props thead { display: none; } .qc-props tr { display: block; padding: 4px 0; border-bottom: 1px solid var(--background-modifier-border); } .qc-props td, .qc-props td:first-child, .qc-props td:last-child { display: block; width: auto; border: 0; padding: 1px 0; } .qc-props td:last-child::before { content: "writes "; color: var(--text-faint); } }
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
h("p", { style: "margin:4px 0" }, help, "Type the words, or click any example to put it in the box. Both ways end up as the syntax on the right.");
// one row per property: what it is, what you can type (no special keys needed), the syntax it writes in the task line.
// An example is [shown text, text to insert]; a string inserts itself.
const TOMORROW_ISO = iso(addDays(today(), 1));
const ROWS = [
  ["Do on (plan)", ["today", "tomorrow", "fri", "next mon", "in 3 days", "24-10", "do 1-11"], "", [`⏳ ${TOMORROW_ISO}`], "scheduled"],
  ["Deadline", ["due fri", "by 24-10", "deadline 1-11-2026"], "", [`📅 ${TOMORROW_ISO}`], "due"],
  ["Start", ["start mon", "from 24-10"], "hidden until then", [`🛫 ${TOMORROW_ISO}`], "start"],
  ["Time", ["14:00", "2pm", "9:30-11", "2-4pm", "at 14", "from 9 to 11"], "", ["10:00 - 11:00"], "at the start; today if no day"],
  ["Length", ["30m", "1h30", "2 h", "45 min", "for 1 hour"], "", ["[est:: 30m]"], ""],
  ["Priority", [["!", "!"], ["!!", "!!"], "!low", "prio high", "prio low"], "! high, !! urgent", ["🔺", "⏫", "🔼", "🔽", "⏬"], "urgent to lowest"],
  ["Price", ["12 eur", "price 12", "12.50", "12,50", "€12"], "price of one", [["[price:: 12]", "[price:: ]"]], ""],
  ["Quantity", ["x3", "qty 3", "3 pcs"], "", [["[qty:: 3]", "[qty:: ]"]], ""],
  ["Project", [["@name", "@"], ["project name", "project "]], "a project note's name", [["#project/name", "#project/"]], "and goes into that note"],
  ["Person", [["+name", "+"], ["with name", "with "]], "keeps the words", [["#p/name", "#p/"]], ""],
  ["Area", [...AREA_KEYS.map(k => `#${k}`), `area ${AREA_KEYS[0] || "work"}`], "", AREA_KEYS.map(k => `#${k}`), ""],
  ["Repeat", ["every week", "every 2 days", "every monday", "every weekday", "every mon wed fri"], "several days without every: one task per day", ["🔁 every week"], ""],
  ["Your own field", [["shop:: ikea", "shop:: "], ["link:: https://…", "link:: https://"]], "any name you make up, then :: and the value", [["[shop:: ikea]", "[shop:: ]"], ["[link:: https://…]", "[link:: https://]"]], "the purchases list shows and sorts by them"],
];
// put text into the box at the cursor; the cursor lands where the value goes (in [price:: ] before the ], on a date: the date selected)
function insert(text) {
  const s0 = ta.selectionStart ?? ta.value.length, e0 = ta.selectionEnd ?? s0;
  const before = ta.value.slice(0, s0), after = ta.value.slice(e0);
  const open = /::/.test(text) && text.endsWith("]");
  const glue = /[@+/]$|:: (https:\/\/)?$|\s$/.test(text); // the value is typed right after it
  const pre = before && !/\s$/.test(before) ? " " : "", post = glue || /^\s/.test(after) ? "" : " ";
  ta.value = before + pre + text + post + after;
  const at = before.length + pre.length, d = text.match(/\d{4}-\d{2}-\d{2}/);
  let cs, ce;
  if (open) cs = ce = at + text.length - 1; // inside [name:: ]
  else if (d) { cs = at + d.index; ce = cs + 10; }
  else cs = ce = at + text.length + post.length;
  ta.focus(); ta.setSelectionRange(cs, ce); grow(); showPreview();
}
const codes = (parent, list) => {
  for (const ex of list) {
    const [shown, ins] = Array.isArray(ex) ? ex : [ex, ex];
    const c = h("code", { class: "qc-ins", role: "button", tabindex: "0", title: `Click to add ${ins.trim() || shown}` }, parent, shown);
    c.addEventListener("mousedown", e => e.preventDefault()); // keep the cursor where it is in the box
    c.addEventListener("click", () => insert(ins));
    c.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); insert(ins); } });
  }
};
const tbl = h("table", { class: "qc-props" }, help);
const cg = h("colgroup", {}, tbl); h("col", { style: "width:7.5em" }, cg); h("col", {}, cg); h("col", { style: "width:34%" }, cg);
const hr = h("tr", {}, h("thead", {}, tbl));
for (const t of ["Property", "Type", "Writes (syntax)"]) h("th", {}, hr, t);
const tb = h("tbody", {}, tbl);
for (const [name, typed, typedNote, syntax, syntaxNote] of ROWS) {
  const tr = h("tr", {}, tb);
  h("b", {}, h("td", {}, tr), name);
  const t1 = h("td", {}, tr); codes(t1, typed); if (typedNote) h("span", { class: "qc-note" }, t1, ` ${typedNote}`);
  const t2 = h("td", {}, tr); codes(t2, syntax); if (syntaxNote) h("span", { class: "qc-note" }, t2, ` ${syntaxNote}`);
}
help.insertAdjacentHTML("beforeend", `<p>Words in "quotes" always stay text, for example <code>"Friday meeting notes"</code>. On their own, <code>1-3</code> and <code>sun</code> stay text; write <code>do 1-3</code> or <code>on sun</code> for a date. To change a task later, right-click it in the planner (on a phone: press and hold it, then let go) and pick <b>Edit task</b>, or put the cursor on it in a note and run <b>Tasks: Create or edit task</b>. Its Fields section sets the length, price, shop, link and your own fields.</p>`);
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
    if (p.dates) chip("Do", p.dates.map(dmy).join(", "));
    else if (p.date) chip("Do", dmy(p.date));
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
    for (const l of p.lines) h("div", { class: "qc-line" }, preview, l);
    for (const n of p.notes) h("div", { class: "qc-help" }, preview, n);
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
    if (await append(target, items.flatMap(p => p.lines))) for (const p of items) KEEP.added.unshift({ title: p.lines.length > 1 ? `${p.title} (${p.lines.length} days)` : p.title, path: target.path, label: target.label });
  }
  KEEP.added = KEEP.added.slice(0, 5);
  const count = parsed.reduce((n, p) => n + p.lines.length, 0);
  notify(count === 1 ? `Added to ${parsed[0].target.label}` : `Added ${count} tasks`);
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
