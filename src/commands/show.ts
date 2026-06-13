import type { Command } from "commander";
import { resolveProjectDir } from "../resolve.js";
import { IssueNotFoundError, Store } from "../store.js";
import type { ErrorOutput } from "../types.js";

export function showCommand(program: Command): void {
  program
    .command("show")
    .argument("<id>", "issue id")
    .action((id: string) => {
      try {
        const dirFlag = program.opts().dir;
        const projectDir = resolveProjectDir(dirFlag, process.cwd(), false);
        if (!projectDir) {
          process.stderr.write(
            JSON.stringify({
              error: "no .samaritan directory found; run samaritan init",
            } satisfies ErrorOutput)
          );
          process.exit(1);
        }

        const store = new Store(projectDir);
        const issues = store.readAll();
        const issue = issues.find((i) => i.id === id);
        store.close();

        if (!issue) {
          process.stderr.write(
            JSON.stringify({
              error: `issue not found: ${id}`,
            } satisfies ErrorOutput)
          );
          process.exit(1);
        }

        process.stdout.write(JSON.stringify(issue));
        process.exit(0);
      } catch (e: unknown) {
        if (e instanceof IssueNotFoundError) {
          process.stderr.write(
            JSON.stringify({ error: e.message } satisfies ErrorOutput)
          );
          process.exit(1);
        }
        if (
          typeof e === "object" &&
          e &&
          "message" in e &&
          typeof e.message === "string"
        )
          process.stderr.write(
            JSON.stringify({ error: e.message } satisfies ErrorOutput)
          );
        process.exit(1);
      }
    });
}
