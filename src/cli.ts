import { Command } from "commander";
import { addCommand } from "./commands/add.js";
import { initCommand } from "./commands/init.js";
import { searchCommand } from "./commands/search.js";
import { showCommand } from "./commands/show.js";
import { tagCommand } from "./commands/tag.js";

const program = new Command();

program
  .name("samaritan")
  .description("Bug memory CLI for agents — store and search issue resolutions")
  .version("0.1.0")
  .option("--dir <path>", "project root directory");

initCommand(program);
addCommand(program);
searchCommand(program);
showCommand(program);
tagCommand(program);

program.parse();
