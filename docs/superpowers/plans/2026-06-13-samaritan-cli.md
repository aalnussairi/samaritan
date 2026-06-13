# Samaritan CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `samaritan` CLI — a bug-memory tool for agents. Stores issues in a project-local JSONL file with FTS5 search. Human-friendly `init` wizard; all other commands are JSON I/O for agents.

**Architecture:** TypeScript CLI distributed via npm. `better-sqlite3` for SQLite+FTS5, `commander` for arg parsing, `@clack/prompts` for the `init` wizard only. Store module owns JSONL I/O, FTS5 index lifecycle, staleness detection, and merge-conflict auto-resolution. Each command is a separate module wired through a shared CLI entry point.

**Tech Stack:** TypeScript, Node (>=18), better-sqlite3, commander, @clack/prompts, vitest

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `bin/samaritan`
- Create: `src/types.ts`
- Create: `src/cli.ts` (stub)

- [ ] **Step 1: Initialize package.json**

```bash
mkdir -p bin src src/commands test
```

Write `package.json`:

```json
{
  "name": "samaritan",
  "version": "0.1.0",
  "description": "Bug memory CLI for agents — store and search issue resolutions with FTS5",
  "type": "module",
  "bin": {
    "samaritan": "./bin/samaritan"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "commander": "^12.0.0",
    "@clack/prompts": "^0.7.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm install
```

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 4: Write vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 5: Write bin/samaritan entry point**

```bash
#!/usr/bin/env node
import '../dist/cli.js';
```

Make executable:

```bash
chmod +x bin/samaritan
```

- [ ] **Step 6: Write src/types.ts**

```typescript
export interface Issue {
  id: string;
  title: string;
  description: string;
  resolution: string;
  tags: string[];
  created: string;
}

export interface SearchResult {
  id: string;
  title: string;
  tags: string[];
  snippet: string;
}

export interface ErrorOutput {
  error: string;
}
```

- [ ] **Step 7: Write stub src/cli.ts**

```typescript
#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('samaritan')
  .description('Bug memory CLI for agents')
  .version('0.1.0');

program.parse();
```

