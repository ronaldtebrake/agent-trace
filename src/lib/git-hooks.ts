import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { getWorkspaceRoot } from "./trace-store.js";
import { writeTracesToNotes } from "./git-notes.js";
import { ensureNotesRef } from "./git-notes.js";
import { TraceRecordSchema, type TraceRecord } from "./schemas.js";

const STAGING_PATH = ".agent-trace/staging.jsonl";

/**
 * Install git hook to attach staging traces to commits
 */
export function installGitHook(): void {
  const root = getWorkspaceRoot();
  const hooksDir = join(root, ".git", "hooks");
  const hookPath = join(hooksDir, "post-commit");

  if (!existsSync(hooksDir)) {
    throw new Error("Not in a git repository");
  }

  const hookContent = `#!/bin/sh
# Agent Trace hook - attach staging traces to commit
if [ -f .agent-trace/staging.jsonl ]; then
  node_modules/.bin/agent-trace attach-staging 2>/dev/null || true
fi
`;

  // Check if hook already exists
  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, "utf-8");
    if (existing.includes("agent-trace")) {
      return; // Already installed
    }
    // Append to existing hook
    const newContent = existing + "\n" + hookContent;
    writeFileSync(hookPath, newContent, { mode: 0o755 });
  } else {
    writeFileSync(hookPath, hookContent, { mode: 0o755 });
  }
}

/**
 * Attach staging traces to the current HEAD commit
 */
export function attachStagingTraces(): void {
  const root = getWorkspaceRoot();
  const stagingPath = join(root, STAGING_PATH);

  if (!existsSync(stagingPath)) {
    return;
  }

  ensureNotesRef(root);

  // Get current HEAD
  let commitSha: string;
  try {
    commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf-8",
    }).trim();
  } catch {
    return; // No commit yet
  }

  // Read staging traces
  const content = readFileSync(stagingPath, "utf-8");
  const lines = content.trim().split("\n").filter((line) => line.trim());

  const traces: TraceRecord[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const trace = TraceRecordSchema.parse(parsed);
      // Update vcs.revision to match the commit we're attaching to
      if (trace.vcs) {
        trace.vcs.revision = commitSha;
      }
      traces.push(trace);
    } catch (error) {
      console.warn(`Failed to parse staging trace: ${error}`);
    }
  }

  // Attach to commit
  if (traces.length > 0) {
    const root = getWorkspaceRoot();
    writeTracesToNotes(commitSha, traces, root);
    
    // Clear staging file
    unlinkSync(stagingPath);
  }
}
