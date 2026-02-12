#!/usr/bin/env node

import { Command } from "commander";
import { analyzeCommand } from "./commands/analyze.js";
import { validateCommand } from "./commands/validate.js";
import { reportCommand } from "./commands/report.js";
import { setupCommand } from "./commands/setup.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { attachStagingCommand } from "./commands/attach-staging.js";
import { populateTestCommand } from "./commands/populate-test.js";

const program = new Command();

program
  .name("agent-trace")
  .description("CLI tool for capturing and analyzing Agent Trace data")
  .version("0.1.0");

program.addCommand(analyzeCommand);
program.addCommand(validateCommand);
program.addCommand(reportCommand);
program.addCommand(setupCommand);
program.addCommand(dashboardCommand);
program.addCommand(attachStagingCommand);
program.addCommand(populateTestCommand);

program.parse();