- [ ] **Step 8: Verify build compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts bin/samaritan src/types.ts src/cli.ts
git commit -m "feat: scaffold samaritan project with types and stub CLI"
```

---

### Task 2: Store Module — JSONL I/O and FTS5

**Files:**
- Create: `src/store.ts`
- Create: `test/store.test.ts`

The store module owns all file I/O for `.samaritan/`. It reads/writes `issues.jsonl`, manages the SQLite FTS5 index in `issues.db`, detects staleness, and handles auto-creation.

- [ ] **Step 1: Write the failing test for Store.open (creates files when absent)**

Write `test/store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Store } from '../src/store.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Store', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samaritan-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .samaritan directory, issues.jsonl, issues.db, and .gitignore when absent', () => {
    const store = new Store(tmpDir);

    expect(fs.existsSync(path.join(tmpDir, '.samaritan'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.samaritan', 'issues.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.samaritan', 'issues.db'))).toBe(true);
    const gitignore = fs.readFileSync(path.join(tmpDir, '.samaritan', '.gitignore'), 'utf-8');
    expect(gitignore).toContain('issues.db');
    store.close();
  });

  it('reads empty issues from fresh store', () => {
    const store = new Store(tmpDir);
    const issues = store.readAll();
    expect(issues).toEqual([]);
    store.close();
  });

  it('appends an issue and reads it back', () => {
    const store = new Store(tmpDir);
    const issue = {
      id: 'a1b2c3d4',
      title: 'Null pointer',
      description: 'Happens on expired token',
      resolution: 'Add null check',
      tags: ['auth'],
      created: '2026-06-13T10:30:00Z',
    };
    store.append(issue);
    const issues = store.readAll();
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('a1b2c3d4');
    expect(issues[0].title).toBe('Null pointer');
    store.close();
  });

  it('updates a line by id', () => {
    const store = new Store(tmpDir);
    store.append({
      id: 'a1b2c3d4',
      title: 'Null pointer',
      description: 'Happens on expired token',
      resolution: 'Add null check',
      tags: ['auth'],
      created: '2026-06-13T10:30:00Z',
    });
    store.update('a1b2c3d4', { tags: ['auth', 'crash'] });
    const issues = store.readAll();
    expect(issues[0].tags).toEqual(['auth', 'crash']);
    store.close();
  });

  it('update throws for unknown id', () => {
    const store = new Store(tmpDir);
    expect(() => store.update('nope', { tags: [] })).toThrow('issue not found: nope');
    store.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/store.test.ts
```
Expected: FAIL — `Store` not defined.

- [ ] **Step 3: Write minimal Store implementation**

Write `src/store.ts`:

```typescript
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Issue } from './types.js';

const SAMARITAN_DIR = '.samaritan';
const JSONL_FILE = 'issues.jsonl';
const DB_FILE = 'issues.db';

export class Store {
  private db: Database.Database;
  private dir: string;
  private jsonlPath: string;
  private dbPath: string;

  constructor(projectRoot: string) {
    this.dir = path.join(projectRoot, SAMARITAN_DIR);
    this.jsonlPath = path.join(this.dir, JSONL_FILE);
    this.dbPath = path.join(this.dir, DB_FILE);
    this.ensureDir();
    this.db = new Database(this.dbPath);
    this.ensureSchema();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
    if (!fs.existsSync(this.jsonlPath)) {
      fs.writeFileSync(this.jsonlPath, '', 'utf-8');
    }
    const gitignorePath = path.join(this.dir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, 'issues.db\n', 'utf-8');
    }
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS issues_fts USING fts5(
        id UNINDEXED,
        title,
        description,
        resolution,
        tags UNINDEXED,
        created UNINDEXED,
        tokenize='porter unicode61'
      );
    `);
  }

  readAll(): Issue[] {
    const content = fs.readFileSync(this.jsonlPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim() !== '');
    return lines.map(line => JSON.parse(line) as Issue);
  }

  append(issue: Issue): void {
    const line = JSON.stringify(issue) + '\n';
    fs.appendFileSync(this.jsonlPath, line, 'utf-8');
    this.insertFts(issue);
  }

  update(id: string, fields: Partial<Pick<Issue, 'tags'>>): Issue {
    const issues = this.readAll();
    const index = issues.findIndex(i => i.id === id);
    if (index === -1) {
      throw new Error(`issue not found: ${id}`);
    }
    Object.assign(issues[index], fields);
    this.writeAll(issues);
    this.rebuildFts(issues);
    return issues[index];
  }

  private writeAll(issues: Issue[]): void {
    const lines = issues.map(i => JSON.stringify(i)).join('\n') + '\n';
    fs.writeFileSync(this.jsonlPath, lines, 'utf-8');
  }

  private insertFts(issue: Issue): void {
    const stmt = this.db.prepare(`
      INSERT INTO issues_fts (id, title, description, resolution, tags, created)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(issue.id, issue.title, issue.description, issue.resolution, JSON.stringify(issue.tags), issue.created);
  }

  private rebuildFts(issues: Issue[]): void {
    this.db.exec('DELETE FROM issues_fts');
    const stmt = this.db.prepare(`
      INSERT INTO issues_fts (id, title, description, resolution, tags, created)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertMany = this.db.transaction((items: Issue[]) => {
      for (const issue of items) {
        stmt.run(issue.id, issue.title, issue.description, issue.resolution, JSON.stringify(issue.tags), issue.created);
      }
    });
    insertMany(issues);
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/store.test.ts
```
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts test/store.test.ts
git commit -m "feat: store module with JSONL I/O and FTS5 schema"
```

---

### Task 3: Store Module — FTS5 Search and Staleness Detection

**Files:**
- Modify: `src/store.ts`
- Modify: `test/store.test.ts`

- [ ] **Step 1: Write failing tests for search and staleness**

Append to `test/store.test.ts`:

```typescript
  it('searches issues with FTS5 and returns results with snippets', () => {
    const store = new Store(tmpDir);
    store.append({
      id: 'id1',
      title: 'Null pointer in auth middleware',
      description: 'Happens when session token expires',
      resolution: 'Added null check before accessing req.session.user',
      tags: ['auth', 'null-pointer'],
      created: '2026-06-13T10:00:00Z',
    });
    store.append({
      id: 'id2',
      title: 'Memory leak in parser',
      description: 'Large files cause heap growth',
      resolution: 'Fixed buffer allocation',
      tags: ['performance', 'memory'],
      created: '2026-06-13T11:00:00Z',
    });

    const results = store.search('null pointer');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('id1');
    expect(results[0].snippet).toContain('Null pointer');
  });

  it('search with tag filter returns only matching tag', () => {
    const store = new Store(tmpDir);
    store.append({
      id: 'id1',
      title: 'Crash A',
      description: 'Something broke',
      resolution: 'Fix it',
      tags: ['crash'],
      created: '2026-06-13T10:00:00Z',
    });
    store.append({
      id: 'id2',
      title: 'Crash B',
      description: 'Different thing broke',
      resolution: 'Fix it too',
      tags: ['auth'],
      created: '2026-06-13T11:00:00Z',
    });

    const results = store.search('broke', { tag: 'crash' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('id1');
  });

  it('empty query with tag returns recent issues by date', () => {
    const store = new Store(tmpDir);
    store.append({
      id: 'older',
      title: 'Old crash',
      description: 'Old',
      resolution: 'Old',
      tags: ['crash'],
      created: '2026-01-01T00:00:00Z',
    });
    store.append({
      id: 'newer',
      title: 'New crash',
      description: 'New',
      resolution: 'New',
      tags: ['crash'],
      created: '2026-06-13T12:00:00Z',
    });

    const results = store.search('', { tag: 'crash', limit: 2 });
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('newer');
  });

  it('rebuilds FTS5 index when JSONL file mtime changes', () => {
    const store = new Store(tmpDir);
    store.append({
      id: 'id1',
      title: 'Initial',
      description: 'First issue',
      resolution: 'Done',
      tags: [],
      created: '2026-06-13T10:00:00Z',
    });

    // Simulate external change by directly appending to JSONL
    const newIssue: Issue = {
      id: 'id2',
      title: 'External',
      description: 'Added externally',
      resolution: 'External fix',
      tags: [],
      created: '2026-06-13T11:00:00Z',
    };
    const line = JSON.stringify(newIssue) + '\n';
    const jsonlPath = path.join(tmpDir, '.samaritan', 'issues.jsonl');
    fs.appendFileSync(jsonlPath, line, 'utf-8');

    // Re-open store — should detect staleness and rebuild
    store.close();
    const store2 = new Store(tmpDir);
    const results = store2.search('External');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('id2');
    store2.close();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/store.test.ts
```
Expected: FAIL — `store.search` not defined or returns nothing.

- [ ] **Step 3: Implement search and staleness in Store**

Replace `src/store.ts` with the full implementation:

```typescript
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Issue, SearchResult } from './types.js';

const SAMARITAN_DIR = '.samaritan';
const JSONL_FILE = 'issues.jsonl';
const DB_FILE = 'issues.db';

interface SearchOptions {
  tag?: string;
  limit?: number;
}

export class Store {
  private db: Database.Database;
  private dir: string;
  private jsonlPath: string;
  private dbPath: string;

  constructor(projectRoot: string) {
    this.dir = path.join(projectRoot, SAMARITAN_DIR);
    this.jsonlPath = path.join(this.dir, JSONL_FILE);
    this.dbPath = path.join(this.dir, DB_FILE);
    this.ensureDir();
    this.db = new Database(this.dbPath);
    this.ensureSchema();
    this.checkStaleness();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
    if (!fs.existsSync(this.jsonlPath)) {
      fs.writeFileSync(this.jsonlPath, '', 'utf-8');
    }
    const gitignorePath = path.join(this.dir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, 'issues.db\n', 'utf-8');
    }
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS issues_fts USING fts5(
        id UNINDEXED,
        title,
        description,
        resolution,
        tags UNINDEXED,
        created UNINDEXED,
        tokenize='porter unicode61'
      );
    `);
  }

  private checkStaleness(): void {
    const stat = fs.statSync(this.jsonlPath);
    const fingerprint = `${stat.mtimeMs}:${stat.size}`;
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('jsonl_fingerprint') as { value: string } | undefined;

    if (!row || row.value !== fingerprint) {
      this.rebuildFromJsonl();
      this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('jsonl_fingerprint', fingerprint);
    }
  }

  private rebuildFromJsonl(): void {
    const issues = this.readAll();
    this.db.exec('DELETE FROM issues_fts');
    const stmt = this.db.prepare(`
      INSERT INTO issues_fts (id, title, description, resolution, tags, created)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertAll = this.db.transaction((items: Issue[]) => {
      for (const issue of items) {
        stmt.run(issue.id, issue.title, issue.description, issue.resolution, JSON.stringify(issue.tags), issue.created);
      }
    });
    insertAll(issues);
  }

  readAll(): Issue[] {
    const content = fs.readFileSync(this.jsonlPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim() !== '');
    return lines.map(line => {
      try {
        return JSON.parse(line) as Issue;
      } catch {
        // Skip unparseable lines (e.g. merge conflict markers handled by merge module)
        return null;
      }
    }).filter((i): i is Issue => i !== null);
  }

  append(issue: Issue): void {
    const line = JSON.stringify(issue) + '\n';
    fs.appendFileSync(this.jsonlPath, line, 'utf-8');
    this.insertFts(issue);
    // Update fingerprint so stale check doesn't trigger rebuild
    const stat = fs.statSync(this.jsonlPath);
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('jsonl_fingerprint', `${stat.mtimeMs}:${stat.size}`);
  }

  update(id: string, fields: Partial<Pick<Issue, 'tags'>>): Issue {
    const issues = this.readAll();
    const index = issues.findIndex(i => i.id === id);
    if (index === -1) {
      throw new IssueNotFoundError(id);
    }
    Object.assign(issues[index], fields);
    this.writeAll(issues);
    this.rebuildFromJsonl();
    const stat = fs.statSync(this.jsonlPath);
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('jsonl_fingerprint', `${stat.mtimeMs}:${stat.size}`);
    return issues[index];
  }

  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const limit = options.limit ?? 10;

    if (query.trim() === '') {
      return this.searchByTagOnly(options.tag, limit);
    }

    let sql: string;
    let params: (string | number)[];

    if (options.tag) {
      sql = `
        SELECT id, title, tags, snippet(issues_fts, 1, '<b>', '</b>', '...', 32) as snippet
        FROM issues_fts
        WHERE issues_fts MATCH ? AND tags LIKE ?
        ORDER BY rank
        LIMIT ?
      `;
      params = [query, `%"${options.tag}"%`, limit];
    } else {
      sql = `
        SELECT id, title, tags, snippet(issues_fts, 1, '<b>', '</b>', '...', 32) as snippet
        FROM issues_fts
        WHERE issues_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `;
      params = [query, limit];
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      title: string;
      tags: string;
      snippet: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      tags: JSON.parse(row.tags) as string[],
      snippet: row.snippet,
    }));
  }

  private searchByTagOnly(tag: string | undefined, limit: number): SearchResult[] {
    if (!tag) return [];

    const rows = this.db.prepare(`
      SELECT id, title, tags, '' as snippet
      FROM issues_fts
      WHERE tags LIKE ?
      ORDER BY created DESC
      LIMIT ?
    `).all(`%"${tag}"%`, limit) as Array<{
      id: string;
      title: string;
      tags: string;
      snippet: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      tags: JSON.parse(row.tags) as string[],
      snippet: row.snippet,
    }));
  }

  private writeAll(issues: Issue[]): void {
    const lines = issues.map(i => JSON.stringify(i)).join('\n') + '\n';
    fs.writeFileSync(this.jsonlPath, lines, 'utf-8');
  }

  private insertFts(issue: Issue): void {
    const stmt = this.db.prepare(`
      INSERT INTO issues_fts (id, title, description, resolution, tags, created)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(issue.id, issue.title, issue.description, issue.resolution, JSON.stringify(issue.tags), issue.created);
  }

  close(): void {
    this.db.close();
  }
}

export class IssueNotFoundError extends Error {
  constructor(id: string) {
    super(`issue not found: ${id}`);
    this.name = 'IssueNotFoundError';
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/store.test.ts
```
Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts test/store.test.ts
git commit -m "feat: FTS5 search with BM25, tag filter, staleness detection"
```

---

### Task 4: Merge Conflict Auto-Resolution

**Files:**
- Create: `src/merge.ts`
- Create: `test/merge.test.ts`

- [ ] **Step 1: Write failing test for merge conflict resolution**

Write `test/merge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveConflicts } from '../src/merge.js';

describe('resolveConflicts', () => {
  it('returns content unchanged when no conflict markers present', () => {
    const content = '{"id":"a"}\n{"id":"b"}\n';
    expect(resolveConflicts(content)).toBe(content);
  });

  it('accepts both sides of a conflict and discards markers', () => {
    const content = `{"id":"a","title":"Original"}
<<<<<<< HEAD
{"id":"a","title":"Ours"}
=======
{"id":"a","title":"Theirs"}
>>>>>>> other-branch
{"id":"b","title":"Unrelated"}
`;
    const result = resolveConflicts(content);
    const lines = result.split('\n').filter(l => l.trim() !== '');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).title).toBe('Ours');
    expect(JSON.parse(lines[1]).title).toBe('Theirs');
    expect(JSON.parse(lines[2]).title).toBe('Unrelated');
  });

  it('handles multiple conflict blocks', () => {
    const content = `<<<<<<< HEAD
{"id":"a","title":"Ours A"}
=======
{"id":"a","title":"Theirs A"}
>>>>>>> branch
<<<<<<< HEAD
{"id":"b","title":"Ours B"}
=======
{"id":"b","title":"Theirs B"}
>>>>>>> branch
`;
    const result = resolveConflicts(content);
    const lines = result.split('\n').filter(l => l.trim() !== '');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).title).toBe('Ours A');
    expect(JSON.parse(lines[1]).title).toBe('Theirs B');
  });

  it('skips non-JSON lines inside conflict blocks', () => {
    const content = `<<<<<<< HEAD
{"id":"a","title":"Ours"}
not json garbage
=======
{"id":"a","title":"Theirs"}
>>>>>>> branch
`;
    const result = resolveConflicts(content);
    const lines = result.split('\n').filter(l => l.trim() !== '');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).title).toBe('Theirs');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/merge.test.ts
```
Expected: FAIL — `resolveConflicts` not defined.

- [ ] **Step 3: Implement merge conflict resolution**

Write `src/merge.ts`:

```typescript
const CONFLICT_START = /^<{7} /;
const CONFLICT_SEP = /^={7}$/;
const CONFLICT_END = /^>{7} /;

/**
 * Resolves git merge conflict markers in a JSONL file by accepting both sides.
 * Each valid JSON line from either side is kept. Conflict markers and non-JSON
 * lines are discarded. Lines outside conflict blocks pass through unchanged.
 */
export function resolveConflicts(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (CONFLICT_START.test(lines[i])) {
      i = resolveBlock(lines, i, result);
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join('\n');
}

function resolveBlock(lines: string[], start: number, result: string[]): number {
  let i = start + 1; // skip <<<<<<< marker
  const ours: string[] = [];
  const theirs: string[] = [];
  let side: 'ours' | 'theirs' = 'ours';

  while (i < lines.length) {
    if (CONFLICT_SEP.test(lines[i])) {
      side = 'theirs';
      i++;
      continue;
    }
    if (CONFLICT_END.test(lines[i])) {
      i++; // skip >>>>>>> marker
      break;
    }

    const trimmed = lines[i].trim();
    if (trimmed !== '') {
      try {
        JSON.parse(trimmed);
        if (side === 'ours') {
          ours.push(trimmed);
        } else {
          theirs.push(trimmed);
        }
      } catch {
        // skip non-JSON lines
      }
    }
    i++;
  }

  result.push(...ours, ...theirs);
  return i;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/merge.test.ts
```
Expected: all 4 tests PASS.

- [ ] **Step 5: Integrate merge resolution into Store constructor**

Modify `src/store.ts` — add import and call `resolveConflicts` during `readAll` or in the constructor before reading. Add after `ensureSchema()` in the constructor:

```typescript
import { resolveConflicts } from './merge.js';

// In constructor, after ensureSchema():
this.resolveMergeConflicts();
```

Add the method to the `Store` class:

```typescript
private resolveMergeConflicts(): void {
  const raw = fs.readFileSync(this.jsonlPath, 'utf-8');
  const resolved = resolveConflicts(raw);
  if (resolved !== raw) {
    fs.writeFileSync(this.jsonlPath, resolved, 'utf-8');
  }
}
```

- [ ] **Step 6: Add merge conflict integration test to store test**

Append to `test/store.test.ts`:

```typescript
  it('auto-resolves merge conflicts on open', () => {
    const jsonlPath = path.join(tmpDir, '.samaritan', 'issues.jsonl');
    // Write a file with conflict markers
    const conflicted = `{"id":"a","title":"Pre-existing"}
<<<<<<< HEAD
{"id":"x","title":"Ours"}
=======
{"id":"y","title":"Theirs"}
>>>>>>> other
`;
    fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
    fs.writeFileSync(jsonlPath, conflicted, 'utf-8');

    const store = new Store(tmpDir);
    const issues = store.readAll();
    // Both sides accepted, conflict markers gone
    expect(issues).toHaveLength(3);
    const titles = issues.map(i => i.title);
    expect(titles).toContain('Ours');
    expect(titles).toContain('Theirs');
    expect(titles).toContain('Pre-existing');

    // Verify file was rewritten without conflict markers
    const rewritten = fs.readFileSync(jsonlPath, 'utf-8');
    expect(rewritten).not.toContain('<<<<<<<');
    expect(rewritten).not.toContain('=======');
    expect(rewritten).not.toContain('>>>>>>>');
    store.close();
  });
```

- [ ] **Step 7: Run all store tests**

```bash
npx vitest run test/store.test.ts
```
Expected: all 10 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/merge.ts test/merge.test.ts src/store.ts test/store.test.ts
git commit -m "feat: merge conflict auto-resolution in store"
```

---

### Task 5: CLI Wiring — Commander Setup and Project Directory Discovery

**Files:**
- Replace: `src/cli.ts`
- Create: `test/cli.test.ts`

- [ ] **Step 1: Write failing CLI integration test**

Write `test/cli.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const CLI = path.resolve('dist/cli.js');

describe('CLI', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samaritan-cli-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function run(args: string[]): { stdout: string; stderr: string; exitCode: number } {
    try {
      const stdout = execSync(`node ${CLI} ${args.join(' ')}`, {
        cwd: tmpDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return {
        stdout: e.stdout?.trim() ?? '',
        stderr: e.stderr?.trim() ?? '',
        exitCode: e.status ?? 1,
      };
    }
  }

  it('adds an issue and returns JSON', () => {
    // Need to build first, then test
    const { stdout, exitCode } = run([
      'add', 'Test bug', 'Something broke',
      '--tags', 'crash',
      '--dir', tmpDir,
    ]);
    expect(exitCode).toBe(0);
    const issue = JSON.parse(stdout);
    expect(issue.title).toBe('Test bug');
    expect(issue.description).toBe('Something broke');
    expect(issue.tags).toEqual(['crash']);
    expect(issue.id).toHaveLength(8);
    expect(issue.created).toBeTruthy();
  });

  it('searches and returns JSON array', () => {
    run(['add', 'First', 'Desc one', '--dir', tmpDir]);
    run(['add', 'Second', 'Desc two unique phrase', '--dir', tmpDir]);

    const { stdout, exitCode } = run(['search', 'unique phrase', '--dir', tmpDir]);
    expect(exitCode).toBe(0);
    const results = JSON.parse(stdout);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Second');
    expect(results[0].snippet).toBeTruthy();
  });

  it('shows an issue by id', () => {
    const { stdout } = run(['add', 'My bug', 'Description', '--dir', tmpDir]);
    const created = JSON.parse(stdout);

    const { stdout: showOut, exitCode } = run(['show', created.id, '--dir', tmpDir]);
    expect(exitCode).toBe(0);
    const shown = JSON.parse(showOut);
    expect(shown.id).toBe(created.id);
    expect(shown.title).toBe('My bug');
  });

  it('show returns error JSON on stderr for unknown id', () => {
    const { stderr, exitCode } = run(['show', 'deadbeef', '--dir', tmpDir]);
    expect(exitCode).toBe(1);
    const err = JSON.parse(stderr);
    expect(err.error).toContain('not found');
  });

  it('tags an issue and returns updated record', () => {
    const { stdout } = run(['add', 'Taggable', 'Desc', '--dir', tmpDir]);
    const created = JSON.parse(stdout);

    const { stdout: tagOut, exitCode } = run(['tag', created.id, 'auth', 'crash', '--dir', tmpDir]);
    expect(exitCode).toBe(0);
    const updated = JSON.parse(tagOut);
    expect(updated.tags).toEqual(['auth', 'crash']);
  });
});
```

- [ ] **Step 2: Build and run test to verify it fails**

```bash
npx tsc && npx vitest run test/cli.test.ts
```
Expected: FAIL — commands not registered.

- [ ] **Step 3: Write full CLI wiring**

Replace `src/cli.ts`:

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { addCommand } from './commands/add.js';
import { searchCommand } from './commands/search.js';
import { showCommand } from './commands/show.js';
import { tagCommand } from './commands/tag.js';
import { resolveProjectDir } from './resolve.js';

const program = new Command();

program
  .name('samaritan')
  .description('Bug memory CLI for agents — store and search issue resolutions')
  .version('0.1.0')
  .option('--dir <path>', 'project root directory');

// Attach commands
initCommand(program);
addCommand(program);
searchCommand(program);
showCommand(program);
tagCommand(program);

program.parse();
```

Create `src/resolve.ts`:

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';

const SAMARITAN_DIR = '.samaritan';

/**
 * Walk up from cwd until a .samaritan directory is found.
 * Returns the project root (parent of .samaritan/).
 * Returns null if not found.
 */
export function findProjectDir(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, SAMARITAN_DIR))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Resolve the project directory for a command.
 * Uses --dir flag if provided, otherwise walks up from cwd.
 * For write commands (add, tag), auto-creates .samaritan/ in cwd if not found.
 * For read commands (search, show), returns null if not found.
 */
export function resolveProjectDir(
  flagDir: string | undefined,
  cwd: string,
  isWrite: boolean,
): string | null {
  if (flagDir) return path.resolve(flagDir);

  const found = findProjectDir(cwd);
  if (found) return found;

  if (isWrite) return cwd;

  return null;
}
```

- [ ] **Step 4: Write command stubs so CLI compiles**

Create stub command files — just enough to compile:

`src/commands/init.ts`:
```typescript
import type { Command } from 'commander';
export function initCommand(program: Command): void {
  program.command('init').action(() => {});
}
```

`src/commands/add.ts`:
```typescript
import type { Command } from 'commander';
export function addCommand(program: Command): void {
  program.command('add').action(() => {});
}
```

`src/commands/search.ts`:
```typescript
import type { Command } from 'commander';
export function searchCommand(program: Command): void {
  program.command('search').action(() => {});
}
```

`src/commands/show.ts`:
```typescript
import type { Command } from 'commander';
export function showCommand(program: Command): void {
  program.command('show').action(() => {});
}
```

`src/commands/tag.ts`:
```typescript
import type { Command } from 'commander';
export function tagCommand(program: Command): void {
  program.command('tag').action(() => {});
}
```

- [ ] **Step 5: Verify build compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/resolve.ts src/commands/init.ts src/commands/add.ts src/commands/search.ts src/commands/show.ts src/commands/tag.ts
git commit -m "feat: CLI wiring with commander and project directory resolution"
```

---

### Task 6: Add Command

**Files:**
- Replace: `src/commands/add.ts`

- [ ] **Step 1: Write the failing test for add command**

The add command test is already in `test/cli.test.ts` from Task 5 — the first test `'adds an issue and returns JSON'`. Run it to confirm it fails:

```bash
npx tsc && npx vitest run test/cli.test.ts -t 'adds an issue'
```
Expected: FAIL — stub exits without output.

- [ ] **Step 2: Implement add command**

Replace `src/commands/add.ts`:

```typescript
import type { Command } from 'commander';
import * as crypto from 'node:crypto';
import { Store } from '../store.js';
import { resolveProjectDir } from '../resolve.js';
import type { ErrorOutput } from '../types.js';

export function addCommand(program: Command): void {
  program
    .command('add')
    .argument('<title>', 'issue title')
    .argument('<description>', 'issue description')
    .option('--tags <tags>', 'comma-separated tags')
    .option('--resolution <resolution>', 'how the bug was fixed')
    .action((title: string, description: string, options: { tags?: string; resolution?: string }) => {
      try {
        const dirFlag = program.opts().dir;
        const projectDir = resolveProjectDir(dirFlag, process.cwd(), true);
        if (!projectDir) {
          process.stderr.write(JSON.stringify({ error: 'no .samaritan directory found; run samaritan init' } satisfies ErrorOutput));
          process.exit(1);
        }

        const store = new Store(projectDir);

        const id = crypto.randomBytes(4).toString('hex');
        const tags = options.tags
          ? options.tags.split(',').map(t => t.trim()).filter(Boolean)
          : [];
        const issue = {
          id,
          title,
          description,
          resolution: options.resolution ?? '',
          tags,
          created: new Date().toISOString(),
        };

        store.append(issue);
        store.close();

        process.stdout.write(JSON.stringify(issue));
        process.exit(0);
      } catch (e: any) {
        process.stderr.write(JSON.stringify({ error: e.message } satisfies ErrorOutput));
        process.exit(1);
      }
    });
}
```

- [ ] **Step 3: Run the add test**

```bash
npx tsc && npx vitest run test/cli.test.ts -t 'adds an issue'
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/commands/add.ts
git commit -m "feat: add command — create issue, append to JSONL, insert to FTS5"
```

---

### Task 7: Search Command

**Files:**
- Replace: `src/commands/search.ts`

- [ ] **Step 1: Write failing test for search command**

The search test is already in `test/cli.test.ts` from Task 5. Run it:

```bash
npx tsc && npx vitest run test/cli.test.ts -t 'searches and returns'
```
Expected: FAIL — stub.

- [ ] **Step 2: Implement search command**

Replace `src/commands/search.ts`:

```typescript
import type { Command } from 'commander';
import { Store } from '../store.js';
import { resolveProjectDir } from '../resolve.js';
import type { ErrorOutput } from '../types.js';

export function searchCommand(program: Command): void {
  program
    .command('search')
    .argument('<query>', 'search query (phrase match default, boolean syntax supported)')
    .option('--tag <tag>', 'filter by exact tag')
    .option('--limit <limit>', 'max results', '10')
    .action((query: string, options: { tag?: string; limit: string }) => {
      try {
        const dirFlag = program.opts().dir;
        const projectDir = resolveProjectDir(dirFlag, process.cwd(), false);
        if (!projectDir) {
          process.stderr.write(JSON.stringify({ error: 'no .samaritan directory found; run samaritan init' } satisfies ErrorOutput));
          process.exit(1);
        }

        const store = new Store(projectDir);
        const limit = parseInt(options.limit, 10);
        const results = store.search(query, {
          tag: options.tag,
          limit: isNaN(limit) ? 10 : limit,
        });
        store.close();

        process.stdout.write(JSON.stringify(results));
        process.exit(0);
      } catch (e: any) {
        process.stderr.write(JSON.stringify({ error: e.message } satisfies ErrorOutput));
        process.exit(1);
      }
    });
}
```

- [ ] **Step 3: Run the search test**

```bash
npx tsc && npx vitest run test/cli.test.ts -t 'searches and returns'
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/commands/search.ts
git commit -m "feat: search command — FTS5 query with tag filter and limit"
```

---

### Task 8: Show Command

**Files:**
- Replace: `src/commands/show.ts`

- [ ] **Step 1: Write failing test for show command**

Run the show tests:

```bash
npx tsc && npx vitest run test/cli.test.ts -t 'shows an issue'
```
Expected: FAIL — stub.

- [ ] **Step 2: Implement show command**

Replace `src/commands/show.ts`:

```typescript
import type { Command } from 'commander';
import { Store, IssueNotFoundError } from '../store.js';
import { resolveProjectDir } from '../resolve.js';
import type { ErrorOutput } from '../types.js';

export function showCommand(program: Command): void {
  program
    .command('show')
    .argument('<id>', 'issue id')
    .action((id: string) => {
      try {
        const dirFlag = program.opts().dir;
        const projectDir = resolveProjectDir(dirFlag, process.cwd(), false);
        if (!projectDir) {
          process.stderr.write(JSON.stringify({ error: 'no .samaritan directory found; run samaritan init' } satisfies ErrorOutput));
          process.exit(1);
        }

        const store = new Store(projectDir);
        const issues = store.readAll();
        const issue = issues.find(i => i.id === id);
        store.close();

        if (!issue) {
          process.stderr.write(JSON.stringify({ error: `issue not found: ${id}` } satisfies ErrorOutput));
          process.exit(1);
        }

        process.stdout.write(JSON.stringify(issue));
        process.exit(0);
      } catch (e: any) {
        if (e instanceof IssueNotFoundError) {
          process.stderr.write(JSON.stringify({ error: e.message } satisfies ErrorOutput));
          process.exit(1);
        }
        process.stderr.write(JSON.stringify({ error: e.message } satisfies ErrorOutput));
        process.exit(1);
      }
    });
}
```

- [ ] **Step 3: Run show tests**

```bash
npx tsc && npx vitest run test/cli.test.ts -t 'shows an issue|show returns error'
```
Expected: both tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/commands/show.ts
git commit -m "feat: show command — lookup issue by id, JSON output"
```

---

### Task 9: Tag Command

**Files:**
- Replace: `src/commands/tag.ts`

- [ ] **Step 1: Write failing test for tag command**

Run the tag test:

```bash
npx tsc && npx vitest run test/cli.test.ts -t 'tags an issue'
```
Expected: FAIL — stub.

- [ ] **Step 2: Implement tag command**

Replace `src/commands/tag.ts`:

```typescript
import type { Command } from 'commander';
import { Store, IssueNotFoundError } from '../store.js';
import { resolveProjectDir } from '../resolve.js';
import type { ErrorOutput } from '../types.js';

export function tagCommand(program: Command): void {
  program
    .command('tag')
    .argument('<id>', 'issue id')
    .argument('<tags...>', 'tags to set (replaces existing)')
    .action((id: string, tags: string[]) => {
      try {
        const dirFlag = program.opts().dir;
        const projectDir = resolveProjectDir(dirFlag, process.cwd(), true);
        if (!projectDir) {
          process.stderr.write(JSON.stringify({ error: 'no .samaritan directory found; run samaritan init' } satisfies ErrorOutput));
          process.exit(1);
        }

        const store = new Store(projectDir);
        const updated = store.update(id, { tags });
        store.close();

        process.stdout.write(JSON.stringify({ id: updated.id, tags: updated.tags }));
        process.exit(0);
      } catch (e: any) {
        if (e instanceof IssueNotFoundError) {
          process.stderr.write(JSON.stringify({ error: e.message } satisfies ErrorOutput));
          process.exit(1);
        }
        process.stderr.write(JSON.stringify({ error: e.message } satisfies ErrorOutput));
        process.exit(1);
      }
    });
}
```

- [ ] **Step 3: Run tag test**

```bash
npx tsc && npx vitest run test/cli.test.ts -t 'tags an issue'
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/commands/tag.ts
git commit -m "feat: tag command — set tags on issue, rebuild FTS5 index"
```

---

### Task 10: Init Command

**Files:**
- Replace: `src/commands/init.ts`

- [ ] **Step 1: Implement init command with interactive wizard**

Replace `src/commands/init.ts`:

```typescript
import type { Command } from 'commander';
import * as intro from '@clack/prompts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Store } from '../store.js';

const BANNER = `
____ ____ _  _ ____ ____ _ ___ ____ _  _ 
[__  |__| |\\/| |__| |__/ |  |  |__| |\\ | 
___] |  | |  | |  | |  \\ |  |  |  | | \\| 
                                         
`;

export function initCommand(program: Command): void {
  program
    .command('init')
    .action(async () => {
      const dirFlag = program.opts().dir;
      const projectDir = path.resolve(dirFlag ?? process.cwd());
      const samDir = path.join(projectDir, '.samaritan');

      // Show banner
      console.log(BANNER);
      console.log('samaritan v0.1.0 — Record and search bug memories for your project');
      console.log('');

      // Check if already initialized
      if (fs.existsSync(samDir)) {
        console.log(`Already initialized at ${samDir}`);
        process.exit(0);
      }

      // Confirm
      const confirmed = await intro.confirm({
        message: `Initialize samaritan in ${projectDir}?`,
        initialValue: true,
      });

      if (intro.isCancel(confirmed) || !confirmed) {
        console.log('Cancelled.');
        process.exit(0);
      }

      // Progress spinner
      const s = intro.spinner();
      s.start('Creating .samaritan/');

      try {
        // Create store (auto-creates directory, files, DB)
        const store = new Store(projectDir);
        s.stop('Created .samaritan/');

        s.start('Creating issues.jsonl');
        s.stop('Created issues.jsonl');

        s.start('Creating issues.db');
        s.stop('Created issues.db');

        s.start('Creating .gitignore');
        s.stop('Created .gitignore');

        store.close();

        // Success
        console.log('');
        intro.outro(`Initialized at ${samDir}\n\nUse \`samaritan add\` to record your first bug.`);
        process.exit(0);
      } catch (e: any) {
        s.stop(`Failed: ${e.message}`, 1);
        process.exit(1);
      }
    });
}
```

- [ ] **Step 2: Verify build compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

```bash
npx tsc && npx vitest run
```
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/commands/init.ts
git commit -m "feat: init command — interactive wizard with cybermedium banner"
```

