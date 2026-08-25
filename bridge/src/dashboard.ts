import { createHash } from "node:crypto";

import {
  MAX_PAGE_COUNT,
  MAX_PROJECT_BYTES,
  MAX_TITLE_BYTES,
  type DashboardSnapshot,
  type DashboardTask,
  type TaskPhase,
  type TaskStatus,
  createDashboardSnapshot,
} from "./protocol.js";

export const DONE_RETENTION_MS = 20_000;

export interface ConversationState {
  conversationId: string;
  title?: string;
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

const FORBIDDEN_DISPLAY_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/gu;

export function hashConversationId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

export function truncateUtf8(value: string, maximumBytes: number): string {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const nextBytes = Buffer.byteLength(character, "utf8");
    if (bytes + nextBytes > maximumBytes) {
      break;
    }
    result += character;
    bytes += nextBytes;
  }
  return result;
}

export function sanitizeDisplayLabel(
  value: string,
  fallback: string,
  maximumBytes: number,
): string {
  const sanitized = value
    .normalize("NFC")
    .replace(FORBIDDEN_DISPLAY_CHARACTERS, "")
    .replace(/\s+/gu, " ")
    .trim();
  return truncateUtf8(sanitized || fallback, maximumBytes);
}

export function sanitizeProjectLabel(value: string): string {
  const basename = value.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  return sanitizeDisplayLabel(basename, "项目", MAX_PROJECT_BYTES);
}

export function sanitizeTaskTitle(
  value: string | undefined,
  slot: number,
): string {
  return sanitizeDisplayLabel(
    value ?? "",
    `Codex 任务 #${slot}`,
    MAX_TITLE_BYTES,
  );
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
    title: sanitizeTaskTitle(conversation.title, conversation.slot),
    project: sanitizeProjectLabel(conversation.project),
    slot: conversation.slot,
    status: conversation.status as TaskStatus,
    phase: conversation.phase,
    elapsed: Math.min(Math.floor(elapsedMs / 1_000), 0xffff_ffff),
    agents: conversation.agents,
  };
}

export function visibleConversations(
  conversations: readonly ConversationState[],
  nowMs: number,
): ConversationState[] {
  return conversations
    .filter((item) => {
      if (item.status === "IDLE") {
        return false;
      }
      return (
        item.status !== "DONE" || nowMs - item.changedAtMs <= DONE_RETENTION_MS
      );
    })
    .toSorted(compareConversations)
    .slice(0, MAX_PAGE_COUNT);
}

export function buildDashboardSnapshot(
  session: string,
  seq: number,
  conversations: readonly ConversationState[],
  nowMs: number,
  requestedPageIndex = 0,
): DashboardSnapshot {
  const counts = {
    run: Math.min(
      99,
      conversations.filter((item) => item.status === "WORKING").length,
    ),
    wait: Math.min(
      99,
      conversations.filter((item) => item.status === "WAITING").length,
    ),
    err: Math.min(
      99,
      conversations.filter((item) => item.status === "ERROR").length,
    ),
  };
  const visible = visibleConversations(conversations, nowMs);
  if (visible.length === 0) {
    return createDashboardSnapshot(
      session,
      seq,
      counts,
      { index: 0, total: 0 },
      null,
    );
  }

  const pageIndex =
    ((requestedPageIndex % visible.length) + visible.length) % visible.length;
  const selected = visible[pageIndex];
  return createDashboardSnapshot(
    session,
    seq,
    counts,
    { index: pageIndex + 1, total: visible.length },
    selected ? toDashboardTask(selected, nowMs) : null,
  );
}
