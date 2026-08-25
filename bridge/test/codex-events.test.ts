import assert from "node:assert/strict";
import test from "node:test";

import { CodexJsonlParser, safeThreadId } from "../src/codex-events.js";

const SESSION = {
  timestamp: "2026-08-25T10:00:00.000Z",
  type: "session_meta",
  payload: {
    id: "desktop-thread-1",
    cwd: "/Users/example/Private Project",
    originator: "Codex Desktop",
  },
};

function lines(...records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

test("normalizes lifecycle and phase records without retaining source content", () => {
  const parser = new CodexJsonlParser();
  const events = parser.push(
    lines(
      SESSION,
      {
        timestamp: "2026-08-25T10:00:01.000Z",
        type: "event_msg",
        payload: { type: "task_started" },
      },
      {
        type: "event_msg",
        payload: {
          type: "item_completed",
          item: { type: "FileChange", changes: "must-not-escape" },
        },
      },
      {
        type: "event_msg",
        payload: { type: "task_complete", last_agent_message: "secret" },
      },
    ),
    Date.parse("2026-08-25T10:00:02.000Z"),
  );

  assert.deepEqual(
    events.map((event) => event.type),
    ["thread_discovered", "turn_started", "phase_changed", "turn_completed"],
  );
  assert.equal(events[0]?.threadId, safeThreadId("desktop-thread-1"));
  assert.equal(
    events[0]?.type === "thread_discovered" ? events[0].project : undefined,
    "Private-Projec",
  );
  assert.equal(JSON.stringify(events).includes("must-not-escape"), false);
  assert.equal(JSON.stringify(events).includes("secret"), false);
});

test("tracks explicit user-input attention across partial records", () => {
  const parser = new CodexJsonlParser();
  parser.push(lines(SESSION), 1);
  const request = JSON.stringify({
    type: "response_item",
    payload: {
      type: "custom_tool_call",
      name: "request_user_input",
      call_id: "call-1",
      input: "private question",
    },
  });

  assert.deepEqual(parser.push(request.slice(0, 30), 2), []);
  const requested = parser.push(request.slice(30) + "\n", 3);
  assert.equal(requested[0]?.type, "attention_required");

  const resolved = parser.push(
    lines({
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "call-1",
        output: "private answer",
      },
    }),
    4,
  );
  assert.equal(resolved[0]?.type, "attention_resolved");
  assert.equal(JSON.stringify(resolved).includes("private answer"), false);
});

test("ignores sessions that were not created by Codex Desktop", () => {
  const parser = new CodexJsonlParser();
  const events = parser.push(
    lines(
      {
        ...SESSION,
        payload: { ...SESSION.payload, originator: "Codex CLI" },
      },
      { type: "event_msg", payload: { type: "task_started" } },
    ),
    1,
  );
  assert.deepEqual(events, []);
});
