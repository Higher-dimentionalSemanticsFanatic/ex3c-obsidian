// Birthdays from people notes. Usage: await dv.view("Meta/views/birthdays")
// Reads the birthday property of every person note (type: person, or a note in 05 People): 1990-03-14, or 03-14 when
// you do not know the year. Lists the coming birthdays with the age they turn; "Present" puts a task in the person's
// note a week before (⏳) with the birthday as its due date (📅). The planner shows birthdays on their day.
const DAYS_AHEAD = input?.days ?? 365, SHOW = input?.limit ?? 8;
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date(); today.setHours(12, 0, 0, 0);
const parseBirthday = v => { const m = String(v ?? "").trim().match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/); return m ? { y: m[1] ? +m[1] : null, mo: +m[2], d: +m[3] } : null; };
const people = dv.pages().where(p => (String(p.type ?? "") === "person" || p.file.path.startsWith("05 People/")) && !p.file.path.startsWith("Templates/") && !(p.file.tags ?? []).includes("#example")).array();
const list = [];
for (const p of people) {
  const b = parseBirthday(p.birthday?.toISODate ? p.birthday.toISODate() : p.birthday);
  if (!b) continue;
  let next = new Date(today.getFullYear(), b.mo - 1, b.d, 12);
  if (next < today) next = new Date(today.getFullYear() + 1, b.mo - 1, b.d, 12);
  const days = Math.round((next - today) / 86400000);
  if (days <= DAYS_AHEAD) list.push({ p, next: iso(next), days, age: b.y ? next.getFullYear() - b.y : null });
}
list.sort((a, b) => a.days - b.days);
const root = dv.container.createEl("div", { cls: "bday" });
root.createEl("style", { text: `.bday { font-size: 13px; } .bday h4 { margin: 0 0 4px; } .bday-row { display: flex; gap: 8px; align-items: center; padding: 4px 0; border-top: 1px solid var(--background-modifier-border); }
.bday-row .n { flex: 1; cursor: pointer; } .bday-row .w { color: var(--text-muted); font-size: 12px; white-space: nowrap; } .bday-row.is-soon .w { color: var(--text-accent); font-weight: 600; }
.bday-sub { color: var(--text-muted); font-size: 12px; } .bday button { font-size: 12px; padding: 1px 8px; height: auto; }` });
root.createEl("h4", { text: "Birthdays" });
if (!list.length) { root.createEl("p", { cls: "bday-sub", text: "No birthdays yet. Give a person note the property birthday: 1990-03-14 (or 03-14 without the year)." }); return; }
const dm = s => `${s.slice(8, 10)}-${s.slice(5, 7)}`;
for (const x of list.slice(0, SHOW)) {
  const row = root.createEl("div", { cls: `bday-row${x.days <= 7 ? " is-soon" : ""}` });
  row.createEl("span", { text: "🎂" });
  const n = row.createEl("span", { cls: "n", text: `${x.p.file.name}${x.age ? ` turns ${x.age}` : ""}` });
  n.addEventListener("click", () => app.workspace.openLinkText(x.p.file.path, "", false));
  row.createEl("span", { cls: "w", text: x.days === 0 ? "today" : x.days === 1 ? "tomorrow" : `${dm(x.next)} · in ${x.days} days` });
  const before = new Date(`${x.next}T12:00:00`); before.setDate(before.getDate() - 7);
  const plan = iso(before < today ? today : before);
  const has = x.p.file.tasks.some(t => !t.completed && /present|gift|cadeau/i.test(t.text) && String(t.text).includes(x.next));
  const b = row.createEl("button", { text: has ? "Present ✓" : "Present", attr: { title: has ? "A present task for this birthday is in their note" : `Adds "- [ ] Present for ${x.p.file.name} ⏳ ${plan} 📅 ${x.next}" to their note` } });
  if (has) b.disabled = true;
  else b.addEventListener("click", async () => {
    const f = app.vault.getAbstractFileByPath(x.p.file.path);
    await app.vault.process(f, d => `${d.trimEnd()}\n- [ ] Present for ${x.p.file.name} ⏳ ${plan} 📅 ${x.next}\n`);
    b.textContent = "Present ✓"; b.disabled = true;
  });
}
if (list.length > SHOW) root.createEl("div", { cls: "bday-sub", text: `and ${list.length - SHOW} more in the coming year.` });
