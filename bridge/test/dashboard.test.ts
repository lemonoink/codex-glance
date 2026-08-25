import assert from "node:assert/strict";
import test from "node:test";

import {
  DONE_RETENTION_MS,
  type ConversationState,
  buildDashboardSnapshot,
  hashConversationId,
  sanitizeProjectLabel,
} from "../src/dashboard.js";

const NOW = 1_000_000;

function conversation(
  id: string,
  status: ConversationState["status"],
  changedAtMs: number,
): ConversationState {
  return {
    conversationId: id,
    project: "/Users/test/Codex Glance",
    slot: 1,
    status,
    phase: status === "ERROR" ? "FAILED" : "TESTING",
    startedAtMs: NOW - 60_000,
    changedAtMs,
    agents: 1,
  };
}

test("prioritizes errors, waiting tasks, then recent work", () => {
  const snapshot = buildDashboardSnapshot(
    "a13f",
    1,
    [
      conversation("work-old", "WORKING", NOW - 2_000),
      conversation("wait-new", "WAITING", NOW - 1_000),
      conversation("error", "ERROR", NOW - 500),
      conversation("work-new", "WORKING", NOW - 100),
    ],
    NOW,
  );

  assert.deepEqual(
    snapshot.tasks.map((task) => task.id),
    [
      hashConversationId("error"),
      hashConversationId("wait-new"),
      hashConversationId("work-new"),
    ],
  );
  assert.deepEqual(snapshot.counts, { run: 2, wait: 1, err: 1 });
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

  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.tasks[0]?.id, hashConversationId("recent"));
});

test("sanitizes project paths without exposing arbitrary content", () => {
  assert.equal(sanitizeProjectLabel("/tmp/Codex Glance"), "Codex-Glance");
  assert.equal(sanitizeProjectLabel("///"), "project");
  assert.equal(
    sanitizeProjectLabel("long-project-name-here"),
    "long-project-n",
  );
});
