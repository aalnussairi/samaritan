import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { confirm, isCancel, outro, spinner } from "@clack/prompts";
import type { Command } from "commander";
import { Store } from "../store.js";

const BANNER = `
____ ____ _  _ ____ ____ _ ___ ____ _  _ 
[__  |__| |\\/| |__| |__/ |  |  |__| |\\ | 
___] |  | |  | |  | |  \\ |  |  |  | | \\|
                                    
`;

export function initCommand(program: Command): void {
  program.command("init").action(async () => {
    const dirFlag = program.opts().dir;
    const projectDir = resolve(dirFlag ?? process.cwd());
    const samDir = join(projectDir, ".samaritan");

    // Show banner
    console.log(BANNER);
    console.log(
      "samaritan v0.1.0 — Record and search bug memories for your project"
    );
    console.log("");

    // Check if already initialized
    if (existsSync(samDir)) {
      console.log(`Already initialized at ${samDir}`);
      process.exit(0);
    }

    // Confirm
    const confirmed = await confirm({
      message: `Initialize samaritan in ${projectDir}?`,
      initialValue: true,
    });

    if (isCancel(confirmed) || !confirmed) {
      console.log("Cancelled.");
      process.exit(0);
    }

    // Progress spinner
    const s = spinner();
    s.start("Creating .samaritan/");

    try {
      // Create store (auto-creates directory, files, DB)
      const store = new Store(projectDir);
      s.stop("Created .samaritan/");

      s.start("Creating issues.jsonl");
      s.stop("Created issues.jsonl");

      s.start("Creating issues.db");
      s.stop("Created issues.db");

      s.start("Creating .gitignore");
      s.stop("Created .gitignore");

      store.close();

      // Success
      console.log("");
      outro(
        `Initialized at ${samDir}\n\nUse \`samaritan add\` to record your first bug.`
      );
      process.exit(0);
    } catch (e: unknown) {
      if (typeof e === "object" && e && "message" in e)
        s.stop(`Failed: ${e.message}`, 1);
      else s.stop("Failed due to unexpected errors", 1);
      process.exit(1);
    }
  });
}
