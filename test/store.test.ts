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
