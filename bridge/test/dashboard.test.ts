import assert from "node:assert/strict";
import test from "node:test";

import {
  DONE_RETENTION_MS,
  type ConversationState,
  buildDashboardSnapshot,
  hashConversationId,
  sanitizeProjectLabel,
  sanitizeTaskTitle,
} from "../src/dashboard.js";

const NOW = 1_000_000;

function conversation(
  id: string,
  status: ConversationState["status"],
  changedAtMs: number,
): ConversationState {
  return {
    conversationId: id,
    title: `任务 ${id}`,
    project: "/Users/test/中文项目",
    slot: 1,
    status,
    phase: status === "ERROR" ? "FAILED" : "TESTING",
    startedAtMs: NOW - 60_000,
    changedAtMs,
    agents: 1,
  };
}

test("prioritizes tasks and selects exactly one requested page", () => {
  const conversations = [
    conversation("work-old", "WORKING", NOW - 2_000),
    conversation("wait-new", "WAITING", NOW - 1_000),
    conversation("error", "ERROR", NOW - 500),
    conversation("work-new", "WORKING", NOW - 100),
  ];
  const pages = [0, 1, 2, 3].map((page) =>
    buildDashboardSnapshot("a13f", page + 1, conversations, NOW, page),
  );

  assert.deepEqual(
    pages.map((snapshot) => snapshot.task?.id),
    [
      hashConversationId("error"),
      hashConversationId("wait-new"),
      hashConversationId("work-new"),
      hashConversationId("work-old"),
    ],
  );
  assert.deepEqual(pages[0]?.page, { index: 1, total: 4 });
  assert.deepEqual(pages[0]?.counts, { run: 2, wait: 1, err: 1 });
});

test("keeps recent completions and expires old ones", () => {
  const snapshot = buildDashboardSnapshot(
    "a13f",
    2,
    [
      conversation("recent", "DONE", NOW - DONE_RETENTION_MS),
      conversation("expired", "DONE", NOW - DONE_RETENTION_MS - 1),
      conversation("idle", "IDLE", NOW),
    ],
    NOW,
  );

  assert.deepEqual(snapshot.page, { index: 1, total: 1 });
  assert.equal(snapshot.task?.id, hashConversationId("recent"));
});

test("preserves safe Unicode labels and uses a private fallback title", () => {
  assert.equal(sanitizeProjectLabel("/tmp/中文 项目"), "中文 项目");
  assert.equal(sanitizeProjectLabel("///"), "项目");
  assert.equal(sanitizeTaskTitle(undefined, 3), "Codex 任务 #3");
  assert.equal(sanitizeTaskTitle("名称\n注入", 1), "名称注入");
});
