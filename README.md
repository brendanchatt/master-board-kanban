# Master Board Kanban

Infinite drill-down kanban boards for Obsidian. Boards link to sub-boards; card moves sync between levels.

## The Problem

Standard kanban: flat. One board, one set of columns. To organize complex work, you either:
- Cram everything onto one board (chaos)
- Split into separate boards (lose the big picture)

## The Solution

**Master boards** that aggregate cards from linked sub-boards.

```
Master Board (Higgaion.md)
├── "Other Boards" column shows: [[Sunsync]], [[AaaS]]
│   └── Each is itself a kanban board
├── Cards from sub-boards appear here, rolled up
└── Move a card here → it moves in the sub-board
```

### How It Works

1. A master board links to sub-boards in frontmatter or as cards
2. Plugin reads each sub-board's columns and cards
3. Renders aggregated view on the master
4. Card moves propagate bidirectionally

### Infinite Nesting

Any card can be a board. Drill down forever:

```
Life Board
└── Projects Board
    └── SpamMe Board
        └── App Board
            └── Push Notifications Board
                └── Individual tasks
```

Move "Push Notifications" to Done on the App Board → it moves on SpamMe Board → it moves on Projects Board.

## Current State

First working MVP. The plugin automatically watches board changes and syncs affected parent boards:

- `Inspect current board rollups` reports proposed board-card moves without editing the file.
- `Sync current board rollups` moves linked board-cards into the parent list that matches each child board's rollup status.
- Automatic sync runs after a board file changes, including when a child board card is moved, added, deleted, checked, or edited.

Automatic sync is enabled by default with a short debounce. Manual sync remains available from the command palette.

## Usage

1. Enable `MasterBoard (Kanban)` in Obsidian.
2. Create a parent Kanban card that links to a child Kanban board, such as `[[Sunsync]]`.
3. Move, add, delete, check, or edit cards on the child board.
4. Parent boards that link to that child board sync automatically after the debounce delay.

For a one-off manual sync, run `Sync current board rollups` on the parent board. For a non-writing preview, run `Inspect current board rollups`.

## Architecture (Planned)

```
┌─────────────────────────────────────────────────┐
│                   Master Board                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐         │
│  │ Backlog │  │ Active  │  │  Done   │         │
│  ├─────────┤  ├─────────┤  ├─────────┤         │
│  │ [[Sub1]]│  │ [[Sub2]]│  │ [[Sub3]]│         │
│  │  └─3 cards│ │  └─5 cards│ │  └─2 cards│      │
│  └─────────┘  └─────────┘  └─────────┘         │
└─────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
    ┌─────────┐   ┌─────────┐   ┌─────────┐
    │  Sub1   │   │  Sub2   │   │  Sub3   │
    │ (board) │   │ (board) │   │ (board) │
    └─────────┘   └─────────┘   └─────────┘
```

## Key Challenges

1. **Parsing**: obsidian-kanban stores boards as markdown (## headings = columns, - [ ] items = cards)
2. **Rendering**: Need to intercept/extend kanban rendering or build custom view
3. **Sync**: Write changes back to source files when cards move
4. **Performance**: Watching multiple files for changes

## Development

```bash
npm install
npm run dev
```

Copy to `.obsidian/plugins/master-board-kanban/` and enable in Obsidian.

## Related

- [obsidian-kanban](https://github.com/mgmeyers/obsidian-kanban) - The kanban plugin this extends
- [Dataview](https://github.com/blacksmithgu/obsidian-dataview) - For querying across files
