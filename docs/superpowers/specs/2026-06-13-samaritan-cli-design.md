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


## Design Principle: Two Audiences

`samaritan` has two audiences with opposing needs — the design treats them as separate concerns:

| | `init` | All other commands |
|---|---|---|
| **Audience** | Human developer | Agent (code) |
| **Goal** | Delight, guide, confirm | Minimal, deterministic, parseable |
| **Interaction** | Interactive wizard | Flag → JSON → exit |
| **Output** | Rich terminal UI | Machine-readable JSON |
| **Errors** | Friendly styled messages | Structured JSON on stderr |

There is no `--json` or `--pretty` flag. The audience is baked into which command runs.

### `samaritan init`

The single human touchpoint. Not a flag wielding command — a guided experience.

Accept `--dir <path>` to target a different project root. Without it, uses the current working directory.

**Interactive flow:**

1. **Welcome** — tool name, version, one-line description ("Record and search bug memories for your project")
2. **Prompt** — "Initialize samaritan in `<path>`?" → default Yes (enter to confirm, n to cancel)
3. **Progress** — spinner creating each artifact: `.samaritan/`, `issues.jsonl`, `issues.db`, `.gitignore`
4. **Success** — green checkmark, path summary, next-steps hint: "Use `samaritan add` to record your first bug"

If the directory is already initialized, show "Already initialized" with the path and exit 0 — no re-prompt, no re-creation.

**Implementation:** Use a lightweight interactive prompt library (e.g. `@clack/prompts`). The init command is the only place this dependency is imported.

### `samaritan add <title> <description>`

```
samaritan add "Null pointer in auth" "Happens when session token expires"
  --tags auth,null-pointer,express
  --resolution "Added null check"
```

- Generates an 8-char hex `id`, sets `created` to current UTC timestamp.
- Appends the record as a single JSON line to `issues.jsonl`.
- Appends to the FTS5 index (single-row insert, not full rebuild).
- Prints the full created record as JSON to stdout.
- `--tags` optional (comma-separated). `--resolution` optional.
- Auto-creates `.samaritan/` if absent (implicit init).

**Output (stdout):**

```json
{"id":"a1b2c3d4","title":"Null pointer in auth","description":"Happens when session token expires","resolution":"Added null check","tags":["auth","null-pointer","express"],"created":"2026-06-13T10:30:00Z"}
```

### `samaritan search <query>`

```
samaritan search "null pointer" --tag auth --limit 5
```

- Runs FTS5 match query. Phrase matching default; boolean syntax (`AND`, `OR`, `NOT`, parenthesized groups) supported.
- Results ranked by BM25 relevance, highest first.
- Default limit 10, overridable via `--limit`.
- `--tag` optional. When provided, AND-filtered: must match full-text query AND exact tag.
- Empty query with `--tag` returns top-N most recent issues matching the tag (by creation date).

**Output (stdout):** JSON array of condensed results. Empty array when nothing found.

```json
[{"id":"a1b2c3d4","title":"Null pointer in auth middleware","tags":["auth","null-pointer"],"snippet":"...Null pointer in <b>auth</b> middleware..."}]
```

Each result: `id`, `title`, `tags`, `snippet` (FTS5 snippet with `<b>` highlight markers).

### `samaritan show <id>`

```
samaritan show a1b2c3d4
```

**Output (stdout):** Full record as JSON.

```json
{"id":"a1b2c3d4","title":"Null pointer in auth","description":"Happens when session token expires","resolution":"Added null check","tags":["auth","null-pointer","express"],"created":"2026-06-13T10:30:00Z"}
```

**Error (stderr, exit 1):**

```json
{"error":"issue not found: deadbeef"}
```

### `samaritan tag <id> <tags...>`

```
samaritan tag a1b2c3d4 auth null-pointer express
```

- Sets (replaces) tags on the identified issue.
- Modifies the line in `issues.jsonl`.
- Triggers full FTS5 rebuild (tag-only changes need reindex).
- Prints the updated record as JSON to stdout.

**Output (stdout):**

```json
{"id":"a1b2c3d4","tags":["auth","null-pointer","express"]}
```

**Error (stderr, exit 1):**

```json
{"error":"issue not found: deadbeef"}
```

## Error Contract (Agent-Facing Commands)

Every agent-facing command (`add`, `search`, `show`, `tag`) follows the same error protocol:

- Non-zero exit code (1 for not found, 2 for invalid input, etc.)
- JSON error object on stderr: `{"error":"<message>"}`
- Stdout empty on error
- Agents check exit code first, parse stderr for details

`init` errors use friendly terminal output instead — a human is reading.

## CLI Architecture

### Dependencies

- `better-sqlite3` — synchronous SQLite with FTS5 support
- `commander` — CLI argument parsing
- `@clack/prompts` — interactive prompts for `init` command only

No other runtime dependencies.

### Internal Structure

```
  cli.ts          # commander setup, --dir global flag
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
- **CLI snapshot tests:** Command invocations against a temp `.samaritan/` directory, verifying JSON output (stdout) and error output (stderr).
- **Test runner:** `vitest` or `bun test`.


## Companion Skill

A skill document at `skill://samaritan` describes how agents should use the tool: when to search, how to interpret results, how to record resolutions. This is authored separately from the CLI implementation.

## Non-Goals for v1

- `resolve` command (agents set resolution at add time via `--resolution`)
- Deduplication logic (agent's responsibility)
- Config files (zero-config)
- Remote sync or sharing beyond git
- Incremental FTS5 updates on tag changes (full rebuild is acceptable at this scale)
