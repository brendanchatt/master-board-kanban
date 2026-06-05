# Master Board Kanban Handoff

> See `~/development/ai-rules/handoff-rules.md` for how handoffs work.

## Current State

This is an early Obsidian plugin for recursive Kanban board rollups. The repo is at:

`/Users/brendanchatt/development/master-board-kanban`

The vault with real boards to inspect is at:

`/Users/brendanchatt/Documents/Documents - Mac/Obsidian/Higgaion`

The plugin has moved past the initial logging exploration. `README.md` and `DESIGN.md` describe the concept; the first implementation pass now includes configurable status aliases, a Kanban markdown parser, recursive child-board rollup analysis, a dry-run inspect command, a manual sync command, and automatic debounced sync when board files change.

## Product Direction

Any card in an Obsidian Kanban board can itself represent another Kanban board when it links to a note with `kanban-plugin: board` frontmatter.

The core behavior is not primarily progress text. The important behavior is:

1. Detect cards that link to child Kanban boards.
2. Compute each child board's aggregate progress/state.
3. Move the parent card to the parent board list that matches the child state.
4. Repeat upward so board status rolls through parent boards.

Optional later polish: update parent card text with progress counts/percentages. That was discussed and accepted as possibly useful, but it was not the original core idea.

## Important Design Decision

Use a small status model rather than hardcoding exact list names like `Backlog / Active / Done`.

Statuses should map to configurable list-name aliases:

- `parked`
- `todo`
- `active`
- `nearlyDone`
- `done`

The plugin should compute a child board status, then find the best matching destination column on the parent board using aliases.

## Existing Vault Vocabulary

Real board headings found in the vault include:

- Parked/index/category-ish: `Other Boards`, `Sub boards`, `Verticals`, `Stuff`, `Feature priorities`, `Back burner`, `Future`, `consider`, `thoughts`, `table`, `relevant notes`
- Todo/planned: `todo`, `ToDo`, `To do`, `Todo`, `tasks`, `Issue`, `Issues`
- Started/active: `Just started`, `Started`, `Workin on it`, `doing`, `Doing`, `in progress`, `In progress`, `In Progress`, `Current`
- Nearly done: `Just about done`, `I think this is done?`
- Done: `done`, `Done`, `Completed`, `completed`, `resolved`, `Resolved`

Important nuance: not every list is a workflow state. Some lists are category/holding areas, such as `Sub boards`, `Other Boards`, `thoughts`, `table`, `Bugs`, and `Feature priorities`. Do not automatically treat those as destinations unless configured.

Representative boards inspected:

- `Higgaion/Higgaion.md`
- `Sunsync/Sunsync.md`
- `AaaS/AaaS.md`
- `Other Development/obsidian/MasterBoard Plugin.md`
- `Misc/Reused/Kanban/Kanban Template General.md`
- `SpamMe/SpamMe.md`
- `Reformed Christian/Reformed Christian.md`
- `AaaS/MyRestaurant/UI-UX/UI-UX.md`

## Configuration Plan

Support configuration in layers:

1. Plugin settings tab: global defaults for status aliases and thresholds.
2. Board frontmatter: per-board overrides.
3. Hidden Markdown config block: maybe later only if frontmatter becomes painful.

Recommended frontmatter shape:

```yaml
---
kanban-plugin: board
master-board:
  enabled: true
  columns:
    todo:
      - todo
      - Future
      - Back burner
    active:
      - Workin on it
      - Just started
      - In progress
    nearlyDone:
      - Just about done
    done:
      - Completed
  thresholds:
    nearlyDone: 0.75
---
```

Global settings should provide defaults like:

```typescript
{
  columns: {
    parked: ["back burner", "future", "thoughts"],
    todo: ["todo", "to do", "tasks", "issue", "issues", "stuff"],
    active: ["doing", "in progress", "current", "started", "workin on it"],
    nearlyDone: ["just about done", "i think this is done"],
    done: ["done", "completed", "resolved"]
  },
  thresholds: {
    nearlyDone: 0.75,
    done: 1
  }
}
```

## Current Repo Notes

- `manifest.json` already has id `master-board-kanban`.
- `package.json`, `package-lock.json`, `manifest.json`, and `versions.json` are aligned to `0.1.0`.
- `main.ts` now registers the settings tab, `Inspect current board rollups`, `Sync current board rollups`, and automatic sync listeners.
- New source files:
  - `src/settings.ts`: defaults, frontmatter override merging, alias matching, destination-column lookup.
  - `src/kanban.ts`: Markdown parser for headings/cards/wiki links.
  - `src/rollup.ts`: recursive rollup analysis, dry-run inspection, parent-card movement, board detection, and parent-board discovery.
- Automatic sync:
  - listens for Markdown `modify` events
  - schedules sync for the changed board if it is a Kanban board
  - finds and schedules parent Kanban boards that link to the changed file
  - uses a debounce from settings, default `1200ms`
  - shows a notice when automatic sync moves cards, unless disabled in settings
- `node_modules` has been installed.
- `main.js` was generated by `npm run build`, but it is ignored by git in the sample-plugin scaffold.
- Built files have been copied into the vault plugin folder:
  - `/Users/brendanchatt/Documents/Documents - Mac/Obsidian/Higgaion/.obsidian/plugins/master-board-kanban/main.js`
  - `/Users/brendanchatt/Documents/Documents - Mac/Obsidian/Higgaion/.obsidian/plugins/master-board-kanban/manifest.json`
  - `/Users/brendanchatt/Documents/Documents - Mac/Obsidian/Higgaion/.obsidian/plugins/master-board-kanban/styles.css`
- Git state before this session already had `README.md` modified and `DESIGN.md` untracked.

## Verification

- `npm run build` passes.
- `npx eslint main.ts src/*.ts` passes.

## Next Steps

1. Reload Obsidian or toggle the plugin off/on so it picks up the latest copied `main.js`.
2. Open the sample folder at `MasterBoard Samples/`.
3. Move/add/check cards in a child board such as `MBK Sample Alpha.md`.
4. Parent cards in `MasterBoard Sample Parent.md` should update automatically shortly afterward.
5. Inspect the changed Markdown after syncing; use Obsidian Git/history to review.
6. Tune aliases/thresholds if cards move to surprising columns.
7. Add tests or fixture-based parser checks before making automation more aggressive.

## Safety Notes

Be conservative with writes. The current sync command moves top-level Kanban cards and preserves their nested lines, but it should be tested on real boards before adding automatic background sync.

Avoid circular recursion: track visited board paths while computing rollups.

Do not use `HANDOFF.md` as permanent documentation. Move durable design decisions into `DESIGN.md` or `README.md` once they stabilize.
