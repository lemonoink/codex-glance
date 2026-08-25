import { DONE_RETENTION_MS, type ConversationState } from "./dashboard.js";
import type { NormalizedCodexEvent } from "./codex-events.js";
import type { TaskPhase, TaskStatus } from "./protocol.js";

interface ThreadState {
  threadId: string;
  project: string;
  parentThreadId?: string;
  status: TaskStatus | "IDLE";
  phase: TaskPhase;
  previousPhase: TaskPhase;
  startedAtMs: number;
  changedAtMs: number;
}

const AGGREGATE_PRIORITY: Readonly<Record<TaskStatus | "IDLE", number>> = {
  ERROR: 0,
  WAITING: 1,
  WORKING: 2,
  DONE: 3,
  IDLE: 4,
};

export class ConversationReducer {
  readonly #projectSlots = new Map<string, number>();
  readonly #rootSlots = new Map<string, number>();
  readonly #threads = new Map<string, ThreadState>();

  apply(event: NormalizedCodexEvent): boolean {
    if (event.type === "thread_discovered") {
      const current = this.#threads.get(event.threadId);
      const next: ThreadState = current
        ? {
            ...current,
            project: event.project,
            ...(event.parentThreadId
              ? { parentThreadId: event.parentThreadId }
              : {}),
          }
        : {
            threadId: event.threadId,
            project: event.project,
            ...(event.parentThreadId
              ? { parentThreadId: event.parentThreadId }
              : {}),
            status: "IDLE",
            phase: "THINKING",
            previousPhase: "THINKING",
            startedAtMs: event.atMs,
            changedAtMs: event.atMs,
          };
      const changed =
        !current ||
        current.project !== next.project ||
        current.parentThreadId !== next.parentThreadId;
      this.#threads.set(event.threadId, next);
      return changed;
    }

    const current = this.#threads.get(event.threadId);
    if (!current) {
      return false;
    }

    let next = current;
    switch (event.type) {
      case "turn_started":
        if (!current.parentThreadId) {
          this.#resetDescendants(current.threadId, event.atMs);
        }
        next = {
          ...current,
          status: "WORKING",
          phase: "THINKING",
          previousPhase: "THINKING",
          startedAtMs: event.atMs,
          changedAtMs: event.atMs,
        };
        break;
      case "phase_changed":
        if (current.status === "IDLE" || current.status === "DONE") {
          return false;
        }
        next = {
          ...current,
          phase: current.status === "WAITING" ? current.phase : event.phase,
          previousPhase: event.phase,
          changedAtMs: event.atMs,
        };
        break;
      case "attention_required":
        next = {
          ...current,
          status: "WAITING",
          phase: "APPROVAL",
          startedAtMs:
            current.status === "IDLE" ? event.atMs : current.startedAtMs,
          changedAtMs: event.atMs,
        };
        break;
      case "attention_resolved":
        if (current.status !== "WAITING") {
          return false;
        }
        next = {
          ...current,
          status: "WORKING",
          phase: current.previousPhase,
          changedAtMs: event.atMs,
        };
        break;
      case "turn_completed":
      case "turn_interrupted":
        if (!current.parentThreadId) {
          this.#finishDescendants(current.threadId, event.atMs, false);
        }
        next = {
          ...current,
          status: "DONE",
          phase: "COMPLETE",
          changedAtMs: event.atMs,
        };
        break;
      case "turn_failed":
        if (!current.parentThreadId) {
          this.#finishDescendants(current.threadId, event.atMs, true);
        }
        next = {
          ...current,
          status: "ERROR",
          phase: "FAILED",
          changedAtMs: event.atMs,
        };
        break;
    }

    const changed =
      current.status !== next.status ||
      current.phase !== next.phase ||
      current.startedAtMs !== next.startedAtMs ||
      current.changedAtMs !== next.changedAtMs;
    this.#threads.set(event.threadId, next);
    return changed;
  }

  expireCompleted(nowMs: number): boolean {
    let changed = false;
    for (const [threadId, thread] of this.#threads) {
      if (
        thread.status === "DONE" &&
        nowMs - thread.changedAtMs > DONE_RETENTION_MS
      ) {
        this.#threads.set(threadId, { ...thread, status: "IDLE" });
        changed = true;
      }
    }
    return changed;
  }

  conversations(): ConversationState[] {
    const groups = new Map<string, ThreadState[]>();
    for (const thread of this.#threads.values()) {
      const rootId = this.#rootId(thread.threadId);
      const group = groups.get(rootId) ?? [];
      group.push(thread);
      groups.set(rootId, group);
    }

    const conversations: ConversationState[] = [];
    for (const [rootId, group] of groups) {
      const root = this.#threads.get(rootId) ?? group[0];
      if (!root) {
        continue;
      }

      const active = group.filter((thread) => thread.status !== "IDLE");
      const selected = [...group].sort((left, right) => {
        const priority =
          AGGREGATE_PRIORITY[left.status] - AGGREGATE_PRIORITY[right.status];
        return priority !== 0 ? priority : right.changedAtMs - left.changedAtMs;
      })[0];
      if (!selected) {
        continue;
      }

      conversations.push({
        conversationId: rootId,
        project: root.project,
        slot: this.#slot(rootId, root.project),
        status: selected.status,
        phase: selected.phase,
        startedAtMs:
          active.length > 0
            ? Math.min(...active.map((thread) => thread.startedAtMs))
            : selected.startedAtMs,
        changedAtMs: selected.changedAtMs,
        agents: Math.max(1, active.length),
      });
    }
    return conversations;
  }

  #rootId(threadId: string): string {
    let currentId = threadId;
    const visited = new Set<string>();
    while (!visited.has(currentId)) {
      visited.add(currentId);
      const parentId = this.#threads.get(currentId)?.parentThreadId;
      if (!parentId) {
        return currentId;
      }
      currentId = parentId;
    }
    return threadId;
  }

  #resetDescendants(rootId: string, atMs: number): void {
    for (const [threadId, thread] of this.#threads) {
      if (threadId !== rootId && this.#rootId(threadId) === rootId) {
        this.#threads.set(threadId, {
          ...thread,
          status: "IDLE",
          phase: "THINKING",
          previousPhase: "THINKING",
          changedAtMs: atMs,
        });
      }
    }
  }

  #finishDescendants(rootId: string, atMs: number, failed: boolean): void {
    for (const [threadId, thread] of this.#threads) {
      if (threadId !== rootId && this.#rootId(threadId) === rootId) {
        this.#threads.set(threadId, {
          ...thread,
          status: failed ? "ERROR" : "DONE",
          phase: failed ? "FAILED" : "COMPLETE",
          changedAtMs: atMs,
        });
      }
    }
  }

  #slot(rootId: string, project: string): number {
    const existing = this.#rootSlots.get(rootId);
    if (existing) {
      return existing;
    }

    const next = Math.min((this.#projectSlots.get(project) ?? 0) + 1, 99);
    this.#projectSlots.set(project, next);
    this.#rootSlots.set(rootId, next);
    return next;
  }
}
