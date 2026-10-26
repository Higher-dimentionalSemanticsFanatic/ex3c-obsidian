# Built-in widgets

Each file here is one widget of the app: the planner, project steps, capture, purchases, calendars and the rest. They are DataviewJS views: the code gets `dv` (the Dataview API of the note or tab that draws it) and `input` (the options it was called with), exactly as with Dataview's `dv.view`.

## How they reach the app
`node scripts/bundle-views.mjs` embeds every file in `main.js` (the block at its end), so a release carries its own widgets. Edit the files here, never the block in `main.js`; the release workflow refuses a `main.js` that is out of date (`--check`). `--deploy <vault>` bundles and copies the plugin into a vault for testing.

## In the vault
`Meta/views/<name>.js` in the vault is a short stub that runs the built-in code, so notes and templates that call `await dv.view("Meta/views/<name>")` keep working and get updates with the plugin.

To change a widget for yourself, run the command **EX3C AgendA: Edit widget code** and pick it. The full code goes into `Meta/views/<name>.js` and from then on that copy runs, in the app and in notes; plugin updates no longer change it. **EX3C AgendA: Reset widget to built-in** puts the stub back and moves your copy to the trash.

## Conventions
- Settings come from `Meta/EX3C Agenda Config.md` (`dv.page("Meta/EX3C Agenda Config")`).
- Daily notes are named `YYYY-MM-DD` and live in the config's `daily_folder`.
- Daily questions are number properties named `<dq_prefix><name>` (1 to 10); habits are checkbox properties named `<habit_prefix><name>`.
- Wheel of life areas are number properties named `<wheel_prefix><name>` (1 to 10) in `<retreat_folder>/YYYY-QN Personal Retreat`.
- Views cannot import each other, so each one declares the helpers it needs. `moment` is global inside Obsidian.
- Dates on screen are day-month-year and times 24-hour; files, properties and task lines stay ISO.
