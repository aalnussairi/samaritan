import type { Command } from "commander";
import { resolveProjectDir } from "../resolve.js";
import { Store } from "../store.js";
import type { ErrorOutput } from "../types.js";

export function searchCommand(program: Command): void {
  program
    .command("search")
    .argument(
      "<query>",
      "search query (phrase match default, boolean syntax supported)"
    )
    .option("--tag <tag>", "filter by exact tag")
    .option("--limit <limit>", "max results", "10")
    .action((query: string, options: { tag?: string; limit: string }) => {
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
        const limit = Number.parseInt(options.limit, 10);
        const results = store.search(query, {
          tag: options.tag,
          limit: Number.isNaN(limit) ? 10 : limit,
        });
        store.close();

        process.stdout.write(JSON.stringify(results));
        process.exit(0);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        process.stderr.write(
          JSON.stringify({ error: message } satisfies ErrorOutput)
        );
        process.exit(1);
      }
    });
}
