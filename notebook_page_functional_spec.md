# Notebook Page — Functional Specification

A reference for rebuilding the Notebook page. Describes what the page does, not how the current code is structured.

---

## Overview

The Notebook is a two-pane note-taking interface: a sidebar listing all notes and a main editor pane. Notes are plain Markdown stored in a SQLite `notes` table. The editor renders Markdown inline (WYSIWYG-like) with a fallback raw-source mode.

---

## Data Model

```sql
CREATE TABLE notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL DEFAULT 'Untitled',
    content    TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- `title` is stored separately from `content` so the sidebar can list notes without loading full content.
- `updated_at` is updated on every save; used for relative timestamps in the sidebar.

---

## API Contract

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/notes` | — | `[{id, title, updated_at}, …]` ordered by `updated_at DESC` |
| GET | `/api/notes/:id` | — | `{id, title, content, updated_at}` |
| POST | `/api/notes` | `{title}` | `{id}` (201) |
| PUT | `/api/notes/:id` | `{title, content}` | 200 |
| DELETE | `/api/notes/:id` | — | 200 |

---

## Sidebar Behavior

- Lists all notes ordered most-recently-updated first.
- Each row shows: note title (truncated with ellipsis) + relative timestamp (`today`, `yesterday`, `Nd ago`, or `Mon D`).
- The active note is highlighted with a left accent border.
- Hovering a row reveals a delete (✕) button; clicking it shows a `window.confirm` dialog before calling DELETE.
- A "+ New Note" button at the top calls POST, receives the new `id`, and immediately selects that note.

---

## Editor Modes

### Block Editor (default)

The note body is parsed into **blocks** at render time. Blocks are never persisted as separate entities — the underlying data is always a single Markdown string; blocks are a view-layer concept derived on each render.

**Block types:**

| Type | Detection rule |
|---|---|
| `heading` | Line starts with `#` through `######` followed by a space |
| `code` | Starts with ` ``` `; spans until the next closing ` ``` ` line |
| `blank` | One or more consecutive empty lines; stored as N-1 `\n` characters |
| `paragraph` | Everything else; may span multiple non-empty, non-special lines |

**View state:**

- Exactly one block can be **active** (in edit mode) at a time. All others render as Markdown.
- Clicking a rendered block activates it, replacing it with a `<textarea>` pre-filled with its raw Markdown.
- Clicking outside the active block (or pressing Escape) **commits** the edit: the textarea value is written back into the block, the full content string is reconstructed, and save is scheduled.
- The active textarea auto-resizes vertically to fit its content.
- Pressing Enter (without Shift) in a non-code block commits the current block and activates the next non-blank block. If there is no next block, it opens the **new-block input** at the bottom.

**New-block input:**

- A dedicated textarea appended after all blocks.
- Activated when the user clicks the empty area below the last block, or when Enter is pressed in the last block.
- Pressing Enter commits the text as new content appended to the note (with a double-newline separator if needed), then clears the input and keeps focus for another block.
- Pressing Escape or blurring commits whatever is typed (if non-empty) and closes the input.

**Collapsible headings:**

- Every heading block has a small triangle toggle button (▼/▶) to its left.
- Collapsing a heading hides all following blocks until the next heading of equal or lesser depth.
- Collapsed state is local UI state; it resets whenever a different note is opened.

### Raw Source Mode

A toggle button in the title bar switches between **Block Editor** and **Raw Source** mode.

- Raw Source shows the entire note content in a single full-height `<textarea>` with monospace font.
- Allows normal multi-line selection, cut/paste, and bulk edits that are awkward block-by-block.
- Escape in Raw Source returns to Block Editor.
- Both modes share the same `content` state; switching is lossless.

---

## Title Editing

- The note title is an inline `<input>` in the header bar, always editable.
- Changes to the title trigger the same auto-save as content changes.

---

## Auto-Save

- Save is debounced: 1500 ms after the last change to `title` or `content`, a PUT request fires.
- A status indicator in the title bar shows three states:
  - `✓ Saved` (green) — in sync with server
  - `⟳ Saving…` (orange) — request in flight
  - `● Unsaved` (muted) — pending debounce or failed save
- On successful save the sidebar note list is refreshed (to update the `updated_at` timestamp).

---

## Keyboard Shortcuts (in editor)

| Key | Context | Action |
|---|---|---|
| `Escape` | Active block | Commit and deactivate block |
| `Enter` | Active non-code block | Commit block, move to next / open new-block input |
| `Shift+Enter` | Any block | Insert literal newline (no special action) |
| `Tab` | Any textarea | Insert two spaces at cursor position |
| `Escape` | Raw Source mode | Return to Block Editor |

---

## Auto-Pair Characters

These characters auto-insert their closing counterpart when typed:

| Character | Behavior |
|---|---|
| `(` | Always pairs → `()` |
| `[` | Always pairs → `[]` |
| `` ` `` | Always pairs → ` `` ` |
| `*` | Pairs **only when text is selected** → wraps selection in `**` |

When text is selected and a pairing character is typed, the selection is wrapped rather than replaced.

---

## Right-Click Context Menu

Right-clicking anywhere in the editor (block or new-block textarea) opens a small context menu with two insert actions:

- **Insert Markdown Table** — inserts a 3-column GFM table template at the cursor position.
- **Insert Code Block** — inserts a ` ```python … ``` ` template.

Both actions are appended to the current active block content (or to the end of the note if no block is active). The menu is dismissed on any outside click.

---

## Markdown Rendering

Uses `react-markdown` with the `remark-gfm` plugin. Supported syntax:

- Headings (h1–h6)
- Bold, italic, strikethrough
- Unordered and ordered lists
- Blockquotes
- Inline code and fenced code blocks
- GFM tables
- Horizontal rules
- Links (open in new tab)

Code blocks in view mode show a **language label** and a **Copy** button (top-right corner). Clicking the copy button copies the code content (without the fence lines) to the clipboard and briefly shows "✓ Copied".

---

## Footer Bar

Shown below the editor when a note is open:

- Word count (splits on whitespace)
- Character count
- Hint text describing available shortcuts (changes between Block Editor and Raw Source mode)

---

## Empty States

- **No note selected**: centered placeholder with an emoji, title, and prompt to create or select a note.
- **Empty note body**: placeholder text "Start writing… (click or type a heading with #)". Clicking it seeds the content with `# ` and activates the first block.
- **No notes in sidebar**: "No notes yet." message.
