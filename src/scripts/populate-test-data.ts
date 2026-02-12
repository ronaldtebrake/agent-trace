#!/usr/bin/env node

import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { getWorkspaceRoot } from "../lib/trace-store.js";
import { writeTracesToNotes, ensureNotesRef } from "../lib/git-notes.js";
import { sampleTraces, sampleCodeFiles } from "../__tests__/fixtures/traces.js";

/**
 * Populate test repository with sample traces and code files
 */
function main() {
  const root = getWorkspaceRoot();
  
  console.log("Populating test data...\n");

  // Ensure notes ref exists
  ensureNotesRef();

  // Create test code files
  console.log("Creating test code files...");
  for (const [path, content] of Object.entries(sampleCodeFiles)) {
    const fullPath = join(root, path);
    const dir = join(fullPath, "..");
    mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, content);
    console.log(`  ✓ ${path}`);
  }

  // Stage and commit files
  console.log("\nCommitting files...");
  execSync("git add -A", { cwd: root, stdio: "ignore" });
  execSync('git commit -m "Add auth middleware and tests"', {
    cwd: root,
    stdio: "ignore",
  });

  const commitSha = execSync("git rev-parse HEAD", {
    cwd: root,
    encoding: "utf-8",
  }).trim();

  // Attach traces to commit
  console.log(`\nAttaching traces to commit ${commitSha.substring(0, 8)}...`);
  writeTracesToNotes(commitSha, [sampleTraces[0]]);
  console.log("  ✓ Attached trace for 'Auth Middleware Refactor'");

  // Create more commits with traces
  console.log("\nCreating additional commits...");
  
  // Commit 2: Stripe webhook
  writeFileSync(join(root, "src/api/webhooks/stripe.ts"), "// Stripe webhook handler");
  execSync("git add src/api/webhooks/stripe.ts", { cwd: root, stdio: "ignore" });
  execSync('git commit -m "Fix Stripe webhook bug (PAY-291)"', {
    cwd: root,
    stdio: "ignore",
  });
  const commitSha2 = execSync("git rev-parse HEAD", {
    cwd: root,
    encoding: "utf-8",
  }).trim();
  writeTracesToNotes(commitSha2, [sampleTraces[1]]);
  console.log("  ✓ Created commit with Stripe webhook trace");

  // Commit 3: Analytics dashboard
  writeFileSync(join(root, "src/components/dashboard/Analytics.tsx"), "// Analytics component");
  execSync("git add src/components/dashboard/Analytics.tsx", {
    cwd: root,
    stdio: "ignore",
  });
  execSync('git commit -m "Add analytics dashboard feature"', {
    cwd: root,
    stdio: "ignore",
  });
  const commitSha3 = execSync("git rev-parse HEAD", {
    cwd: root,
    encoding: "utf-8",
  }).trim();
  writeTracesToNotes(commitSha3, [sampleTraces[2]]);
  console.log("  ✓ Created commit with Analytics dashboard trace");

  console.log("\n✅ Test data populated successfully!");
  console.log(`\nYou can now:`);
  console.log(`  1. Run 'agent-trace dashboard' to view the dashboard`);
  console.log(`  2. Run 'agent-trace analyze HEAD' to analyze commits`);
  console.log(`  3. Run 'agent-trace report' to see statistics`);
}

main();
