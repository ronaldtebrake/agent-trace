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

  // Ensure git user is configured
  try {
    execSync("git config user.name", { cwd: root, stdio: "ignore" });
  } catch {
    execSync('git config user.name "Test User"', { cwd: root, stdio: "ignore" });
  }
  try {
    execSync("git config user.email", { cwd: root, stdio: "ignore" });
  } catch {
    execSync('git config user.email "test@example.com"', { cwd: root, stdio: "ignore" });
  }

  // Stage and commit files
  console.log("\nCommitting files...");
  let commitSha: string;
  
  try {
    execSync("git add -A", { cwd: root, stdio: "pipe" });
    
    // Check if there are changes to commit
    const status = execSync("git status --porcelain", { cwd: root, encoding: "utf-8" });
    if (status.trim()) {
      try {
        const commitOutput = execSync('git commit -m "Add auth middleware and tests"', {
          cwd: root,
          encoding: "utf-8",
          stdio: "pipe",
        });
        if (commitOutput) console.log(commitOutput.trim());
      } catch (commitError: any) {
        // Get the actual error message
        const stderr = commitError.stderr?.toString() || "";
        const stdout = commitError.stdout?.toString() || "";
        const errorMsg = stderr || stdout || commitError.message || String(commitError);
        
        if (errorMsg.includes("nothing to commit") || errorMsg.includes("no changes")) {
          console.log("  (no changes to commit, using existing HEAD)");
        } else if (errorMsg.includes("user.name") || errorMsg.includes("user.email") || errorMsg.includes("Author identity unknown")) {
          console.error("  ❌ Git user not configured");
          console.error(`  Error: ${errorMsg.trim()}`);
          console.error("\n  Configure git:");
          console.error("    git config user.name 'Your Name'");
          console.error("    git config user.email 'your.email@example.com'");
          process.exit(1);
        } else {
          console.error("  ❌ Commit failed");
          console.error(`  Error: ${errorMsg.trim()}`);
          throw commitError;
        }
      }
    } else {
      console.log("  (no changes to commit, using existing HEAD)");
    }
    
    commitSha = execSync("git rev-parse HEAD", {
      cwd: root,
      encoding: "utf-8",
    }).trim();
  } catch (error: any) {
    const stderr = error.stderr?.toString() || "";
    const stdout = error.stdout?.toString() || "";
    const errorMsg = stderr || stdout || error.message || String(error);
    console.error("  ❌ Failed to commit files");
    console.error(`  Error: ${errorMsg.trim()}`);
    console.error("\n  Make sure git is configured:");
    console.error("    git config user.name 'Your Name'");
    console.error("    git config user.email 'your.email@example.com'");
    process.exit(1);
  }

  // Attach traces to commit
  console.log(`\nAttaching traces to commit ${commitSha.substring(0, 8)}...`);
  writeTracesToNotes(commitSha, [sampleTraces[0]]);
  console.log("  ✓ Attached trace for 'Auth Middleware Refactor'");

  // Create more commits with traces
  console.log("\nCreating additional commits...");
  
  // Commit 2: Stripe webhook
  let commitSha2: string | undefined;
  try {
    const webhookPath = join(root, "src/api/webhooks/stripe.ts");
    mkdirSync(join(webhookPath, ".."), { recursive: true });
    writeFileSync(webhookPath, "// Stripe webhook handler");
    execSync("git add src/api/webhooks/stripe.ts", { cwd: root, stdio: "ignore" });
    execSync('git commit -m "Fix Stripe webhook bug (PAY-291)"', {
      cwd: root,
      stdio: "ignore",
    });
    commitSha2 = execSync("git rev-parse HEAD", {
      cwd: root,
      encoding: "utf-8",
    }).trim();
  } catch (error) {
    console.warn("  ⚠ Warning: Failed to create second commit:", error);
  }
  if (commitSha2) {
    writeTracesToNotes(commitSha2, [sampleTraces[1]]);
    console.log("  ✓ Created commit with Stripe webhook trace");
  }

  // Commit 3: Analytics dashboard
  let commitSha3: string | undefined;
  try {
    const analyticsPath = join(root, "src/components/dashboard/Analytics.tsx");
    mkdirSync(join(analyticsPath, ".."), { recursive: true });
    writeFileSync(analyticsPath, "// Analytics component");
    execSync("git add src/components/dashboard/Analytics.tsx", {
      cwd: root,
      stdio: "ignore",
    });
    execSync('git commit -m "Add analytics dashboard feature"', {
      cwd: root,
      stdio: "ignore",
    });
    commitSha3 = execSync("git rev-parse HEAD", {
      cwd: root,
      encoding: "utf-8",
    }).trim();
  } catch (error) {
    console.warn("  ⚠ Warning: Failed to create third commit:", error);
  }
  
  if (commitSha3) {
    writeTracesToNotes(commitSha3, [sampleTraces[2]]);
    console.log("  ✓ Created commit with Analytics dashboard trace");
  }

  console.log("\n✅ Test data populated successfully!");
  console.log(`\nYou can now:`);
  console.log(`  1. Run 'agent-trace dashboard' to view the dashboard`);
  console.log(`  2. Run 'agent-trace analyze HEAD' to analyze commits`);
  console.log(`  3. Run 'agent-trace report' to see statistics`);
}

main();
