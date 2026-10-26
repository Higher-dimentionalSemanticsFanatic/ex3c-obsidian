// EX3C Agenda setup checks, shared by the Setup note (Meta/views/setup.js) and the setup banner on Home.
// Runs as the body of an async function(dv, app, moment, cur) and returns the rows; cur is the Setup note's properties.
// Reads settings only; never shows key values; writes nothing.
// tier: 0 the app, 1 make it yours, 2 the practice (these three are required), 3 AI, 4 browser and web (optional).
// opt: a check that is nice to have but does not hold its section open (goals that take weeks, cosmetic settings).
const cfg = dv.page("Meta/EX3C Agenda Config") || {};
const rows = [];
const add = (tier, item, ok, where, note, opt = false) => rows.push({ tier, item, ok: !!ok, where, note: note || "", opt });
const readJson = async p => { try { return JSON.parse(await app.vault.adapter.read(p)); } catch (e) { return null; } };
const readText = async p => { try { const f = app.vault.getAbstractFileByPath(p); return f ? await app.vault.cachedRead(f) : ""; } catch (e) { return ""; } };
const enabled = id => { try { return app.plugins.enabledPlugins.has(id); } catch (e) { return false; } };
const pset = id => { try { return app.plugins.plugins[id]?.settings || null; } catch (e) { return null; } };
const today = moment();
const aiOn = app.plugins.plugins["ex3c-agenda"]?.aiOn?.() !== false;

// Tier 0: the app
for (const [id, name] of [["ex3c-agenda", "EX3C Agenda"], ["dataview", "Dataview"], ["templater-obsidian", "Templater"], ["periodic-notes", "Periodic Notes"], ["quickadd", "QuickAdd"], ["obsidian-tasks-plugin", "Tasks"], ["obsidian-kanban", "Kanban"]])
  add(0, `${name} plugin enabled`, enabled(id), "Settings → Community plugins");
add(0, "Day Planner plugin enabled (timeline and week view)", enabled("obsidian-day-planner"), "Settings → Community plugins", "the planner works without it", true);
add(0, "EX3C Agenda application command registered", !!app.commands.findCommand("ex3c-agenda:open-home"), "Command palette → EX3C Agenda: Open EX3C Agenda home");
add(0, "Dataview JavaScript queries on", !!(pset("dataview")?.enableDataviewJs), "Settings → Dataview");
add(0, "CSS snippet ex3c-agenda on (callout colours)", (() => { try { return app.customCss.enabledSnippets.has("ex3c-agenda"); } catch (e) { return false; } })(), "Settings → Appearance → CSS snippets", "cosmetic", true);
add(0, "Periodic Notes daily folder matches config", (() => { const pn = pset("periodic-notes"); return !!pn && pn.daily?.folder === (cfg.daily_folder || "01 Journal/Daily") && /Daily Note\.md$/.test(pn.daily?.template || ""); })(), "Settings → Periodic Notes");
add(0, "Templater triggers on new files", (() => { const t = pset("templater-obsidian"); return !!t && (t.trigger_on_file_creation === true || t.trigger_on_file_creation_mode === "folder"); })(), "Settings → Templater");
add(0, "QuickAdd captures available as commands", (() => { const ch = pset("quickadd")?.choices || []; return ["Journal entry", "Log a win", "Gratitude", "Add task"].every(n => ch.find(c => (c.name || "").includes(n))?.command === true); })(), "Settings → QuickAdd (lightning icon per choice)");
add(0, "Hotkeys for today's note and the questions prompt", (() => { try { const hk = app.hotkeyManager.customKeys || {}; return ["quickadd:choice:lifeos-daily", "templater-obsidian:Templates/Daily Questions Prompt.md"].every(id => (hk[id] || []).length > 0); } catch (e) { return false; } })(), "Settings → Hotkeys");

