import type { TraceRecord } from "../lib/types.js";

export interface ReportStats {
  totalTraces: number;
  totalFiles: number;
  aiContributions: number;
  humanContributions: number;
  mixedContributions: number;
  models: Map<string, number>;
  tools: Map<string, number>;
}

export function generateReport(traces: TraceRecord[]): ReportStats {
  const stats: ReportStats = {
    totalTraces: traces.length,
    totalFiles: new Set<string>().size,
    aiContributions: 0,
    humanContributions: 0,
    mixedContributions: 0,
    models: new Map(),
    tools: new Map(),
  };

  const files = new Set<string>();

  for (const trace of traces) {
    for (const file of trace.files) {
      files.add(file.path);

      for (const conversation of file.conversations) {
        const contributorType = conversation.contributor?.type || "unknown";
        const rangeCount = conversation.ranges.length;

        if (contributorType === "ai") {
          stats.aiContributions += rangeCount;
        } else if (contributorType === "human") {
          stats.humanContributions += rangeCount;
        } else if (contributorType === "mixed") {
          stats.mixedContributions += rangeCount;
        }

        if (conversation.contributor?.model_id) {
          const current = stats.models.get(
            conversation.contributor.model_id
          ) || 0;
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

  stats.totalFiles = files.size;

  return stats;
}
