import simpleGit, { SimpleGit } from "simple-git";
import { getWorkspaceRoot } from "../lib/trace-store.js";

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  changes: Array<{
    line: number;
    type: "added" | "removed" | "modified";
  }>;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
  files: FileChange[];
}

export async function getCommitInfo(
  commitSha: string,
  root?: string
): Promise<CommitInfo> {
  const git: SimpleGit = simpleGit(root || getWorkspaceRoot());

  const log = await git.log({
    from: commitSha,
    to: commitSha,
    maxCount: 1,
  });

  if (log.total === 0) {
    throw new Error(`Commit ${commitSha} not found`);
  }

  const commit = log.latest!;
  const diff = await git.diff([commitSha + "^.." + commitSha, "--numstat"]);

  const files: FileChange[] = [];
  const diffLines = diff.split("\n").filter((line) => line.trim());

  for (const line of diffLines) {
    const parts = line.split("\t");
    if (parts.length >= 3) {
      const additions = parseInt(parts[0], 10) || 0;
      const deletions = parseInt(parts[1], 10) || 0;
      const path = parts.slice(2).join("\t");

      if (path && path !== "/dev/null") {
        files.push({
          path,
          additions,
          deletions,
          changes: [], // Will be populated if needed
        });
      }
    }
  }

  // Get detailed line changes
  const detailedDiff = await git.diff([
    commitSha + "^.." + commitSha,
    "--unified=0",
  ]);

  // Parse unified diff to get line numbers
  let currentFile = "";
  let lineNumber = 0;
  for (const line of detailedDiff.split("\n")) {
    if (line.startsWith("+++ b/") || line.startsWith("--- a/")) {
      const filePath = line.substring(6).trim();
      if (filePath && filePath !== "/dev/null") {
        currentFile = filePath;
        lineNumber = 0;
      }
    } else if (line.startsWith("@@")) {
      // Parse hunk header: @@ -start,count +start,count @@
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        lineNumber = parseInt(match[1], 10);
      }
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      const file = files.find((f) => f.path === currentFile);
      if (file) {
        file.changes.push({ line: lineNumber++, type: "added" });
      }
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      const file = files.find((f) => f.path === currentFile);
      if (file) {
        file.changes.push({ line: lineNumber, type: "removed" });
      }
    } else if (!line.startsWith("@") && line.trim()) {
      lineNumber++;
    }
  }

  return {
    sha: commit.hash,
    message: commit.message,
    author: commit.author_name,
    date: commit.date,
    files,
  };
}

export async function resolveCommit(target: string): Promise<string> {
  const git: SimpleGit = simpleGit(getWorkspaceRoot());

  if (target === "HEAD") {
    const log = await git.log({ maxCount: 1 });
    return log.latest?.hash || target;
  }

  // Try to resolve as commit SHA
  try {
    const revParse = await git.revparse([target]);
    return revParse.trim();
  } catch {
    throw new Error(`Could not resolve commit: ${target}`);
  }
}
