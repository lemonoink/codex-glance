import { createHash } from "node:crypto";

import {
  MAX_PROJECT_LENGTH,
  MAX_VISIBLE_TASKS,
  type DashboardSnapshot,
  type DashboardTask,
  type TaskPhase,
  type TaskStatus,
  createDashboardSnapshot,
} from "./protocol.js";

export const DONE_RETENTION_MS = 20_000;

export interface ConversationState {
  conversationId: string;
  project: string;
  slot: number;
  status: TaskStatus | "IDLE";
  phase: TaskPhase;
  startedAtMs: number;
  changedAtMs: number;
  agents: number;
}

const STATUS_PRIORITY: Readonly<Record<TaskStatus, number>> = {
  ERROR: 0,
  WAITING: 1,
  WORKING: 2,
  DONE: 3,
};

export function hashConversationId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

export function sanitizeProjectLabel(value: string): string {
  const basename = value.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  const sanitized = basename
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, MAX_PROJECT_LENGTH);
  return sanitized || "project";
}

function compareConversations(
  left: ConversationState,
  right: ConversationState,
): number {
  const priority =
    STATUS_PRIORITY[left.status as TaskStatus] -
    STATUS_PRIORITY[right.status as TaskStatus];
  if (priority !== 0) {
    return priority;
  }

  if (left.status === "ERROR" || left.status === "WAITING") {
    return left.changedAtMs - right.changedAtMs;
  }
  return right.changedAtMs - left.changedAtMs;
}

function toDashboardTask(
  conversation: ConversationState,
  nowMs: number,
): DashboardTask {
  const elapsedMs = Math.max(0, nowMs - conversation.startedAtMs);
  return {
    id: hashConversationId(conversation.conversationId),
    project: sanitizeProjectLabel(conversation.project),
    slot: conversation.slot,
    status: conversation.status as TaskStatus,
    phase: conversation.phase,
    elapsed: Math.min(Math.floor(elapsedMs / 1_000), 0xffff_ffff),
    agents: conversation.agents,
  };
}

export function buildDashboardSnapshot(
  session: string,
  seq: number,
  conversations: readonly ConversationState[],
  nowMs: number,
): DashboardSnapshot {
  const counts = {
    run: conversations.filter((item) => item.status === "WORKING").length,
    wait: conversations.filter((item) => item.status === "WAITING").length,
    err: conversations.filter((item) => item.status === "ERROR").length,
  };

  const visible = conversations
    .filter((item) => {
      if (item.status === "IDLE") {
        return false;
      }
      return (
        item.status !== "DONE" || nowMs - item.changedAtMs <= DONE_RETENTION_MS
      );
    })
    .toSorted(compareConversations)
    .slice(0, MAX_VISIBLE_TASKS)
    .map((item) => toDashboardTask(item, nowMs));

  return createDashboardSnapshot(session, seq, counts, visible);
}
