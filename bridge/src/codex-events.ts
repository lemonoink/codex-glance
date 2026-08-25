import { createHash } from "node:crypto";

import { sanitizeProjectLabel } from "./dashboard.js";
import type { TaskPhase } from "./protocol.js";

export const CODEX_COMPATIBILITY_VERSION = "0.149.0-alpha.4.3";

interface EventBase {
  threadId: string;
  atMs: number;
}

export type NormalizedCodexEvent =
  | (EventBase & {
      type: "thread_discovered";
      project: string;
      parentThreadId?: string;
    })
  | (EventBase & { type: "turn_started" })
  | (EventBase & { type: "phase_changed"; phase: TaskPhase })
  | (EventBase & { type: "attention_required" })
  | (EventBase & { type: "attention_resolved" })
  | (EventBase & { type: "turn_completed" })
  | (EventBase & { type: "turn_failed" })
  | (EventBase & { type: "turn_interrupted" });

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function eventTime(record: UnknownRecord, fallbackMs: number): number {
  const timestamp = asString(record.timestamp);
  if (!timestamp) {
    return fallbackMs;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}

export function safeThreadId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function itemPhase(itemType: string | undefined): TaskPhase | undefined {
  switch (itemType?.toLowerCase()) {
    case "reasoning":
    case "contextcompaction":
      return "THINKING";
    case "commandexecution":
      return "COMMAND";
    case "filechange":
      return "EDITING";
    case "mcp_tool_call":
    case "mcptoolcall":
    case "dynamictoolcall":
    case "extension":
      return "TOOL";
    case "websearch":
      return "SEARCHING";
    case "imageview":
      return "READING";
    default:
      return undefined;
  }
}

export class CodexJsonlParser {
  #accepted = false;
  #buffer = "";
  #lastAtMs = 0;
  #pendingAttentionCalls = new Set<string>();
  #threadId: string | undefined;

  reset(): void {
    this.#accepted = false;
    this.#buffer = "";
    this.#lastAtMs = 0;
    this.#pendingAttentionCalls.clear();
    this.#threadId = undefined;
  }

  push(chunk: string, observedAtMs: number): NormalizedCodexEvent[] {
    this.#buffer += chunk;
    const events: NormalizedCodexEvent[] = [];

    let newlineIndex = this.#buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.#buffer.slice(0, newlineIndex);
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      events.push(...this.#parseLine(line, observedAtMs));
      newlineIndex = this.#buffer.indexOf("\n");
    }

    // A malformed source must not retain unbounded prompt or output data.
    if (this.#buffer.length > 4 * 1024 * 1024) {
      this.#buffer = "";
    }

    return events;
  }

  #parseLine(line: string, observedAtMs: number): NormalizedCodexEvent[] {
    if (line.trim().length === 0) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return [];
    }

    const record = asRecord(parsed);
    const recordType = asString(record?.type);
    const payload = asRecord(record?.payload);
    if (!record || !payload || !recordType) {
      return [];
    }

    const atMs = Math.max(eventTime(record, observedAtMs), this.#lastAtMs);
    this.#lastAtMs = atMs;
    if (recordType === "session_meta") {
      return this.#parseSessionMeta(payload, atMs);
    }
    if (!this.#accepted || !this.#threadId) {
      return [];
    }

    if (recordType === "event_msg") {
      return this.#parseEventMessage(payload, atMs);
    }
    if (recordType === "response_item") {
      return this.#parseResponseItem(payload, atMs);
    }
    return [];
  }

  #parseSessionMeta(
    payload: UnknownRecord,
    atMs: number,
  ): NormalizedCodexEvent[] {
    const rawId = asString(payload.id) ?? asString(payload.session_id);
    const cwd = asString(payload.cwd);
    const originator = asString(payload.originator);
    if (!rawId || !cwd || originator !== "Codex Desktop") {
      this.#accepted = false;
      return [];
    }

    this.#accepted = true;
    this.#threadId = safeThreadId(rawId);
    const rawParentId = asString(payload.parent_thread_id);
    return [
      {
        type: "thread_discovered",
        threadId: this.#threadId,
        project: sanitizeProjectLabel(cwd),
        ...(rawParentId ? { parentThreadId: safeThreadId(rawParentId) } : {}),
        atMs,
      },
    ];
  }

  #parseEventMessage(
    payload: UnknownRecord,
    atMs: number,
  ): NormalizedCodexEvent[] {
    const threadId = this.#threadId;
    if (!threadId) {
      return [];
    }

    const payloadType = asString(payload.type);
    switch (payloadType) {
      case "task_started":
        return [{ type: "turn_started", threadId, atMs }];
      case "task_complete":
        return [{ type: "turn_completed", threadId, atMs }];
      case "task_failed":
      case "turn_failed":
        return [{ type: "turn_failed", threadId, atMs }];
      case "turn_aborted":
        return [{ type: "turn_interrupted", threadId, atMs }];
      case "agent_reasoning":
      case "context_compacted":
        return [{ type: "phase_changed", threadId, phase: "THINKING", atMs }];
      case "patch_apply_end":
        return [{ type: "phase_changed", threadId, phase: "EDITING", atMs }];
      case "mcp_tool_call_end":
        return [{ type: "phase_changed", threadId, phase: "TOOL", atMs }];
      case "web_search_end":
        return [{ type: "phase_changed", threadId, phase: "SEARCHING", atMs }];
      case "item_started":
      case "item_completed": {
        const item = asRecord(payload.item);
        const phase = itemPhase(asString(item?.type));
        return phase ? [{ type: "phase_changed", threadId, phase, atMs }] : [];
      }
      default:
        return [];
    }
  }

  #parseResponseItem(
    payload: UnknownRecord,
    atMs: number,
  ): NormalizedCodexEvent[] {
    const threadId = this.#threadId;
    if (!threadId) {
      return [];
    }

    const payloadType = asString(payload.type);
    if (payloadType === "reasoning") {
      return [{ type: "phase_changed", threadId, phase: "THINKING", atMs }];
    }

    if (payloadType === "custom_tool_call" || payloadType === "function_call") {
      const name = asString(payload.name)?.toLowerCase();
      const callId = asString(payload.call_id);
      if (name === "request_user_input") {
        if (callId) {
          this.#pendingAttentionCalls.add(callId);
        }
        return [{ type: "attention_required", threadId, atMs }];
      }
      if (name === "exec") {
        return [{ type: "phase_changed", threadId, phase: "COMMAND", atMs }];
      }
      return name
        ? [{ type: "phase_changed", threadId, phase: "TOOL", atMs }]
        : [];
    }

    if (
      payloadType === "custom_tool_call_output" ||
      payloadType === "function_call_output"
    ) {
      const callId = asString(payload.call_id);
      if (callId && this.#pendingAttentionCalls.delete(callId)) {
        return [{ type: "attention_resolved", threadId, atMs }];
      }
    }
    return [];
  }
}
