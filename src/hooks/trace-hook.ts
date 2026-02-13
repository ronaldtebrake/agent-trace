#!/usr/bin/env node

import {
  createTrace,
  appendTrace,
  computeRangePositions,
  tryReadFile,
} from "../lib/trace-store.js";
import type { FileEdit } from "../lib/types.js";

interface HookInput {
  hook_event_name?: string;
  model?: string;
  model_id?: string; // Alternative field name
  model_name?: string; // Alternative field name
  transcript_path?: string | null;
  conversation_id?: string;
  generation_id?: string;
  session_id?: string;
  file_path?: string;
  edits?: FileEdit[];
  command?: string;
  duration?: number;
  output?: string;
  is_background_agent?: boolean;
  composer_mode?: string;
  reason?: string;
  duration_ms?: number;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    new_string?: string;
    old_string?: string;
    command?: string;
  };
  tool_use_id?: string;
  source?: string;
  cwd?: string;
  metadata?: Record<string, unknown>; // May contain model info
}

// Extract model name from hook input, checking multiple possible fields
function extractModel(input: HookInput): string | undefined {
  // Try multiple fields that might contain the model name
  const model = input.model || input.model_id || input.model_name;
  if (model && model.trim() !== "") {
    return model; // Return even if "default"
  }
  
  // Check metadata if available
  if (input.metadata && typeof input.metadata === 'object') {
    const metaModel = (input.metadata as any).model || (input.metadata as any).model_id;
    if (metaModel && metaModel.trim() !== "") {
      return metaModel;
    }
  }
  
  return undefined;
}

// Determine contributor type: if model is undefined/null, it's human; otherwise AI
// Note: "default" is still considered AI (just unknown which model)
function getContributorType(input: HookInput): "ai" | "human" {
  const model = extractModel(input);
  // If model is missing/undefined/null, assume human edit
  // "default" means AI but model not specified, so still AI
  if (!model || model.trim() === "") {
    return "human";
  }
  return "ai";
}

const handlers: Record<string, (input: HookInput) => void> = {
  afterFileEdit: (input) => {
    if (!input.file_path) return;
    const contributorType = getContributorType(input);
    const model = extractModel(input);
    const rangePositions = computeRangePositions(
      input.edits ?? [],
      tryReadFile(input.file_path)
    );
    appendTrace(
      createTrace(contributorType, input.file_path, {
        model: model,
        rangePositions,
        transcript: input.transcript_path,
        metadata: {
          conversation_id: input.conversation_id,
          generation_id: input.generation_id,
        },
      })
    );
  },

  afterTabFileEdit: (input) => {
    if (!input.file_path) return;
    const contributorType = getContributorType(input);
    const model = extractModel(input);
    const rangePositions = computeRangePositions(input.edits ?? []);
    appendTrace(
      createTrace(contributorType, input.file_path, {
        model: model,
        rangePositions,
        metadata: {
          conversation_id: input.conversation_id,
          generation_id: input.generation_id,
        },
      })
    );
  },

  afterShellExecution: (input) => {
    const contributorType = getContributorType(input);
    const model = extractModel(input);
    appendTrace(
      createTrace(contributorType, ".shell-history", {
        model: model,
        transcript: input.transcript_path,
        metadata: {
          conversation_id: input.conversation_id,
          generation_id: input.generation_id,
          command: input.command,
          duration_ms: input.duration,
        },
      })
    );
  },

  sessionStart: (input) => {
    const model = extractModel(input);
    const contributorType = model ? "ai" : "human";
    appendTrace(
      createTrace(contributorType, ".sessions", {
        model: model,
        metadata: {
          event: "session_start",
          session_id: input.session_id,
          conversation_id: input.conversation_id,
          is_background_agent: input.is_background_agent,
          composer_mode: input.composer_mode,
        },
      })
    );
  },

  sessionEnd: (input) => {
    const model = extractModel(input);
    const contributorType = model ? "ai" : "human";
    appendTrace(
      createTrace(contributorType, ".sessions", {
        model: model,
        metadata: {
          event: "session_end",
          session_id: input.session_id,
          conversation_id: input.conversation_id,
          reason: input.reason,
          duration_ms: input.duration_ms,
        },
      })
    );
  },

  PostToolUse: (input) => {
    const toolName = input.tool_name ?? "";
    const isFileEdit = toolName === "Write" || toolName === "Edit";
    const isBash = toolName === "Shell" || toolName === "Bash";

    if (!isFileEdit && !isBash) return;

    const contributorType = getContributorType(input);
    const model = extractModel(input);
    const file = isBash
      ? ".shell-history"
      : input.tool_input?.file_path ?? ".unknown";

    const rangePositions =
      isFileEdit && input.tool_input?.new_string
        ? computeRangePositions(
            [
              {
                old_string: input.tool_input.old_string ?? "",
                new_string: input.tool_input.new_string,
              },
            ],
            tryReadFile(input.tool_input.file_path!)
          )
        : undefined;

    appendTrace(
      createTrace(contributorType, file, {
        model: model,
        rangePositions,
        transcript: input.transcript_path,
        metadata: {
          session_id: input.session_id,
          tool_name: toolName,
          tool_use_id: input.tool_use_id,
          command: isBash ? input.tool_input?.command : undefined,
        },
      })
    );
  },

  SessionStart: (input) => {
    const model = extractModel(input);
    const contributorType = model ? "ai" : "human";
    appendTrace(
      createTrace(contributorType, ".sessions", {
        model: model,
        metadata: {
          event: "session_start",
          session_id: input.session_id,
          source: input.source,
        },
      })
    );
  },

  SessionEnd: (input) => {
    const model = extractModel(input);
    const contributorType = model ? "ai" : "human";
    appendTrace(
      createTrace(contributorType, ".sessions", {
        model: model,
        metadata: {
          event: "session_end",
          session_id: input.session_id,
          reason: input.reason,
        },
      })
    );
  },
};

async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  const json = Buffer.concat(chunks).toString("utf-8").trim();
  if (!json) process.exit(0);

  try {
    const input = JSON.parse(json) as HookInput;
    const eventName =
      input.hook_event_name ||
      (input.tool_name ? "PostToolUse" : undefined);
    
    if (eventName && handlers[eventName]) {
      handlers[eventName](input);
    }
  } catch (e) {
    console.error("Hook error:", e);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Hook error:", error);
  process.exit(1);
});
