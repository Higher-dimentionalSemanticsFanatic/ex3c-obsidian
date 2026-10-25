# Changelog

## Unreleased
- Markdown dashboards retired: their shortcuts open the matching tab or are left out; All tasks opens in place on every tab; roll-up keeps nothing outside the notes (no data.json).
- Parent roll-up: ticking the last open step ticks its parent (✅, notice with Undo); ticking a parent with open steps asks; unticking reopens; rollup_parents in the config note.
- Widgets panel previews keep the scroll position; several at once, Show all previews.
- Page commands only for tabs in your layout; Open Brain opens the Brain view. AI tab never re-added while AI is removed.
- Area tabs: All <area> tasks opens the grouped full list under the card.
- Calendar links: the plugin fetches iCal addresses (requestUrl) for the Import calendars page and refreshes them at start-up; command Refresh calendar links.
- Work schedule widget on the Work tab (working hours, commute) for the planner.
- One colour per tab: its own colour (Configure, "Colour for this tab"), else its area colour, else the theme; the rail, the page and Configure show the same colour. Workflow colours are gone.
- Widgets panel: grouped by purpose, every widget listed once with a unique name (the nine "Open and act" widgets are now "<page> shortcuts"; duplicate Connected horizons and capture buttons merged), and a live read-only preview (eye button).
- Nine-tab default layout: Home (capture box, setup, Needs attention, planner, checklists), Check-in, Projects (Projects board fed by project notes), Work, Study, Personal, People, Library, Review. Plan, Focus and Unified Graph leave the default.
- Saved layouts pick up widgets added to the default later (layout `known` list), so new widgets reach existing vaults once.
- Needs attention also lists tasks due within 3 days, the same urgency the planner uses; task rows hide inline fields and ids.
- Setup banner counts the three required Setup sections with the Setup note's own checks (Meta/views/setup-checks.js); a section is done once its required checks pass.
- While the AI module is removed, Agent Client buttons in notes render as nothing instead of raw code.
- Area tabs: quick capture tags the tab's area; All <area> tasks expands in place. Workflow canvas redraws when a module is removed or restored.
- Name shown as EX3C AgendA; Home slogan "Executive function Operationalized".
- One colour rule: each page uses its area colour (Work, Study, Personal) or else the Theme colour, the same way everywhere: page title, background glow, active rail item, charts. Area pages are marked in the rail with their colour; workflow colours show only while editing. Obsidian's accent follows the page or note in front (a note with `area: work` takes the Work colour).
- Optional modules: while the AI module is removed, every AI entry point hides (Home status and Ask button, AI page and command, AI widgets, prompt buttons in notes). Remove records where everything went, so Restore can put it back.
- Setup banner shows progress by Setup section and offers Finish setup once every section is done.
- Checklists widget (reusable checklists); notes with `type: checklist` stay out of the task feeds.
- The app name is set in League Spartan Black (SIL Open Font License, `LeagueSpartan-OFL.txt`), embedded in styles.css so it works offline and on phones.
- Renamed to EX3C Agenda: plugin id `ex3c-agenda`, layout note `Meta/EX3C Agenda Layout.md`, calendar icon instead of the compass.
- App name: change the name shown in the rail, the header and the tab title in Configure (saved in the layout note).
- Optional modules widget.
- Workflow colours: every widget belongs to a workflow (capture, daily, planning, tasks, projects and study, review, people, writing and library, system, your widgets), shown on widgets in edit mode, in the Widgets panel (with a legend), on the tab rail and the tab chips.
- Standard pages you deleted can be added back from edit mode, with their standard widgets, in their usual place.
- Page icons: pick an icon for any tab from 40 icons in edit mode.
- Themes: six accent presets, and a colour per area (work, study, personal) so area tabs look different; optional tint on area pages. Saved in the layout note.

## 0.20.0 (19-10-2026)
First version in its own repository, split out of the vault so it can be updated without downloading the vault again. Same code as the copy in the vault on 19-10-2026: tabs and widgets from `Meta/Life OS Layout.md`, edit mode with the Widgets panel, area tabs (work, study, personal), your own widgets from `Meta/widgets/`, and the prototype widgets (quick capture, planner, project steps with Gantt, purchases, courses).
