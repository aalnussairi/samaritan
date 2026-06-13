# Samaritan CLI — Design Spec

## Overview

`samaritan` is a CLI tool for agents to store and search bug memories. Agents record bugs and their resolutions in a project-local JSONL file. When an agent encounters a bug, it searches for similar past issues using FTS5 full-text search. The tool is distributed via npm and consumed as a CLI.

## Storage Model

### File Layout

```
<project>/.samaritan/
  issues.jsonl     # source of truth, version-controlled
  issues.db        # SQLite + FTS5 index, gitignored
  .gitignore       # contains "issues.db"
```

- `issues.jsonl` — one JSON object per line. Human-readable, git-friendly, merges cleanly on additions.
- `issues.db` — SQLite database with an FTS5 virtual table for full-text search. Derived from `issues.jsonl` and rebuilt when the source changes.
- `.gitignore` — created by `samaritan init` to keep the index out of version control.

### Data Shape

Each issue is a single JSON object on one line:

```json
{
  "id": "a1b2c3d4",
  "title": "Null pointer in auth middleware",
  "description": "Happens when session token is expired and...",
  "resolution": "Added null check before accessing req.session.user",
  "tags": ["auth", "null-pointer", "express"],
  "created": "2026-06-13T10:30:00Z"
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string | Auto-generated, 8-char hex |
| `title` | string | Brief summary, FTS5-indexed |
| `description` | string | Full description, FTS5-indexed |
| `resolution` | string | How the bug was fixed, FTS5-indexed |
| `tags` | string[] | Flat list of tags, exact-match filterable |
| `created` | string | ISO 8601 timestamp, set at creation |

FTS5 index covers the concatenation: `title + " " + description + " " + resolution`.

### Sync & Staleness

The FTS5 index is derived from `issues.jsonl`. To detect when the source has changed (e.g., hand-edits, `git pull`, merge resolution):

- On startup, the store records the JSONL file's `mtime` and `size` from the last index build.
- Before executing any command, samaritan compares current `mtime`/`size` against the stored values.
- If they differ, the FTS5 index is rebuilt from scratch before the command proceeds.
- The index is a cache — the JSONL is authoritative.


### Merge Conflicts
JSONL is line-per-issue, so independent additions merge cleanly in git. Conflicts only arise when two agents modify the same line.

- When a git merge produces conflict markers in `issues.jsonl`, samaritan auto-resolves them on the next command by accepting both sides of the conflict.
- Both changes are kept as separate lines (since each valid side is a complete JSON record). Conflict markers and any non-JSON lines are discarded.
- After resolving, samaritan rewrites `issues.jsonl` with the merged result and rebuilds the FTS5 index.
- This means samaritan never requires manual conflict resolution — agents can run any command after a merge and the store will be consistent.

## Commands

All commands accept a global `--pretty` flag for human-readable terminal output. All commands accept `--dir <path>` to specify the project root (default: discovered by walking up from `cwd` looking for `.samaritan/`).

### `samaritan init`

Creates the `.samaritan/` directory, an empty `issues.jsonl`, an empty `issues.db`, and a `.gitignore` containing `issues.db`. Idempotent — safe to run when already initialized.

### `samaritan add <title> <description>`

```
samaritan add "Null pointer in auth" "Happens when session token expires"
  --tags auth,null-pointer,express
  --resolution "Added null check"
```

- Generates an 8-char hex `id`.
- Sets `created` to current UTC timestamp.
- Appends the record as a single JSON line to `issues.jsonl`.
- Rebuilds the FTS5 index incrementally (appends the new issue's text).
- Prints the created record.
- `--tags` is optional (comma-separated). `--resolution` is optional.
- Auto-creates `.samaritan/` if absent (implicit init).

### `samaritan search <query>`

```
samaritan search "null pointer"
  --tag auth
  --limit 10
```

- Runs an FTS5 match query. Phrase matching is the default behavior; boolean syntax (`AND`, `OR`, `NOT`, parenthesized groups) is supported.
- Results are ranked by BM25 relevance, highest first.
- Default limit is 10. Overridable with `--limit`.
- `--tag` is optional. When provided, results are AND-filtered: must match both the full-text query AND the exact tag.
- An empty query with `--tag` returns the most recent issues matching that tag (top-N by creation date, limited by `--limit`).
- Output is a condensed view per result: id, title, tags, and an FTS5 snippet with matched terms highlighted.

### `samaritan show <id>`

Prints the full record for a single issue by id. All fields: id, title, description, resolution, tags, created. Exits non-zero if the id is not found.

### `samaritan tag <id> <tags...>`

```
samaritan tag a1b2c3d4 auth null-pointer express
```

- Sets (replaces) tags on the identified issue.
- Modifies the line in `issues.jsonl` and triggers a full FTS5 rebuild.
- Prints the updated record.
- Exits non-zero if the id is not found.

## Output Format

**JSON mode (default):** Each command prints a single JSON object (or array for search results) to stdout. Errors print a JSON object to stderr with `{ "error": "<message>" }`.

**Pretty mode (`--pretty`):** Human-readable formatting with labels and whitespace. Exact format TBD during implementation.

## CLI Architecture

### Dependencies

- `better-sqlite3` — synchronous SQLite with FTS5 support
- `commander` — CLI argument parsing

No other runtime dependencies.

### Internal Structure

```
  cli.ts          # commander setup, --pretty/--dir global flags
  store.ts        # JSONL I/O, FTS5 lifecycle, staleness detection
  commands/
    init.ts
    add.ts
    search.ts
    show.ts
    tag.ts
bin/
  samaritan       # shebang entry point, invokes cli.ts
```

### Command Flow

1. Resolve project directory (walk up from cwd looking for `.samaritan/`, or use `--dir`).
2. Open store: auto-create `.samaritan/` + files if absent, check staleness, rebuild FTS5 if needed.
3. Execute command logic.
4. Print result.

### Project Directory Discovery

For commands that need a project directory (`add`, `search`, `show`, `tag`), samaritan walks up from the current working directory until it finds a `.samaritan/` directory. If none is found and the command writes data (`add`, `tag`), it auto-creates `.samaritan/` in the current directory. If none is found and the command is read-only (`search`, `show`), it reports an error suggesting `samaritan init`.

`init` always creates in the current directory unless `--dir` is specified.

## Testing

- **Unit tests:** Store operations — JSONL read/write round-trips, FTS5 rebuild, staleness detection, merge-conflict auto-resolution.
- **CLI snapshot tests:** Command invocations against a temp `.samaritan/` directory, verifying both JSON and pretty output.

- Test runner: `vitest` or `bun test`.

## Companion Skill

A skill document at `skill://samaritan` describes how agents should use the tool: when to search, how to interpret results, how to record resolutions. This is authored separately from the CLI implementation.

## Non-Goals for v1

- `resolve` command (agents set resolution at add time via `--resolution`)
- Deduplication logic (agent's responsibility)
- Config files (zero-config)
- Remote sync or sharing beyond git
- Incremental FTS5 updates on tag changes (full rebuild is acceptable at this scale)
