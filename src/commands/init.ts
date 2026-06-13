import type { Command } from 'commander';
export function initCommand(program: Command): void {
  program.command('init').action(() => {});
}
