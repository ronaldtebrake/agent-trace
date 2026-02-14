import { execFileSync } from "child_process";
import { readFileSync, existsSync } from "fs";
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
const GIT_DIFF_MAX_BUFFER = 10 * 1024 * 1024; // 10MB for large diffs (e.g. initial commit)
const GIT_STDIO = { encoding: "utf-8" as const, stdio: ["pipe", "pipe", "ignore"] as const };

export function getCommitDiff(commitSha: string): string {
  let root: string;
  try {
    root = getWorkspaceRoot();
  } catch {
    root = process.cwd();
  }
  const opts = { cwd: root, ...GIT_STDIO, maxBuffer: GIT_DIFF_MAX_BUFFER };
  try {
    let resolvedSha = commitSha;
    try {
      resolvedSha = execFileSync(
        "git",
        ["rev-parse", commitSha],
        { ...opts, maxBuffer: 1024 * 1024 }
      ).trim();
    } catch {
      throw new Error(`Commit not found: ${commitSha}`);
    }
    let parentSha: string;
    try {
      parentSha = execFileSync(
        "git",
        ["rev-parse", `${resolvedSha}^`],
        { ...opts, maxBuffer: 1024 * 1024 }
      ).trim();
    } catch {
      // Initial commit: no parent; use git show to get full diff
      return execFileSync(
        "git",
        ["show", resolvedSha, "--format="],
        opts
      );
    }
    return execFileSync("git", ["diff", parentSha, resolvedSha], opts);
  } catch (error: any) {
    throw new Error(`Could not get diff for commit ${commitSha}: ${error.message || error}`);
  }
}

/**
 * Get commit message for a commit
 */
export function getCommitMessage(commitSha: string): string {
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
    
    const message = execFileSync(
      "git",
      ["log", "-1", "--format=%s", resolvedSha],
      { cwd: root, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
    ).trim();
    return message;
  } catch (error: any) {
    return `Commit ${commitSha.substring(0, 8)}`;
  }
}

/**
 * Get list of files changed in a commit (from git diff)
 */
export function getCommitFiles(commitSha: string): string[] {
  const root = getWorkspaceRoot();
  try {
    let resolvedSha = commitSha;
    try {
      resolvedSha = execFileSync(
        "git",
        ["rev-parse", commitSha],
        { cwd: root, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
      ).trim();
    } catch {
      return [];
    }
    const output = execFileSync(
      "git",
      ["diff-tree", "--no-commit-id", "--name-only", "-r", resolvedSha],
      { cwd: root, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
    ).trim();
    return output ? output.split("\n").filter((p) => p.trim()) : [];
  } catch {
    return [];
  }
}

/**
 * Get file content at a specific commit
 */
export function getFileContent(commitSha: string, filePath: string): string {
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
    
    const content = execFileSync(
      "git",
      ["show", `${resolvedSha}:${filePath}`],
      { cwd: root, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
    );
    return content;
  } catch (error: any) {
    if (error.status === 128 || error.code === 128 || error.status === 1) {
      throw new Error(`File not found: ${filePath} at commit ${commitSha}`);
    }
    throw new Error(`Could not read file ${filePath} at commit ${commitSha}: ${error.message || error}`);
  }
}

export interface TranscriptMessage {
  role: string;
  content: string;
}

/**
 * Read and parse transcript file
 */
export function getTranscriptContent(transcriptUrl: string): TranscriptMessage[] | null {
  try {
    if (transcriptUrl.startsWith("file://")) {
      let filePath = transcriptUrl.replace(/^file:\/\//, "");
      try {
        filePath = decodeURIComponent(filePath);
      } catch {
        // use original path
      }
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, "utf-8");
        return parseTranscript(content);
      }
      console.error(`Transcript file not found: ${filePath}`);
    }
    return null;
  } catch (error) {
    console.error("Error reading transcript:", error, "URL:", transcriptUrl);
    return null;
  }
}

/**
 * Parse transcript content into user/assistant messages.
 * Supports both JSONL format and plain text format.
 */
function parseTranscript(content: string): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  const lines = content.split("\n").filter((line) => line.trim());

  if (lines.length > 0 && lines[0].trim().startsWith("{")) {
    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as { role?: string; message?: { content?: Array<{ type?: string; text?: string }> } };
        if (obj.role && obj.message?.content) {
          let textParts = obj.message.content
            .filter((item) => item.type === "text")
            .map((item) => item.text ?? "")
            .join("\n")
            .trim();
          textParts = textParts.replace(/<user_query>\s*/gi, "").replace(/\s*<\/user_query>/gi, "");
          if (textParts) {
            messages.push({ role: obj.role, content: textParts });
          }
        }
      } catch {
        // skip invalid JSON lines
      }
    }
    if (messages.length > 0) return messages;
  }

  let currentRole: string | null = null;
  const currentContent: string[] = [];
  for (const line of lines) {
    if (line.startsWith("user:") || line.startsWith("assistant:")) {
      if (currentRole && currentContent.length > 0) {
        messages.push({ role: currentRole, content: currentContent.join("\n").trim() });
      }
      currentRole = line.startsWith("user:") ? "user" : "assistant";
      const rest = line.substring(line.indexOf(":") + 1).trim();
      currentContent.length = 0;
      if (rest) currentContent.push(rest);
    } else if (currentRole) {
      currentContent.push(line);
    }
  }
  if (currentRole && currentContent.length > 0) {
    messages.push({ role: currentRole, content: currentContent.join("\n").trim() });
  }
  return messages;
}
