import type { Command } from 'commander';
export function showCommand(program: Command): void {
  program.command('show').action(() => {});
}
