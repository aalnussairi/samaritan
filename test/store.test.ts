import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/store.js";
import type { Issue } from "../src/types.js";

describe("Store", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "samaritan-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .samaritan directory, issues.jsonl, issues.db, and .gitignore when absent", () => {
    const store = new Store(tmpDir);

    expect(fs.existsSync(path.join(tmpDir, ".samaritan"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".samaritan", "issues.jsonl"))).toBe(
      true
    );
    expect(fs.existsSync(path.join(tmpDir, ".samaritan", "issues.db"))).toBe(
      true
    );
    const gitignore = fs.readFileSync(
      path.join(tmpDir, ".samaritan", ".gitignore"),
      "utf-8"
    );
    expect(gitignore).toContain("issues.db");
    store.close();
  });

  it("reads empty issues from fresh store", () => {
    const store = new Store(tmpDir);
    const issues = store.readAll();
    expect(issues).toEqual([]);
    store.close();
  });

  it("appends an issue and reads it back", () => {
    const store = new Store(tmpDir);
    const issue = {
      id: "a1b2c3d4",
      title: "Null pointer",
      description: "Happens on expired token",
      resolution: "Add null check",
      tags: ["auth"],
      created: "2026-06-13T10:30:00Z",
    };
    store.append(issue);
    const issues = store.readAll();
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe("a1b2c3d4");
    expect(issues[0].title).toBe("Null pointer");
    store.close();
  });

  it("updates a line by id", () => {
    const store = new Store(tmpDir);
    store.append({
      id: "a1b2c3d4",
      title: "Null pointer",
      description: "Happens on expired token",
      resolution: "Add null check",
      tags: ["auth"],
      created: "2026-06-13T10:30:00Z",
    });
    store.update("a1b2c3d4", { tags: ["auth", "crash"] });
    const issues = store.readAll();
    expect(issues[0].tags).toEqual(["auth", "crash"]);
    store.close();
  });

  it("update throws for unknown id", () => {
    const store = new Store(tmpDir);
    expect(() => store.update("nope", { tags: [] })).toThrow(
      "issue not found: nope"
    );
    store.close();
  });

  it("searches issues with FTS5 and returns results with snippets", () => {
    const store = new Store(tmpDir);
    store.append({
      id: "id1",
      title: "Null pointer in auth middleware",
      description: "Happens when session token expires",
      resolution: "Added null check before accessing req.session.user",
      tags: ["auth", "null-pointer"],
      created: "2026-06-13T10:00:00Z",
    });
    store.append({
      id: "id2",
      title: "Memory leak in parser",
      description: "Large files cause heap growth",
      resolution: "Fixed buffer allocation",
      tags: ["performance", "memory"],
      created: "2026-06-13T11:00:00Z",
    });

    const results = store.search("null pointer");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id1");
    expect(results[0].snippet).toContain("<b>Null</b>");
    expect(results[0].snippet).toContain("<b>pointer</b>");
  });

  it("search with tag filter returns only matching tag", () => {
    const store = new Store(tmpDir);
    store.append({
      id: "id1",
      title: "Crash A",
      description: "Something broke",
      resolution: "Fix it",
      tags: ["crash"],
      created: "2026-06-13T10:00:00Z",
    });
    store.append({
      id: "id2",
      title: "Crash B",
      description: "Different thing broke",
      resolution: "Fix it too",
      tags: ["auth"],
      created: "2026-06-13T11:00:00Z",
    });

    const results = store.search("broke", { tag: "crash" });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id1");
  });

  it("empty query with tag returns recent issues by date", () => {
    const store = new Store(tmpDir);
    store.append({
      id: "older",
      title: "Old crash",
      description: "Old",
      resolution: "Old",
      tags: ["crash"],
      created: "2026-01-01T00:00:00Z",
    });
    store.append({
      id: "newer",
      title: "New crash",
      description: "New",
      resolution: "New",
      tags: ["crash"],
      created: "2026-06-13T12:00:00Z",
    });

    const results = store.search("", { tag: "crash", limit: 2 });
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("newer");
  });

  it("rebuilds FTS5 index when JSONL file mtime changes", () => {
    const store = new Store(tmpDir);
    store.append({
      id: "id1",
      title: "Initial",
      description: "First issue",
      resolution: "Done",
      tags: [],
      created: "2026-06-13T10:00:00Z",
    });

    // Simulate external change by directly appending to JSONL
    const newIssue: Issue = {
      id: "id2",
      title: "External",
      description: "Added externally",
      resolution: "External fix",
      tags: [],
      created: "2026-06-13T11:00:00Z",
    };
    const line = `${JSON.stringify(newIssue)}\n`;
    const jsonlPath = path.join(tmpDir, ".samaritan", "issues.jsonl");
    fs.appendFileSync(jsonlPath, line, "utf-8");

    // Re-open store — should detect staleness and rebuild
    store.close();
    const store2 = new Store(tmpDir);
    const results = store2.search("External");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id2");
    store2.close();
  });

  it("search returns empty array when nothing matches", () => {
    const store = new Store(tmpDir);
    store.append({
      id: "id1",
      title: "Something",
      description: "Some desc",
      resolution: "Done",
      tags: ["test"],
      created: "2026-06-13T10:00:00Z",
    });

    const results = store.search("nonexistent");
    expect(results).toEqual([]);
    store.close();
  });

  it("search handles FTS5 special characters gracefully", () => {
    const store = new Store(tmpDir);
    store.append({
      id: "id1",
      title: "Test issue",
      description: "Some content",
      resolution: "Fixed",
      tags: ["test"],
      created: "2026-06-13T10:00:00Z",
    });

    // FTS5 query with special characters should not crash
    const results = store.search("test OR *");
    // May return results or empty, but must not throw
    expect(Array.isArray(results)).toBe(true);
    store.close();
  });

  it("auto-resolves merge conflicts on open", () => {
    const jsonlPath = path.join(tmpDir, ".samaritan", "issues.jsonl");
    // Write a file with conflict markers
    const conflicted = `{"id":"a","title":"Pre-existing"}
<<<<<<< HEAD
{"id":"x","title":"Ours"}
=======
{"id":"y","title":"Theirs"}
>>>>>>> other
`;
    fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
    fs.writeFileSync(jsonlPath, conflicted, "utf-8");

    const store = new Store(tmpDir);
    const issues = store.readAll();
    // Both sides accepted, conflict markers gone
    expect(issues).toHaveLength(3);
    const titles = issues.map((i) => i.title);
    expect(titles).toContain("Ours");
    expect(titles).toContain("Theirs");
    expect(titles).toContain("Pre-existing");

    // Verify file was rewritten without conflict markers
    const rewritten = fs.readFileSync(jsonlPath, "utf-8");
    expect(rewritten).not.toContain("<<<<<<<");
    expect(rewritten).not.toContain("=======");
    expect(rewritten).not.toContain(">>>>>>>");
    store.close();
  });
});
