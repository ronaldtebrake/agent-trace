import { Command } from "commander";
import { existsSync } from "fs";
import { join } from "path";
import { getWorkspaceRoot } from "../../lib/trace-store.js";
import { getCursorHooksPath, getClaudeSettingsPath } from "../../utils/paths.js";
import { hasTracesInNotes, getCommitsWithTraces, ensureNotesRef } from "../../lib/git-notes.js";
import chalk from "chalk";

export const validateCommand = new Command("validate")
  .description("Check if repository has agent traces configured")
  .option("--strict", "Exit with error if traces are not configured", false)
  .action((options: { strict: boolean }) => {
    const root = getWorkspaceRoot();
    const cursorHooksPath = getCursorHooksPath(root);
    const claudeSettingsPath = getClaudeSettingsPath(root);

    console.log(chalk.bold("\n🔍 Validating Agent Trace Configuration\n"));
    console.log(`Repository: ${root}\n`);

    let hasTraces = false;
    let hasHooks = false;
    let traceCount = 0;

    // Check for git notes
    try {
      ensureNotesRef();
      const commitsWithTraces = getCommitsWithTraces();
      traceCount = commitsWithTraces.length;
      
      if (traceCount > 0) {
        hasTraces = true;
        console.log(chalk.green("✓") + ` Git notes configured: refs/notes/agent-trace`);
        console.log(`  ${traceCount} commit(s) with traces`);
      } else {
        console.log(chalk.yellow("⚠") + ` Git notes configured but no traces found yet`);
      }
    } catch (error) {
      console.log(chalk.red("✗") + ` Failed to check git notes: ${error}`);
    }

    console.log();

    // Check for hooks
    if (existsSync(cursorHooksPath)) {
      hasHooks = true;
      console.log(chalk.green("✓") + ` Cursor hooks configured: ${cursorHooksPath}`);
    } else {
      console.log(chalk.yellow("⚠") + ` Cursor hooks not found: ${cursorHooksPath}`);
    }

    if (existsSync(claudeSettingsPath)) {
      hasHooks = true;
      console.log(chalk.green("✓") + ` Claude Code settings found: ${claudeSettingsPath}`);
    } else {
      console.log(chalk.yellow("⚠") + ` Claude Code settings not found: ${claudeSettingsPath}`);
    }

    console.log();

    if (hasTraces && hasHooks) {
      console.log(chalk.green("✓ Repository is properly configured for Agent Trace!"));
      process.exit(0);
    } else if (hasTraces && !hasHooks) {
      console.log(
        chalk.yellow("⚠ Traces exist but hooks may not be configured.")
      );
      console.log("  Run 'agent-trace setup' to configure hooks.");
      if (options.strict) process.exit(1);
    } else if (!hasTraces && hasHooks) {
      console.log(
        chalk.yellow("⚠ Hooks are configured but no traces found yet.")
      );
      console.log("  Traces will be created when AI tools modify files.");
      if (options.strict) process.exit(1);
    } else {
      console.log(chalk.red("✗ Agent Trace is not configured."));
      console.log("  Run 'agent-trace setup' to configure hooks.");
      if (options.strict) process.exit(1);
    }
  });
