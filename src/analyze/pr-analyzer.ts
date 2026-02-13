import { readTraces } from "../lib/trace-store.js";
import { getWorkspaceRoot } from "../lib/trace-store.js";
import { getCommitInfo, resolveCommit } from "./git-utils.js";
import { readTracesFromNotes } from "../lib/git-notes.js";

export interface FileAnalysis {
  path: string;
  ranges: Array<{
    start_line: number;
    end_line: number;
    contributor?: { type: string; model_id?: string };
  }>;
  models: string[];
}

export interface AnalysisResult {
  commit?: string;
  files: FileAnalysis[];
}

export async function analyzeCommit(
  target: string
): Promise<AnalysisResult> {
  const root = getWorkspaceRoot();
  
  // Resolve commit SHA (supports HEAD, branch names, or commit SHAs)
  const commitSha = await resolveCommit(target);
  
  // Read traces from git notes for this specific commit
  const traces = readTracesFromNotes(commitSha, root);
  
  // Get commit info
  const commitInfo = await getCommitInfo(commitSha, root);

  // Match traces to changed files
  const fileAnalyses = new Map<string, FileAnalysis>();

  // Traces are already filtered to this commit from git notes
  const relevantTraces = traces;

  // Process each changed file
  for (const fileChange of commitInfo.files) {
    const fileTraces = relevantTraces.filter((trace) =>
      trace.files.some((f) => f.path === fileChange.path)
    );

    if (fileTraces.length === 0) {
      continue; // Skip files without traces
    }

    const ranges: Array<{
      start_line: number;
      end_line: number;
      contributor?: { type: string; model_id?: string };
    }> = [];

    const models = new Set<string>();

    for (const trace of fileTraces) {
      for (const file of trace.files) {
        if (file.path === fileChange.path) {
          for (const conversation of file.conversations) {
            const contributorType =
              conversation.contributor?.type || "unknown";
            const modelId = conversation.contributor?.model_id;

            if (modelId) {
              models.add(modelId);
            }

            for (const range of conversation.ranges) {
              // Check if this range overlaps with changed lines
              const overlaps = fileChange.changes.some(
                (change: { line: number; type: string }) =>
                  change.line >= range.start_line &&
                  change.line <= range.end_line
              );

              if (overlaps || fileChange.changes.length === 0) {
                ranges.push({
                  start_line: range.start_line,
                  end_line: range.end_line,
                  contributor: {
                    type: contributorType,
                    model_id: modelId,
                  },
                });
              }
            }
          }
        }
      }
    }

    if (ranges.length > 0) {
      fileAnalyses.set(fileChange.path, {
        path: fileChange.path,
        ranges,
        models: Array.from(models),
      });
    }
  }

  return {
    commit: commitSha,
    files: Array.from(fileAnalyses.values()),
  };
}

// Alias for backward compatibility
export const analyzePR = analyzeCommit;
