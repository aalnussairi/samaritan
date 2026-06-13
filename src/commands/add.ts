import { randomBytes } from "node:crypto";
import type { Command } from "commander";
import { resolveProjectDir } from "../resolve.js";
import { Store } from "../store.js";
import type { ErrorOutput } from "../types.js";

export function addCommand(program: Command): void {
  program
    .command("add")
    .argument("<title>", "issue title")
    .argument("<description>", "issue description")
    .option("--tags <tags>", "comma-separated tags")
    .option("--resolution <resolution>", "how the bug was fixed")
    .action(
      (
        title: string,
        description: string,
        options: { tags?: string; resolution?: string }
      ) => {
        try {
          const dirFlag = program.opts().dir;
          const projectDir = resolveProjectDir(dirFlag, process.cwd(), true);
          if (!projectDir) {
            process.stderr.write(
              JSON.stringify({
                error: "no .samaritan directory found; run samaritan init",
              } satisfies ErrorOutput)
            );
            process.exit(1);
          }

          const store = new Store(projectDir);

          const id = randomBytes(4).toString("hex");
          const tags = options.tags
            ? options.tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
            : [];
          const issue = {
            id,
            title,
            description,
            resolution: options.resolution ?? "",
            tags,
            created: new Date().toISOString(),
          };

          store.append(issue);
          store.close();

          process.stdout.write(JSON.stringify(issue));
          process.exit(0);
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          process.stderr.write(
            JSON.stringify({ error: message } satisfies ErrorOutput)
          );
          process.exit(1);
        }
      }
    );
}
