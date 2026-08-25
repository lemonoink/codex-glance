import assert from "node:assert/strict";
import test from "node:test";

import { ConversationReducer } from "../src/conversation-reducer.js";
import type { NormalizedCodexEvent } from "../src/codex-events.js";
import { DONE_RETENTION_MS } from "../src/dashboard.js";

function apply(
  reducer: ConversationReducer,
  ...events: NormalizedCodexEvent[]
): void {
  for (const event of events) {
    reducer.apply(event);
  }
}

test("aggregates subagents into a stable root conversation", () => {
  const reducer = new ConversationReducer();
  apply(
    reducer,
    { type: "thread_discovered", threadId: "root", project: "glance", atMs: 1 },
    {
      type: "thread_discovered",
      threadId: "child",
      parentThreadId: "root",
      project: "glance",
      atMs: 2,
    },
    { type: "turn_started", threadId: "root", atMs: 10 },
    { type: "turn_started", threadId: "child", atMs: 11 },
    {
      type: "phase_changed",
      threadId: "child",
      phase: "EDITING",
      atMs: 12,
    },
  );

  const [conversation] = reducer.conversations();
  assert.equal(reducer.conversations().length, 1);
  assert.equal(conversation?.conversationId, "root");
  assert.equal(conversation?.status, "WORKING");
  assert.equal(conversation?.phase, "EDITING");
  assert.equal(conversation?.agents, 2);
  assert.equal(conversation?.slot, 1);
  assert.equal(reducer.conversations()[0]?.slot, 1);
});

test("prioritizes waiting and error states and restores the prior phase", () => {
  const reducer = new ConversationReducer();
  apply(
    reducer,
    { type: "thread_discovered", threadId: "root", project: "glance", atMs: 1 },
    { type: "turn_started", threadId: "root", atMs: 10 },
    {
      type: "phase_changed",
      threadId: "root",
      phase: "COMMAND",
      atMs: 11,
    },
    { type: "attention_required", threadId: "root", atMs: 12 },
  );
  assert.equal(reducer.conversations()[0]?.status, "WAITING");
  assert.equal(reducer.conversations()[0]?.phase, "APPROVAL");

  reducer.apply({ type: "attention_resolved", threadId: "root", atMs: 13 });
  assert.equal(reducer.conversations()[0]?.status, "WORKING");
  assert.equal(reducer.conversations()[0]?.phase, "COMMAND");

  reducer.apply({ type: "turn_failed", threadId: "root", atMs: 14 });
  assert.equal(reducer.conversations()[0]?.status, "ERROR");
  assert.equal(reducer.conversations()[0]?.phase, "FAILED");
});

test("expires completed tasks to idle after the display retention window", () => {
  const reducer = new ConversationReducer();
  apply(
    reducer,
    { type: "thread_discovered", threadId: "root", project: "glance", atMs: 1 },
    { type: "turn_started", threadId: "root", atMs: 10 },
    { type: "turn_completed", threadId: "root", atMs: 20 },
  );

  assert.equal(reducer.expireCompleted(20 + DONE_RETENTION_MS), false);
  assert.equal(reducer.expireCompleted(21 + DONE_RETENTION_MS), true);
  assert.equal(reducer.conversations()[0]?.status, "IDLE");
});
