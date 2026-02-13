import { execFileSync, spawnSync } from "child_process";
import { z } from "zod";
import { TraceRecordSchema, type TraceRecord } from "./schemas.js";
import type { Conversation } from "./types.js";

const NOTES_REF = "refs/notes/agent-trace";

/**
 * Consolidate multiple traces into fewer trace records by merging:
 * - Traces with the same conversation_id
 * - File edits from the same file in the same trace
 */
function consolidateTraces(traces: TraceRecord[]): TraceRecord[] {
  if (traces.length <= 1) {
    return traces;
  }

  // Group traces by conversation_id (or create a group for traces without one)
  const groups = new Map<string, TraceRecord[]>();
  
  for (const trace of traces) {
    // Use conversation_id from first file's first conversation, or "no-conversation" as key
    const conversationId = trace.files[0]?.conversations[0]?.url || 
                           trace.metadata?.conversation_id as string || 
                           "no-conversation";
    
    if (!groups.has(conversationId)) {
      groups.set(conversationId, []);
    }
    groups.get(conversationId)!.push(trace);
  }

  const consolidated: TraceRecord[] = [];

  for (const [conversationId, groupTraces] of groups.entries()) {
    if (groupTraces.length === 1) {
      consolidated.push(groupTraces[0]);
      continue;
    }

    // Merge traces in this group
    // Use the first trace as the base
    const baseTrace = groupTraces[0];
    
    // Collect all files from all traces
    const fileMap = new Map<string, {
      path: string;
      conversations: Conversation[];
    }>();

    for (const trace of groupTraces) {
      for (const file of trace.files) {
        if (!fileMap.has(file.path)) {
          fileMap.set(file.path, {
            path: file.path,
            conversations: [],
          });
        }
        
        // Merge conversations for this file
        const fileEntry = fileMap.get(file.path)!;
        for (const conv of file.conversations) {
          // Check if conversation already exists (same contributor and ranges)
          const existing = fileEntry.conversations.find(
            (c) =>
              c.contributor?.type === conv.contributor?.type &&
              c.contributor?.model_id === conv.contributor?.model_id
          );
          
          if (existing) {
            // Merge ranges
            const existingRanges = new Set(
              existing.ranges.map((r) => `${r.start_line}-${r.end_line}`)
            );
            for (const range of conv.ranges) {
              const rangeKey = `${range.start_line}-${range.end_line}`;
              if (!existingRanges.has(rangeKey)) {
                existing.ranges.push(range);
                existingRanges.add(rangeKey);
              }
            }
          } else {
            fileEntry.conversations.push(conv);
          }
        }
      }
    }

    // Create consolidated trace
    const consolidatedTrace: TraceRecord = {
      ...baseTrace,
      id: baseTrace.id, // Keep first trace's ID
      timestamp: baseTrace.timestamp, // Keep earliest timestamp
      files: Array.from(fileMap.values()),
    };

    consolidated.push(consolidatedTrace);
  }

  return consolidated;
}

/**
 * Read trace records from git notes for a specific commit
 */
export function readTracesFromNotes(commitSha: string, cwd?: string): TraceRecord[] {
  try {
    const noteContent = execFileSync(
      "git",
      ["notes", "--ref", NOTES_REF, "show", commitSha],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"], cwd }
    ).trim();

    if (!noteContent) {
      return [];
    }

    // Notes can contain either a single JSON object or an array
    const parsed = JSON.parse(noteContent);
    const records = Array.isArray(parsed) ? parsed : [parsed];

    return records
      .map((record) => {
        try {
          return TraceRecordSchema.parse(record);
        } catch (error) {
          console.warn(`Failed to parse trace record: ${error}`);
          return null;
        }
      })
      .filter((trace): trace is TraceRecord => trace !== null);
  } catch (error: any) {
    // Note doesn't exist or git command failed
    // Git returns status 128 when note doesn't exist
    if (error.status === 1 || error.status === 128 || error.code === 1 || error.code === 128) {
      return [];
    }
    throw error;
  }
}

