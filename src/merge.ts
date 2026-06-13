const CONFLICT_START = /^<{7} /;
const CONFLICT_SEP = /^={7}\s*$/;
const CONFLICT_END = /^>{7} /;

/**
 * Resolves git merge conflict markers in a JSONL file by accepting both sides.
 * Each valid JSON line from either side is kept. Conflict markers and non-JSON
 * lines are discarded. Lines outside conflict blocks pass through unchanged.
 */
export function resolveConflicts(content: string): string {
  const lines = content.split("\n");
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

  return result.join("\n");
}

function resolveBlock(
  lines: string[],
  start: number,
  result: string[]
): number {
  let i = start + 1; // skip <<<<<<< marker
  const ours: string[] = [];
  const theirs: string[] = [];
  let side: "ours" | "theirs" = "ours";

  while (i < lines.length) {
    if (CONFLICT_SEP.test(lines[i])) {
      side = "theirs";
      i++;
      continue;
    }
    if (CONFLICT_END.test(lines[i])) {
      i++; // skip >>>>>>> marker
      break;
    }

    const trimmed = lines[i].trim();
    if (trimmed !== "") {
      try {
        JSON.parse(trimmed);
        if (side === "ours") {
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
