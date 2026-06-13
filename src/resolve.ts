import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const SAMARITAN_DIR = ".samaritan";

/**
 * Walk up from startDir until a .samaritan directory is found.
 * Returns the project root (parent of .samaritan/).
 * Returns null if not found.
 */
export function findProjectDir(startDir: string): string | null {
  let current = resolve(startDir);
  while (true) {
    if (existsSync(join(current, SAMARITAN_DIR))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
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
  isWrite: boolean
): string | null {
  if (flagDir) {
    return resolve(flagDir);
  }

  const found = findProjectDir(cwd);
  if (found) {
    return found;
  }

  if (isWrite) {
    return cwd;
  }

  return null;
}
