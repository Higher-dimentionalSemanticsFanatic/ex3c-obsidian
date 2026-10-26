// EX3C Agenda Setup status widget. Usage: await dv.view("Meta/views/setup")
// Detects what is still at its template default. Renders booleans only; never shows key values. Writes only when you press a button: this note's setup_sections_done and status properties.
const cur = dv.current() || {};
// The checks live in setup-checks.js, so the banner on Home counts exactly what this note shows.
const ex3c = app.plugins.plugins["ex3c-agenda"];
const checks = ex3c?.widgetCode ? await ex3c.widgetCode("setup-checks") : await app.vault.adapter.read("Meta/views/setup-checks.js");
const rows = await new (Object.getPrototypeOf(async function () {}).constructor)("dv", "app", "moment", "cur", checks)(dv, app, moment, cur);

// Render
// Tiers 0 to 2 are required; a required section is done when its required checks pass (or you mark it done).
// Optional sections (AI, browser) only appear while the AI module is installed and never hold setup open.
// When the three required sections are done, Finish sets status: done and the banner on Home goes away.
const REQUIRED = [0, 1, 2];
const SECTIONS = [0, 1, 2, 3, 4].filter(t => REQUIRED.includes(t) || rows.some(r => r.tier === t));
const tiers = { 0: "Tier 0: the app", 1: "Tier 1: make it yours", 2: "Tier 2: the practice", 3: "Tier 3: AI in the vault (optional)", 4: "Tier 4: browser and web (optional)" };
const optional = t => !REQUIRED.includes(t);
const passing = t => rows.filter(r => r.tier === t && !r.opt).every(r => r.ok);
const marked = new Set((Array.isArray(cur.setup_sections_done) ? cur.setup_sections_done : []).map(Number));
const isDone = t => marked.has(t) || passing(t);
const file = app.vault.getAbstractFileByPath(cur.file?.path || "00 Dashboards/Setup.md");
const setMarked = async (t, on) => {
  await app.fileManager.processFrontMatter(file, fm => {
    const list = new Set((Array.isArray(fm.setup_sections_done) ? fm.setup_sections_done : []).map(Number));
    if (on) list.add(t); else list.delete(t);
    fm.setup_sections_done = [...list].sort();
  });
  if (on) marked.add(t); else marked.delete(t);
  draw();
};
let status = cur.status;
const setStatus = async v => { await app.fileManager.processFrontMatter(file, fm => { fm.status = v; }); status = v; draw(); };
const root = dv.container.createEl("div", { cls: "lifeos-widget setup-sections" });
root.createEl("style", { text: `.setup-sections .ss-bar { height: 6px; border-radius: 3px; background: var(--background-modifier-border); overflow: hidden; margin: 4px 0 10px; }
.setup-sections .ss-bar > div { height: 100%; background: var(--interactive-accent); }
.setup-sections .ss-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 14px 0 4px; }
.setup-sections .ss-head h4 { margin: 0; }
.setup-sections .ss-state { font-size: 12px; color: var(--text-muted); }
.setup-sections .ss-state.is-done { color: var(--color-green); font-weight: 600; }
.setup-sections button { font-size: 12px; padding: 2px 10px; height: auto; }
.setup-sections details > summary { cursor: pointer; color: var(--text-muted); font-size: 12px; }
.setup-sections .ss-finish { padding: 10px 12px; border-radius: 8px; background: color-mix(in srgb, var(--color-green) 12%, var(--background-secondary)); display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }` });
function draw() {
root.querySelectorAll(":scope > :not(style)").forEach(e => e.remove());
if (status === "done") {
  const box = root.createEl("div", { cls: "ss-finish" });
  box.createEl("span", { text: "✅ Setup finished. The banner on Home is gone." });
  const re = box.createEl("button", { text: "Reopen setup" });
  re.addEventListener("click", () => void setStatus("open"));
} else {
  const doneCount = REQUIRED.filter(isDone).length;
  const total = rows.filter(r => r.tier <= 2 && !r.opt).length, req = rows.filter(r => r.tier <= 2 && !r.opt && r.ok).length;
  root.createEl("p", { text: `Required sections done: ${doneCount} of ${REQUIRED.length}. Required checks passing: ${req} of ${total}. Checks marked "later" and optional sections never hold setup open.` });
  root.createEl("div", { cls: "ss-bar" }).createEl("div", { attr: { style: `width:${100 * doneCount / REQUIRED.length}%` } });
  if (doneCount === REQUIRED.length) {
    const box = root.createEl("div", { cls: "ss-finish" });
    box.createEl("span", { text: "Every section is done." });
    const fin = box.createEl("button", { text: "Finish setup", cls: "mod-cta" });
    fin.addEventListener("click", () => void setStatus("done"));
  }
  for (const t of SECTIONS) {
    const list = rows.filter(x => x.tier === t), ok = list.filter(r => r.ok).length, all = ok === list.length;
    const head = root.createEl("div", { cls: "ss-head" });
    head.createEl("h4", { text: tiers[t] });
    head.createEl("span", { cls: `ss-state${isDone(t) ? " is-done" : ""}`, text: isDone(t) ? (all ? "Done" : `Done (${ok} of ${list.length} checks)`) : `${ok} of ${list.length} checks pass` });
    if (marked.has(t) || !passing(t)) {
      const btn = head.createEl("button", { text: marked.has(t) ? "Reopen" : optional(t) ? "Skip" : "Mark done anyway" });
      btn.addEventListener("click", () => void setMarked(t, !marked.has(t)));
    }
    // a done section folds away; open it again from its summary
    const holder = isDone(t) ? root.createEl("details") : root;
    if (isDone(t)) holder.createEl("summary", { text: "Show checks" });
    const table = holder.createEl("table", { cls: "lifeos-table" });
    const th = table.createEl("thead").createEl("tr"); for (const h of ["", "Item", "Where to fix", "Note"]) th.createEl("th", { text: h });
    const tb = table.createEl("tbody");
    for (const r of list) {
      const tr = tb.createEl("tr");
      tr.createEl("td", { text: r.ok ? "✅" : r.opt ? "◻️" : "⬜", attr: r.opt && !r.ok ? { title: "Later or nice to have: does not hold setup open" } : {} });
      tr.createEl("td", { text: r.item });
      const td = tr.createEl("td");
      const m = r.where.match(/^\[\[([^\]]+)\]\]/);
      if (m) { const a = td.createEl("a", { text: m[1], cls: "internal-link", attr: { href: m[1], "data-href": m[1] } }); a.addEventListener("click", e => { e.preventDefault(); app.workspace.openLinkText(m[1], "", false); }); td.appendText(r.where.slice(m[0].length)); }
      else td.setText(r.where);
      tr.createEl("td", { text: [r.opt ? "later / nice to have" : "", r.note].filter(Boolean).join("; ") });
    }
  }
}
}
draw();
