import { Command } from "commander";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import chalk from "chalk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const populateTestCommand = new Command("populate-test")
  .description("Populate repository with test traces and code files")
  .action(() => {
    console.log(chalk.bold("\n🧪 Populating test data...\n"));

    try {
      const scriptPath = resolve(__dirname, "../../scripts/populate-test-data.js");
      execFileSync("node", [scriptPath], {
        stdio: "inherit",
      });
    } catch (error) {
      console.error(
        chalk.red(
          `Failed to populate test data: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      process.exit(1);
    }
  });
