# EX3C Agenda

The home surface of the vault (its name is yours to change in Configure): tabs of widgets for today, planning, projects, study, people, library and review, over plain Markdown notes. Local-first; nothing leaves the vault.

## Install
The plugin is made for the EX3C Agenda vault (https://github.com/Higher-dimentionalSemanticsFanatic/EX3C-AgendA-Vault), which already carries it in `.obsidian/plugins/ex3c-agenda`. To install or update it on its own:
- **BRAT** (Obsidian community plugin "Beta Reviewers Auto-update Tool"): Add beta plugin, then paste `Higher-dimentionalSemanticsFanatic/ex3c-obsidian`. BRAT then updates the plugin whenever a new release is published.
- **By hand:** download `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/ex3c-agenda/`, then reload Obsidian.

## What the plugin expects in the vault
- `Meta/EX3C Agenda Layout.md`: the tabs and their widgets (made on first use, edited with Configure).
- `Meta/EX3C Agenda Config.md`: daily questions, habits and folders.
- `Meta/widgets/*.js`: your own widgets (optional).
- Dataview with JavaScript queries on: the widgets are DataviewJS views.
- `Meta/views/<name>.js`: stubs that let notes embed a widget with `dv.view("Meta/views/<name>")`. A file there that is not a stub is your own copy and runs instead of the built-in code.

## Widgets
The widget code lives in `views/` (see `views/README.md`) and is bundled into `main.js` with `node scripts/bundle-views.mjs`, so an update of the plugin updates the widgets. Edit `views/`, never the generated block at the end of `main.js`; the release workflow checks that the block is current. In Obsidian, **Edit widget code** copies a widget into the vault for your own changes and **Reset widget to built-in** goes back.

## Release
Raise `version` in `manifest.json`, add it to `versions.json` with the minimum Obsidian version, note it in `CHANGELOG.md`, commit, then tag the commit with the same version and push the tag. The release workflow attaches the files.

## Credits and licence
EX3C Agenda is a rework of the Compass vault template by Daniel Agrici (https://github.com/AgriciDaniel/compass), itself an agentic rework of Mike Schmitz's Practical PKM vault. The code is under the MIT License (`LICENSE`), whose copyright notice stays with the original authors. Open source, no account, no paid tier.

## Font
The app name uses League Spartan Black by The League Spartan Project Authors, under the SIL Open Font License 1.1 (`LeagueSpartan-OFL.txt`), embedded in `styles.css`.
