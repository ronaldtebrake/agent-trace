import { Command } from "commander";
import { attachStagingTraces } from "../../lib/git-hooks.js";
import chalk from "chalk";

export const attachStagingCommand = new Command("attach-staging")
  .description("Attach staging traces to current commit (internal use)")
  .action(() => {
    try {
      attachStagingTraces();
    } catch (error) {
      console.error(
        chalk.red(
          `Failed to attach staging traces: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      process.exit(1);
    }
  });
