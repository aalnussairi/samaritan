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
    // Original (outside block) + Ours + Theirs + Unrelated = 4
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0]).title).toBe('Original');
    expect(JSON.parse(lines[1]).title).toBe('Ours');
    expect(JSON.parse(lines[2]).title).toBe('Theirs');
    expect(JSON.parse(lines[3]).title).toBe('Unrelated');
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
    // Both sides from each block: Ours A, Theirs A, Ours B, Theirs B = 4
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0]).title).toBe('Ours A');
    expect(JSON.parse(lines[1]).title).toBe('Theirs A');
    expect(JSON.parse(lines[2]).title).toBe('Ours B');
    expect(JSON.parse(lines[3]).title).toBe('Theirs B');
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
    // Ours (valid JSON) + Theirs (valid JSON), garbage skipped = 2
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).title).toBe('Ours');
    expect(JSON.parse(lines[1]).title).toBe('Theirs');
  });
});
