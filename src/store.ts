import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { resolveConflicts } from "./merge.js";
import type { Issue, SearchResult } from "./types.js";

const SAMARITAN_DIR = ".samaritan";
const JSONL_FILE = "issues.jsonl";
const DB_FILE = "issues.db";

interface SearchOptions {
  limit?: number;
  tag?: string;
}

export class Store {
  private readonly db: Database.Database;
  private readonly dir: string;
  private readonly jsonlPath: string;
  private readonly dbPath: string;

  constructor(projectRoot: string) {
    this.dir = join(projectRoot, SAMARITAN_DIR);
    this.jsonlPath = join(this.dir, JSONL_FILE);
    this.dbPath = join(this.dir, DB_FILE);
    this.ensureDir();
    this.db = new Database(this.dbPath);
    this.ensureSchema();
    this.resolveMergeConflicts();
    this.checkStaleness();
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
    if (!existsSync(this.jsonlPath)) {
      writeFileSync(this.jsonlPath, "", "utf-8");
    }
    const gitignorePath = join(this.dir, ".gitignore");
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, "issues.db\n", "utf-8");
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
    const stat = statSync(this.jsonlPath);
    const fingerprint = `${stat.mtimeMs}:${stat.size}`;
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get("jsonl_fingerprint") as { value: string } | undefined;

    if (!row || row.value !== fingerprint) {
      this.rebuildFromJsonl();
      this.db
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
        .run("jsonl_fingerprint", fingerprint);
    }
  }

  private rebuildFromJsonl(): void {
    const issues = this.readAll();
    const stmt = this.db.prepare(`
      INSERT INTO issues_fts (id, title, description, resolution, tags, created)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const rebuild = this.db.transaction((items: Issue[]) => {
      this.db.exec("DELETE FROM issues_fts");
      for (const issue of items) {
        stmt.run(
          issue.id,
          issue.title,
          issue.description,
          issue.resolution,
          JSON.stringify(issue.tags),
          issue.created
        );
      }
    });
    rebuild(issues);
  }

  private resolveMergeConflicts(): void {
    const raw = readFileSync(this.jsonlPath, "utf-8");
    const resolved = resolveConflicts(raw);
    if (resolved !== raw) {
      writeFileSync(this.jsonlPath, resolved, "utf-8");
    }
  }

  readAll(): Issue[] {
    const content = readFileSync(this.jsonlPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    return lines
      .map((line) => {
        try {
          return JSON.parse(line) as Issue;
        } catch {
          // Skip unparseable lines (e.g. merge conflict markers handled by merge module)
          return null;
        }
      })
      .filter((i): i is Issue => i !== null);
  }

  append(issue: Issue): void {
    const line = `${JSON.stringify(issue)}\n`;
    appendFileSync(this.jsonlPath, line, "utf-8");
    this.insertFts(issue);
    // Update fingerprint so stale check doesn't trigger rebuild
    const stat = statSync(this.jsonlPath);
    this.db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
      .run("jsonl_fingerprint", `${stat.mtimeMs}:${stat.size}`);
  }

  update(id: string, fields: Partial<Pick<Issue, "tags">>): Issue {
    const issues = this.readAll();
    const index = issues.findIndex((i) => i.id === id);
    if (index === -1) {
      throw new IssueNotFoundError(id);
    }
    Object.assign(issues[index], fields);
    this.writeAll(issues);
    this.rebuildFromJsonl();
    const stat = statSync(this.jsonlPath);
    this.db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
      .run("jsonl_fingerprint", `${stat.mtimeMs}:${stat.size}`);
    return issues[index];
  }

  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const limit = options.limit ?? 10;

    if (query.trim() === "") {
      return this.searchByTagOnly(options.tag, limit);
    }

    let sql: string;
    let params: (string | number)[];

    if (options.tag) {
      sql = `
        SELECT id, title, tags, snippet(issues_fts, 1, '<b>', '</b>', '...', 32) as snippet
        FROM issues_fts
        WHERE issues_fts MATCH ? AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)
        ORDER BY rank
        LIMIT ?
      `;
      params = [query, options.tag, limit];
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

    try {
      const rows = this.db.prepare(sql).all(...params) as Array<{
        id: string;
        title: string;
        tags: string;
        snippet: string;
      }>;

      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        tags: JSON.parse(row.tags) as string[],
        snippet: row.snippet,
      }));
    } catch {
      // FTS5 syntax error (malformed query) — return empty
      return [];
    }
  }

  private searchByTagOnly(
    tag: string | undefined,
    limit: number
  ): SearchResult[] {
    if (!tag) {
      return [];
    }

    const rows = this.db
      .prepare(`
      SELECT id, title, tags, '' as snippet
      FROM issues_fts
      WHERE EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)
      ORDER BY created DESC
      LIMIT ?
    `)
      .all(tag, limit) as Array<{
      id: string;
      title: string;
      tags: string;
      snippet: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      tags: JSON.parse(row.tags) as string[],
      snippet: row.snippet,
    }));
  }

  private writeAll(issues: Issue[]): void {
    const lines = `${issues.map((i) => JSON.stringify(i)).join("\n")}\n`;
    writeFileSync(this.jsonlPath, lines, "utf-8");
  }

  private insertFts(issue: Issue): void {
    const stmt = this.db.prepare(`
      INSERT INTO issues_fts (id, title, description, resolution, tags, created)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      issue.id,
      issue.title,
      issue.description,
      issue.resolution,
      JSON.stringify(issue.tags),
      issue.created
    );
  }

  close(): void {
    this.db.close();
  }
}

export class IssueNotFoundError extends Error {
  constructor(id: string) {
    super(`issue not found: ${id}`);
    this.name = "IssueNotFoundError";
  }
}
