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

  close(): void {
    this.db.close();
  }
}
