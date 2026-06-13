import type { Command } from 'commander';
export function addCommand(program: Command): void {
  program.command('add').action(() => {});
}
