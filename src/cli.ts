#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('samaritan')
  .description('Bug memory CLI for agents')
  .version('0.1.0');

program.parse();
