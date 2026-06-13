import type { Command } from 'commander';
export function searchCommand(program: Command): void {
  program.command('search').action(() => {});
}
