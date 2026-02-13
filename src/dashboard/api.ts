import { execFileSync } from "child_process";
import type { TraceRecord } from "../lib/types.js";
import {
  readTracesFromNotes,
  getCommitsWithTracesMetadata,
  readTracesFromNotesRange,
} from "../lib/git-notes.js";
import { getWorkspaceRoot } from "../lib/trace-store.js";

export interface DashboardStats {
  totalCommits: number;
  totalTraces: number;
  totalFiles: Set<string>;
  aiContributions: number;
  humanContributions: number;
  mixedContributions: number;
  models: Map<string, number>;
  tools: Map<string, number>;
  commits: Array<{
    sha: string;
    message: string;
    author: string;
    date: string;
    traceCount: number;
  }>;
}

/**
 * Get dashboard statistics for a repository
 */
export async function getDashboardStats(
  fromCommit?: string,
  toCommit: string = "HEAD"
): Promise<DashboardStats> {
  // Get workspace root - this should be the repo where dashboard is running
  let root: string;
  try {
    root = getWorkspaceRoot();
  } catch (error) {
    // Fallback to process.cwd() if git repo detection fails
    root = process.cwd();
  }
  const stats: DashboardStats = {
    totalCommits: 0,
    totalTraces: 0,
    totalFiles: new Set(),
    aiContributions: 0,
    humanContributions: 0,
    mixedContributions: 0,
    models: new Map(),
    tools: new Map(),
    commits: [],
  };

  // Get commits with traces
  let commits: string[];
  if (fromCommit) {
    // Get commits in range
    try {
      const output = execFileSync(
        "git",
        ["rev-list", `${fromCommit}..${toCommit}`],
        { cwd: root, encoding: "utf-8" }
      );
      commits = output.trim().split("\n").filter((c) => c.trim());
    } catch {
      commits = [];
    }
  } else {
    // Get all commits with traces
    const commitsWithTraces = getCommitsWithTracesMetadata(root);
    commits = commitsWithTraces.map((c) => c.commit);
    
    // If no commits with traces found, try getting all recent commits and checking for traces
    if (commits.length === 0) {
      try {
        const allCommits = execFileSync(
          "git",
          ["rev-list", "--max-count=50", "HEAD"],
          { cwd: root, encoding: "utf-8" }
        )
          .trim()
          .split("\n")
          .filter((c) => c.trim());
        
        // Check each commit for traces
        for (const commit of allCommits) {
          const traces = readTracesFromNotes(commit, root);
          if (traces.length > 0) {
            commits.push(commit);
          }
        }
      } catch {
        // Ignore errors
      }
    }
  }

  stats.totalCommits = commits.length;

  // Get commit metadata
  for (const commit of commits) {
    const traces = readTracesFromNotes(commit, root);
    if (traces.length === 0) continue;

    // Get commit info
    const log = execFileSync(
      "git",
      ["log", "-1", "--format=%H|%s|%an|%ai", commit],
      { cwd: root, encoding: "utf-8" }
    ).trim();

    const [sha, message, author, date] = log.split("|");

    stats.commits.push({
      sha: sha || commit,
      message: message || "",
      author: author || "",
      date: date || "",
      traceCount: traces.length,
    });

    // Aggregate stats
    for (const trace of traces) {
      stats.totalTraces++;

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
            const current =
              stats.models.get(conversation.contributor.model_id) || 0;
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
  }

  return stats;
}

/**
 * Get traces for a specific commit
 */
export function getCommitTraces(commitSha: string): TraceRecord[] {
  const root = getWorkspaceRoot();
  return readTracesFromNotes(commitSha, root);
}

/**
 * Get file attribution for a specific file across commits
 */
export function getFileAttribution(
  filePath: string,
  fromCommit?: string,
  toCommit: string = "HEAD"
): Array<{
  commit: string;
  ranges: Array<{
    start_line: number;
    end_line: number;
    contributor?: { type: string; model_id?: string };
  }>;
}> {
  const root = getWorkspaceRoot();
  let commits: string[];

  if (fromCommit) {
    const output = execFileSync(
      "git",
      ["rev-list", `${fromCommit}..${toCommit}`],
      { cwd: root, encoding: "utf-8" }
    );
    commits = output.trim().split("\n").filter((c) => c.trim());
  } else {
    commits = getCommitsWithTracesMetadata(root).map((c) => c.commit);
  }

  const attribution: Array<{
    commit: string;
    ranges: Array<{
      start_line: number;
      end_line: number;
      contributor?: { type: string; model_id?: string };
    }>;
  }> = [];

  for (const commit of commits) {
    const traces = readTracesFromNotes(commit, root);
    const ranges: Array<{
      start_line: number;
      end_line: number;
      contributor?: { type: string; model_id?: string };
    }> = [];

    for (const trace of traces) {
      for (const file of trace.files) {
        if (file.path === filePath) {
          for (const conversation of file.conversations) {
            for (const range of conversation.ranges) {
              ranges.push({
                start_line: range.start_line,
                end_line: range.end_line,
                contributor: {
                  type:
                    conversation.contributor?.type ||
                    range.contributor?.type ||
                    "unknown",
                  model_id:
                    conversation.contributor?.model_id ||
                    range.contributor?.model_id,
                },
              });
            }
          }
        }
      }
    }

    if (ranges.length > 0) {
      attribution.push({ commit, ranges });
    }
  }

  return attribution;
}

/**
 * Get raw git notes content for a commit
 */
export function getRawNotes(commitSha: string): string {
  const root = getWorkspaceRoot();
  try {
    // Try to resolve the commit SHA first (handles short SHAs)
    let resolvedSha = commitSha;
    try {
      resolvedSha = execFileSync(
        "git",
        ["rev-parse", commitSha],
        { cwd: root, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
      ).trim();
    } catch {
      // If rev-parse fails, use the original SHA
    }
    
    const noteContent = execFileSync(
      "git",
      ["notes", "--ref", "refs/notes/agent-trace", "show", resolvedSha],
      { cwd: root, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
    ).trim();
    return noteContent;
  } catch (error: any) {
    if (error.status === 128 || error.code === 128 || error.status === 1) {
      return ""; // Note doesn't exist
    }
    throw new Error(`Failed to read git notes: ${error.message || error}`);
  }
}

/**
 * Get git diff for a commit
 */
export function getCommitDiff(commitSha: string): string {
  const root = getWorkspaceRoot();
  try {
    // Get parent commit
    const parentSha = execFileSync(
      "git",
      ["rev-parse", `${commitSha}^`],
      { cwd: root, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
    ).trim();
    
    const diff = execFileSync(
      "git",
      ["diff", parentSha, commitSha],
      { cwd: root, encoding: "utf-8" }
    );
    return diff;
  } catch (error: any) {
    // If no parent (initial commit), show diff against empty tree
    try {
      const diff = execFileSync(
        "git",
        ["show", commitSha, "--format="],
        { cwd: root, encoding: "utf-8" }
      );
      return diff;
    } catch {
      return `Error: Could not get diff for commit ${commitSha}`;
    }
  }
}

/**
 * Get file content at a specific commit
 */
export function getFileContent(commitSha: string, filePath: string): string {
  const root = getWorkspaceRoot();
  try {
    const content = execFileSync(
      "git",
      ["show", `${commitSha}:${filePath}`],
      { cwd: root, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
    );
    return content;
  } catch (error: any) {
    return `Error: Could not read file ${filePath} at commit ${commitSha}`;
  }
}
