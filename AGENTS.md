# Repository Guidelines

## Project Overview

**samaritan** is a CLI bug-memory tool for AI agents. Agents record bugs and their resolutions in a project-local JSONL file, then search past issues via SQLite FTS5 full-text search. Distributed as an npm package with a `samaritan` binary.

## Architecture & Data Flow

```
samaritan (CLI)
  → commander parses args, --dir global flag
  → resolveProjectDir() walks up from cwd to find .samaritan/
  → Store opens: ensureDir → ensureSchema → resolveMergeConflicts → checkStaleness
  → Command logic runs (add/search/show/tag)
  → JSON written to stdout, errors to stderr as {"error":"..."}
```

**Storage model:**
- `issues.jsonl` — source of truth (one JSON object per line), version-controlled
- `issues.db` — SQLite + FTS5 virtual table, derived cache, gitignored
- Staleness: Store compares JSONL `mtime:size` fingerprint against DB `meta` table; rebuilds FTS5 on mismatch
- Merge conflicts: `resolveConflicts()` auto-accepts both sides by keeping valid JSON lines and discarding markers

**Key modules:**
| File | Role |
|---|---|
| `src/cli.ts` | Entry point, commander setup, registers subcommands |
| `src/store.ts` | Core data layer — JSONL I/O, FTS5 lifecycle, staleness, merge resolution |
| `src/merge.ts` | Pure function: resolve git conflict markers in JSONL text |
| `src/resolve.ts` | Walk-up directory discovery for `.samaritan/`; write vs. read semantics |
| `src/types.ts` | `Issue`, `SearchResult`, `ErrorOutput` interfaces |
| `src/commands/*.ts` | One file per subcommand — wires Store to CLI args |

**Two-audience principle:**
- `init` → human audience: interactive prompts (`@clack/prompts`), banner, spinner, friendly output
- `add`/`search`/`show`/`tag` → agent audience: flags → JSON on stdout, `{"error":"..."}` on stderr, deterministic exit codes

## Key Directories

| Path | Purpose |
|---|---|
| `src/` | All TypeScript source (compiled to `dist/`) |
| `src/commands/` | Subcommand definitions (one file per command) |
| `bin/` | Shebang entry point (`#!/usr/bin/env node`) |
| `test/` | Vitest test files (mirrors `src/` structure) |
| `docs/superpowers/` | Plans and design specs |
| `.vscode/`, `.zed/` | Editor settings (Biome formatter, TS LSP) |
| `.omp/` | Oh My Pi harness internals (ignore) |
| `.agents/` | Agent skill definitions |

## Development Commands

| Command | What it does |
|---|---|
| `npm run build` | `tsc` — compiles `src/` → `dist/` |
| `npm test` | `vitest run` — all tests, single pass |
| `npm run test:watch` | `vitest` — watch mode |
| `npm run check` | `ultracite check` — lint + format check (Biome under the hood) |
| `npm run fix` | `ultracite fix` — auto-format + lint fix |
| `npm run prepare` | `lefthook install` — git hooks |

Build before testing CLI tests (`test/cli.test.ts` shells out to `dist/cli.js`).

## Code Conventions & Common Patterns

- **ESM only** — `"type": "module"` in package.json; all imports use `.js` extensions
- **Strict TypeScript** — `strict: true`, all return types inferred where obvious, explicit where ambiguous
- **No classes except Store** — everything else is pure functions or procedural command registrations
- **Error handling:** Commands wrap logic in try/catch, emit `{"error": message}` to stderr, exit non-zero. `Store.update()` throws `IssueNotFoundError` (checked in `show` command)
- **JSONL as source of truth:** The SQLite FTS5 index is a cache. `readAll()` always reads from JSONL. `append()` writes JSONL then inserts to FTS5. `update()` rewrites entire JSONL then rebuilds FTS5
- **Synchronous I/O** — `better-sqlite3` is synchronous; `fs.readFileSync`, `fs.appendFileSync`, etc. No async needed
- **Command pattern:** Each command file exports one function (`addCommand`, `searchCommand`, etc.) that takes a `Command` instance and calls `.command().argument().option().action()`
- **FTS5 queries:** Phrase matching by default, boolean syntax supported. `search()` wraps FTS5 in try/catch — malformed queries return `[]` instead of throwing
- **JSON output:** All agent-facing commands write exactly one `JSON.stringify()` call to stdout, then `process.exit(0)`. No stray console.log

## Important Files

| File | Why it matters |
|---|---|
| `src/store.ts` | Central data layer — all persistence, indexing, staleness, merge logic |
| `src/cli.ts` | Entry point — add new commands here |
| `src/merge.ts` | Git conflict auto-resolution — stateless pure function, tested in isolation |
| `src/resolve.ts` | Project directory discovery — determines `.samaritan/` location |
| `src/types.ts` | Shared interfaces — `Issue`, `SearchResult`, `ErrorOutput` |
| `tsconfig.json` | Target ES2022, ESNext modules, bundler resolution, declaration + sourcemap |
| `vitest.config.ts` | Globals enabled, test include pattern `test/**/*.test.ts` |
| `biome.jsonc` | Extends `ultracite/biome/core` + `ultracite/biome/vitest` |
| `lefthook.yml` | Pre-commit: runs `ultracite fix` on staged JS/TS/JSON/CSS |

## Runtime & Tooling

- **Runtime:** Node ≥18 (no Bun dependency — pure Node with `better-sqlite3` native addon)
- **Package manager:** npm (lockfile is `package-lock.json`)
- **Formatter/Linter:** Biome via `ultracite` (thin wrapper). Config in `biome.jsonc` extends shared ultracite presets
- **Git hooks:** Lefthook runs `ultracite fix` on pre-commit; lint-staged configured for the same
- **Build:** `tsc` only — no bundler. Output in `dist/` mirrors `src/` structure
- **TypeScript:** Project references `node_modules` types, uses workspace TS version (VS Code + Zed both configured)

## Testing & QA

- **Framework:** Vitest with globals enabled (`describe`, `it`, `expect`, `beforeEach`, `afterEach` available without imports)
- **Test location:** `test/` directory, `*.test.ts` pattern
- **Test types:**
  - **Unit (`store.test.ts`):** Temp directory per test, exercises Store CRUD, FTS5 search, staleness rebuild, merge conflict auto-resolution
  - **Unit (`merge.test.ts`):** Pure function tests for `resolveConflicts` — normal, conflict, multi-block, garbage-in-conflict
  - **CLI integration (`cli.test.ts`):** Spawns `node dist/cli.js` in temp dirs, asserts JSON stdout/stderr and exit codes
- **No mocks** — all tests use real filesystem and real SQLite in temp directories
- **CI:** `prepublishOnly` runs `npm run build && npm test`
- **Coverage:** No explicit coverage tool configured — tests focus on behavioral correctness
