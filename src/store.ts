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
    const stmt = this.db.prepare(`
      INSERT INTO issues_fts (id, title, description, resolution, tags, created)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const rebuild = this.db.transaction((items: Issue[]) => {
      this.db.exec('DELETE FROM issues_fts');
      for (const issue of items) {
        stmt.run(issue.id, issue.title, issue.description, issue.resolution, JSON.stringify(issue.tags), issue.created);
      }
    });
    rebuild(issues);
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