// Tier 1: make it yours
const theme = await readText("03 Planning/Life Theme.md");
add(1, "Life theme written", theme.length > 0 && !theme.includes("Replace this line with your life theme"), "[[Life Theme]]");
const values = await readText("03 Planning/Core Values.md");
add(1, "Core values written", values.length > 0 && !/\*\*Value one\*\*/.test(values), "[[Core Values]]");
add(1, "Ideal week is yours (example property removed)", !((dv.page("03 Planning/Ideal Week") || {}).example === true), "[[Ideal Week]]", "fill the grid, then delete the example property");
add(1, "Questions, habits, wheel areas reviewed", Array.isArray(cfg.questions) && cfg.questions.length > 0 && Array.isArray(cfg.habits) && cfg.habits.length <= 5, "[[EX3C Agenda Config]]", Array.isArray(cfg.habits) && cfg.habits.length > 5 ? "more than 5 habits; keep 3 to 5 per season" : "");
const examples = dv.pages("#example").length;
add(1, "Example notes deleted", examples === 0, "Setup → Optional modules → Examples → Remove, or delete notes tagged example", examples ? `${examples} example notes remain` : "");
add(1, "Backup of the vault folder exists (self-declared)", cur.setup_backup === true, "copy the folder somewhere else, then tick setup_backup in this note's properties", "", true);

// Tier 2: the practice (the first days; the long-run goals are listed but do not hold setup open)
const daily = cfg.daily_folder || "01 Journal/Daily";
const dqp = cfg.dq_prefix || "dq_";
const real = dv.pages(`"${daily}"`).where(p => /^\d{4}-\d{2}-\d{2}$/.test(p.file.name) && !(p.tags || []).includes("example")).array();
add(2, "A daily note exists", real.length > 0, "Ctrl/Cmd+Shift+D");
const answered = real.filter(p => Object.entries(p.file.frontmatter || {}).some(([k, v]) => k.startsWith(dqp) && v !== null && v !== "" && v !== undefined));
const last30 = answered.filter(p => today.diff(moment(p.file.name), "days") < 30).length;
add(2, "First real daily questions answered", answered.length > 0, "Ctrl/Cmd+Shift+Q tonight, or the Check-in tab");
add(2, "A weekly note exists", dv.pages(`"${cfg.weekly_folder || "01 Journal/Weekly"}"`).where(p => !(p.tags || []).includes("example")).length > 0, "Command palette: Periodic Notes: Open weekly note", "from week 2", true);
add(2, "Days answered in the last 30 (goal 25)", last30 >= 25, "keep going", `${last30}/30`, true);
add(2, "A personal retreat note exists for this quarter", !!dv.page(`${cfg.retreat_folder || "02 Retreats"}/${today.format("YYYY-[Q]Q")} Personal Retreat`), "Guide: Personal Retreat workflow", "from day 60", true);

// Tier 3: AI in the vault (optional; only while the AI module is installed)
if (aiOn) {
  add(3, "Agent Client plugin enabled", enabled("agent-client"), "Settings → Community plugins");
  const ac = await readJson(".obsidian/plugins/agent-client/data.json");
  const configuredCommands = Object.values(ac?.presetAgents || {}).map(p => p?.command || "").filter(Boolean);
  const isLinux = navigator.userAgent.includes("Linux") && !navigator.userAgent.includes("Android");
  add(3, "At least one local agent path set in Agent Client", configuredCommands.some(cmd => !isLinux || cmd.startsWith("/")), "Settings → Agent Client → choose an agent → Auto-detect", "on Linux Flatpak use the full path to the wrapper");
  add(3, "Agent login done (self-declared)", cur.setup_claude_login === true, "tick setup_claude_login in this note's properties", "the property name is kept for older vaults");
  add(3, "Obsidian MCP server registered for your agent (self-declared)", cur.setup_mcp_registered === true, "Guide: Obsidian MCP Bridge, then tick setup_mcp_registered");
  add(3, "Agent Client has had a conversation", (ac?.savedSessions || []).length > 0, "[[Assistant]]");
  // Tier 4: browser and web (optional; the REST API belongs to the AI module)
  add(4, "Local REST API enabled", enabled("obsidian-local-rest-api"), "Settings → Community plugins");
  const ra = await readJson(".obsidian/plugins/obsidian-local-rest-api/data.json");
  add(4, "REST API key generated (never shown here)", typeof ra?.apiKey === "string" && ra.apiKey.length > 0 && ra?.enableInsecureServer === true, "Settings → Local REST API");
  add(4, "Web viewer core plugin on", (() => { try { return app.internalPlugins.plugins.webviewer?.enabled === true; } catch (e) { return false; } })(), "Settings → Core plugins");
}
return rows;