/**
 * Write trace records to git notes for a specific commit
 */
export function writeTracesToNotes(
  commitSha: string,
  traces: TraceRecord[],
  cwd?: string
): void {
  if (traces.length === 0) {
    return;
  }

  // Read existing traces (may return empty array if note doesn't exist)
  let existing: TraceRecord[] = [];
  try {
    existing = readTracesFromNotes(commitSha, cwd);
  } catch (error) {
    // If reading fails, start with empty array
    existing = [];
  }
  
  // Merge with new traces (avoid duplicates by ID)
  const existingIds = new Set(existing.map((t) => t.id));
  const newTraces = traces.filter((t) => !existingIds.has(t.id));
  const allTraces = [...existing, ...newTraces];

  // Consolidate traces: merge traces with same conversation_id and file
  const consolidated = consolidateTraces(allTraces);

  // Store as JSON array
  const content = JSON.stringify(consolidated, null, 2);

  // Ensure notes ref is valid before writing
  try {
    ensureNotesRef(cwd);
  } catch {
    // If ensure fails, try to fix broken ref
    try {
      execFileSync("git", ["update-ref", "-d", NOTES_REF], {
        stdio: "ignore",
        cwd,
      });
      ensureNotesRef(cwd);
    } catch {
      // Continue anyway, git notes add will create the ref if needed
    }
  }

  // Use -F flag to read from stdin to avoid shell escaping issues
  const proc = spawnSync(
    "git",
    ["notes", "--ref", NOTES_REF, "add", "-f", "-F", "-", commitSha],
    {
      input: content,
      encoding: "utf-8",
      cwd,
    }
  );

  if (proc.status !== 0) {
    const errorMsg = proc.stderr?.toString() || proc.stdout?.toString() || "unknown error";
    
    // If it's a broken ref error, try to fix it
    if (errorMsg.includes("Failed to read notes tree")) {
      try {
        execFileSync("git", ["update-ref", "-d", NOTES_REF], {
          stdio: "ignore",
          cwd,
        });
        ensureNotesRef(cwd);
        
        // Retry once
        const retryProc = spawnSync(
          "git",
          ["notes", "--ref", NOTES_REF, "add", "-f", "-F", "-", commitSha],
          {
            input: content,
            encoding: "utf-8",
            cwd,
          }
        );
        
        if (retryProc.status === 0) {
          return; // Success on retry
        }
      } catch {
        // Fall through to throw error
      }
    }
    
    throw new Error(`Failed to write git note: ${errorMsg.trim()}`);
  }
}

/**
 * Append a trace record to git notes for a commit
 */
export function appendTraceToNotes(
  commitSha: string,
  trace: TraceRecord,
  cwd?: string
): void {
  writeTracesToNotes(commitSha, [trace], cwd);
}

/**
 * Read all trace records from git notes for a range of commits
 */
export function readTracesFromNotesRange(
  fromCommit: string,
  toCommit: string = "HEAD",
  cwd?: string
): TraceRecord[] {
  try {
    // Get all commits in range
    const commits = execFileSync(
      "git",
      ["rev-list", `${fromCommit}..${toCommit}`],
      { encoding: "utf-8" }
    )
      .trim()
      .split("\n")
      .filter((c) => c.trim());

    const allTraces: TraceRecord[] = [];
    for (const commit of commits) {
      const traces = readTracesFromNotes(commit, cwd);
      allTraces.push(...traces);
    }

    return allTraces;
  } catch (error) {
    console.warn(`Failed to read traces from range: ${error}`);
    return [];
  }
}

/**
 * Check if a commit has traces in notes
 */
export function hasTracesInNotes(commitSha: string, cwd?: string): boolean {
  try {
    execFileSync(
      "git",
      ["notes", "--ref", NOTES_REF, "show", commitSha],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"], cwd }
    );
    return true;
  } catch (error: any) {
    // Note doesn't exist - git returns status 128
    if (error.status === 128 || error.code === 128) {
      return false;
    }
    // Other errors - assume no note
    return false;
  }
}

