import { Command } from "commander";
import { readTraces } from "../../lib/trace-store.js";
import { getWorkspaceRoot } from "../../lib/trace-store.js";
import { getCommitsWithTracesMetadata, readTracesFromNotesRange } from "../../lib/git-notes.js";
import chalk from "chalk";

export const reportCommand = new Command("report")
  .description("Generate contribution report (AI vs human)")
  .option("--format <format>", "Output format: 'text' or 'json'", "text")
  .option("--since <date>", "Only include traces since date (ISO format)")
  .action((options: { format: string; since?: string }) => {
    const root = getWorkspaceRoot();
    
    // Read traces from git notes
    let traces = readTraces(root);
    
    // If since date specified, filter by timestamp
    if (options.since) {
      const sinceDate = new Date(options.since);
      traces = traces.filter(
        (trace) => new Date(trace.timestamp) >= sinceDate
      );
    }

    // Aggregate stats
    const stats = {
      totalTraces: traces.length,
      totalFiles: new Set<string>(),
      aiContributions: 0,
      humanContributions: 0,
      mixedContributions: 0,
      models: new Map<string, number>(),
      tools: new Map<string, number>(),
    };

    for (const trace of traces) {
      for (const file of trace.files) {
        stats.totalFiles.add(file.path);

        for (const conversation of file.conversations) {
          const contributorType =
            conversation.contributor?.type || "unknown";
          const rangeCount = conversation.ranges.length;

          if (contributorType === "ai") {
            stats.aiContributions += rangeCount;
          } else if (contributorType === "human") {
            stats.humanContributions += rangeCount;
          } else if (contributorType === "mixed") {
            stats.mixedContributions += rangeCount;
          }

          if (conversation.contributor?.model_id) {
            const current = stats.models.get(
              conversation.contributor.model_id
            ) || 0;
            stats.models.set(
              conversation.contributor.model_id,
              current + rangeCount
            );
          }
        }
      }

      if (trace.tool?.name) {
        const current = stats.tools.get(trace.tool.name) || 0;
        stats.tools.set(trace.tool.name, current + 1);
      }
    }

    if (options.format === "json") {
      console.log(
        JSON.stringify(
          {
            ...stats,
            totalFiles: stats.totalFiles.size,
            models: Object.fromEntries(stats.models),
            tools: Object.fromEntries(stats.tools),
          },
          null,
          2
        )
      );
      return;
    }

    // Text output
    console.log(chalk.bold("\n📈 Agent Trace Contribution Report\n"));

    if (options.since) {
      console.log(`Period: Since ${options.since}\n`);
    }

    console.log(chalk.bold("Summary:"));
    console.log(`  Total traces: ${stats.totalTraces}`);
    console.log(`  Files modified: ${stats.totalFiles.size}`);
    console.log(`  AI contributions: ${chalk.red(stats.aiContributions)}`);
    console.log(`  Human contributions: ${chalk.green(stats.humanContributions)}`);
    if (stats.mixedContributions > 0) {
      console.log(`  Mixed contributions: ${chalk.yellow(stats.mixedContributions)}`);
    }

    console.log();

    if (stats.models.size > 0) {
      console.log(chalk.bold("Models used:"));
      const sortedModels = Array.from(stats.models.entries()).sort(
        (a, b) => b[1] - a[1]
      );
      for (const [model, count] of sortedModels) {
        console.log(`  ${model}: ${count} ranges`);
      }
      console.log();
    }

    if (stats.tools.size > 0) {
      console.log(chalk.bold("Tools used:"));
      const sortedTools = Array.from(stats.tools.entries()).sort(
        (a, b) => b[1] - a[1]
      );
      for (const [tool, count] of sortedTools) {
        console.log(`  ${tool}: ${count} traces`);
      }
    }
  });
