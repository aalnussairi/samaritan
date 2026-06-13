import type { Command } from 'commander';
import { Store } from '../store.js';
import { resolveProjectDir } from '../resolve.js';
import type { ErrorOutput } from '../types.js';

export function tagCommand(program: Command): void {
  program
    .command('tag')
    .argument('<id>', 'issue id')
    .argument('<tags...>', 'tags to set (replaces existing)')
    .action((id: string, tags: string[]) => {
      try {
        const dirFlag = program.opts().dir;
        const projectDir = resolveProjectDir(dirFlag, process.cwd(), true);
        if (!projectDir) {
          process.stderr.write(JSON.stringify({ error: 'no .samaritan directory found; run samaritan init' } satisfies ErrorOutput));
          process.exit(1);
        }

        const store = new Store(projectDir);
        const updated = store.update(id, { tags });
        store.close();

        process.stdout.write(JSON.stringify({ id: updated.id, tags: updated.tags }));
        process.exit(0);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        process.stderr.write(JSON.stringify({ error: message } satisfies ErrorOutput));
        process.exit(1);
      }
    });
}