---

**Note:** The `init` command is not covered by automated CLI snapshot tests because it uses `@clack/prompts` which requires a TTY. It is verified manually in Task 11 (smoke test) and its underlying file creation logic is covered by store tests (Task 2).

### Task 11: Smoke Test and Package Verification

**Files:**
- Modify: `package.json` (verify bin field, add files field)

- [ ] **Step 1: Update package.json for distribution**

Add `"files"` field to `package.json` to include only `dist/` and `bin/`:

```json
{
  "files": ["dist", "bin"]
}
```

- [ ] **Step 2: Smoke test — build and run full workflow**

```bash
npx tsc
```

Then in a temp directory:

```bash
TMP=$(mktemp -d)
node dist/cli.js add "Smoke test bug" "Verifying end to end" --tags smoke,test --dir $TMP
node dist/cli.js search "Smoke test" --dir $TMP
node dist/cli.js show <id-from-above> --dir $TMP
node dist/cli.js tag <id> production --dir $TMP
rm -rf $TMP
```

Verify that:
- `add` prints a valid JSON issue
- `search` prints a JSON array with the issue
- `show` prints the full issue JSON
- `tag` prints `{"id":"...","tags":["production"]}`

- [ ] **Step 3: Run full vitest suite one final time**

```bash
npx vitest run
```
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: finalize package.json for distribution, smoke test passing"
```

---

### Plan Self-Review Checklist

1. **Spec coverage:** Each spec requirement maps to a task:
   - Storage model (JSONL + FTS5) → Tasks 2, 3
   - Sync & staleness → Task 3
   - Merge conflicts → Task 4
   - Two-audience design → Task 5 (CLI wiring), Task 10 (init interactive), Tasks 6-9 (JSON-only agent commands)
   - `init` command with cybermedium banner → Task 10
   - `add` command → Task 6
   - `search` command → Task 7
   - `show` command → Task 8
   - `tag` command → Task 9
   - Error contract (JSON on stderr, non-zero exit) → All command tasks + CLI tests
   - Project directory discovery → Task 5
   - Testing → Each task includes test steps

2. **Placeholder scan:** No TBDs, TODOs, or "implement later" patterns. Every step has complete code.

3. **Type consistency:** `Issue`, `SearchResult`, `ErrorOutput` types defined in Task 1, used consistently in Store (Task 2-3) and commands (Tasks 6-9). `IssueNotFoundError` exported from store.ts, caught in show.ts and tag.ts. `resolveProjectDir` signature stable across all command files.
