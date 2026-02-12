import { Command } from "commander";
import { analyzeCommit } from "../../analyze/pr-analyzer.js";
import chalk from "chalk";

export const analyzeCommand = new Command("analyze")
  .description("Analyze commit for agent traces")
  .argument("<target>", "Commit SHA, branch name, or 'HEAD' for current commit")
  .option(
    "--format <format>",
    "Output format: 'text' or 'json'",
    "text"
  )
  .action(async (target: string, options: { format: string }) => {
    try {
      const result = await analyzeCommit(target);
      
      if (options.format === "json") {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      // Text output
      console.log(chalk.bold("\n📊 Agent Trace Analysis\n"));
      console.log(`Target: ${target}`);
      console.log(`Commit: ${result.commit || "N/A"}\n`);

      if (result.files.length === 0) {
        console.log(chalk.yellow("⚠ No files with traces found."));
        return;
      }

      console.log(chalk.bold("Files analyzed:\n"));
      for (const file of result.files) {
        const aiLines = file.ranges.filter((r) => r.contributor?.type === "ai").length;
        const humanLines = file.ranges.filter((r) => r.contributor?.type === "human").length;
        const totalLines = file.ranges.length;

        console.log(`  ${chalk.cyan(file.path)}`);
        console.log(`    AI: ${chalk.red(aiLines)} | Human: ${chalk.green(humanLines)} | Total: ${totalLines}`);
        
        if (file.models.length > 0) {
          console.log(`    Models: ${file.models.join(", ")}`);
        }
        console.log();
      }

      const totalAI = result.files.reduce(
        (sum, f) => sum + f.ranges.filter((r) => r.contributor?.type === "ai").length,
        0
      );
      const totalHuman = result.files.reduce(
        (sum, f) => sum + f.ranges.filter((r) => r.contributor?.type === "human").length,
        0
      );

      console.log(chalk.bold("\nSummary:"));
      console.log(`  Total AI contributions: ${chalk.red(totalAI)}`);
      console.log(`  Total human contributions: ${chalk.green(totalHuman)}`);
      console.log(`  Files analyzed: ${result.files.length}`);
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });
