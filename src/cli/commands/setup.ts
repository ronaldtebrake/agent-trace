import { Command } from "commander";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import chalk from "chalk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const setupCommand = new Command("setup")
  .description("Manually set up agent trace hooks")
  .action(() => {
    console.log(chalk.bold("\n🔧 Setting up Agent Trace hooks...\n"));

    try {
      // Run the installer
      const installerPath = resolve(__dirname, "../../setup/install-hooks.js");
      execFileSync("node", [installerPath], {
        stdio: "inherit",
      });
    } catch (error) {
      console.error(
        chalk.red(
          `Failed to set up hooks: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      process.exit(1);
    }
  });
