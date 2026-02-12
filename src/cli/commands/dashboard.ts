import { Command } from "commander";
import { startDashboardServer } from "../../dashboard/server.js";
import chalk from "chalk";

export const dashboardCommand = new Command("dashboard")
  .alias("serve")
  .description("Start dashboard API server")
  .option("-p, --port <port>", "Port to run server on", "3000")
  .action((options: { port: string }) => {
    const port = parseInt(options.port, 10);
    
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(chalk.red(`Invalid port: ${options.port}`));
      process.exit(1);
    }

    console.log(chalk.bold("\n🚀 Starting Agent Trace Dashboard...\n"));
    console.log(chalk.dim("Press Ctrl+C to stop\n"));

    try {
      startDashboardServer(port);
    } catch (error) {
      console.error(
        chalk.red(
          `Failed to start dashboard: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      process.exit(1);
    }
  });
