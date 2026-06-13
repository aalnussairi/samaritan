import type { Command } from 'commander';
export function tagCommand(program: Command): void {
  program.command('tag').action(() => {});
}
