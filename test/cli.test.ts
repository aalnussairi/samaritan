import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const CLI = path.resolve('dist/cli.js');

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

describe('CLI', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samaritan-cli-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function run(args: string[]): RunResult {
    try {
      const stdout = execFileSync('node', [CLI, ...args], {
        cwd: tmpDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; status?: number };
      return {
        stdout: (err.stdout ?? '').trim(),
        stderr: (err.stderr ?? '').trim(),
        exitCode: err.status ?? 1,
      };
    }
  }

  it('adds an issue and returns JSON', () => {
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