/**
 * Get all commits that have traces in notes
 */
export function getCommitsWithTraces(cwd?: string): string[] {
  try {
    // Ensure notes ref exists first
    ensureNotesRef(cwd);
    
    const output = execFileSync(
      "git",
      ["notes", "--ref", NOTES_REF, "list"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], cwd }
    );

    if (!output || !output.trim()) {
      return [];
    }

    const commits = output
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        // Format: <commit-sha> <notes-object-sha>
        // Can also be just <commit-sha> in some git versions
        const parts = line.trim().split(/\s+/);
        const sha = parts[0];
        // Validate it looks like a commit SHA (at least 7 chars, hex)
        if (sha && /^[0-9a-f]{7,40}$/i.test(sha)) {
          return sha;
        }
        return null;
      })
      .filter((sha): sha is string => sha !== null);
    
    return commits;
  } catch (error: any) {
    // If notes ref doesn't exist or is empty, return empty array
    if (error.status === 128 || error.code === 128 || error.status === 1) {
      return [];
    }
    // Log other errors for debugging
    console.warn(`Failed to list git notes: ${error.message || error}`);
    return [];
  }
}

/**
 * Get commits with traces and their metadata
 */
export function getCommitsWithTracesMetadata(cwd?: string): Array<{
  commit: string;
  traceCount: number;
  timestamp?: string;
}> {
  const commits = getCommitsWithTraces(cwd);
  const result: Array<{
    commit: string;
    traceCount: number;
    timestamp?: string;
  }> = [];
  
  for (const commit of commits) {
    try {
      const traces = readTracesFromNotes(commit, cwd);
      if (traces.length > 0) {
        result.push({
          commit,
          traceCount: traces.length,
          timestamp: traces[0]?.timestamp,
        });
      }
    } catch (error) {
      // Skip commits with invalid notes
      console.warn(`Failed to read traces for commit ${commit}: ${error}`);
    }
  }
  
  return result;
}

/**
 * Ensure notes ref exists and is configured
 */
export function ensureNotesRef(cwd?: string): void {
  try {
    // Check if ref exists and is valid
    execFileSync("git", ["show-ref", "--verify", "--quiet", NOTES_REF], {
      stdio: "ignore",
      cwd,
    });
    
    // Try to read from it to verify it's valid
    try {
      execFileSync("git", ["notes", "--ref", NOTES_REF, "list"], {
        stdio: "ignore",
        cwd,
      });
    } catch {
      // Ref exists but is broken, delete and recreate
      try {
        execFileSync("git", ["update-ref", "-d", NOTES_REF], {
          stdio: "ignore",
          cwd,
        });
      } catch {
        // Ignore if deletion fails
      }
      // Will fall through to creation below
    }
  } catch {
    // Ref doesn't exist, create it
  }
  
  // Create ref if it doesn't exist (or was broken)
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", NOTES_REF], {
      stdio: "ignore",
      cwd,
    });
    // Ref exists and is valid
    return;
  } catch {
    // Ref doesn't exist, create it properly
    try {
      execFileSync("git", ["rev-parse", "HEAD"], { stdio: "ignore", cwd });
      // HEAD exists, create ref by adding a dummy note then removing it
      execFileSync(
        "git",
        ["notes", "--ref", NOTES_REF, "add", "-m", "init", "HEAD"],
        { stdio: "ignore", cwd }
      );
      execFileSync(
        "git",
        ["notes", "--ref", NOTES_REF, "remove", "HEAD"],
        { stdio: "ignore", cwd }
      );
    } catch {
      // HEAD doesn't exist yet, create empty tree ref
      const emptyTree = execFileSync(
        "git",
        ["mktree"],
        { input: "", encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"], cwd }
      ).trim();
      if (emptyTree) {
        execFileSync("git", ["update-ref", NOTES_REF, emptyTree], {
          stdio: "ignore",
          cwd,
        });
      }
    }
  }
}
