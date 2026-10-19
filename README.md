# EX3C Agenda

The home surface of the vault (its name is yours to change in Configure): tabs of widgets for today, planning, projects, study, people, library and review, over plain Markdown notes. Local-first; nothing leaves the vault.

## Install
This repository is private. Two ways in:
- **BRAT** (Obsidian community plugin "Beta Reviewers Auto-update Tool"): add this repository; for a private repository BRAT needs a GitHub token with read access. BRAT then updates the plugin whenever a new release is published.
- **By hand:** download `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/ex3c-agenda/`, then reload Obsidian.

## What the plugin expects in the vault
- `Meta/EX3C Agenda Layout.md`: the tabs and their widgets (made on first use, edited with Configure).
- `Meta/EX3C Agenda Config.md`: daily questions, habits and folders.
- `Meta/widgets/*.js`: your own widgets (optional).
- Dataview with JavaScript queries on. The prototype widgets still load their views from the vault's `Prototypes/` folder; they move into the plugin as they graduate.

## Release
Raise `version` in `manifest.json`, add it to `versions.json` with the minimum Obsidian version, note it in `CHANGELOG.md`, commit, then tag the commit with the same version and push the tag. The release workflow attaches the files.
