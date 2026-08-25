import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_MESSAGE_BYTES,
  createDashboardSnapshot,
  createHeartbeat,
  encodeDashboardSnapshot,
  encodeHeartbeat,
} from "../src/protocol.js";

const BASE_TASK = {
  id: "7c21",
  title: "实现中文任务卡片",
  project: "Codex Glance",
  slot: 2,
  status: "WAITING" as const,
  phase: "APPROVAL" as const,
  elapsed: 84,
  agents: 1,
};

test("encodes one UTF-8 task page as bounded NDJSON", () => {
  const snapshot = createDashboardSnapshot(
    "a13f",
    42,
    { run: 2, wait: 1, err: 0 },
    { index: 2, total: 3 },
    BASE_TASK,
  );
  const line = encodeDashboardSnapshot(snapshot);

  assert.equal(line.endsWith("\n"), true);
  assert.ok(Buffer.byteLength(line, "utf8") < MAX_MESSAGE_BYTES);
  assert.deepEqual(JSON.parse(line), snapshot);
});

test("maximum UTF-8 page remains under the device limit", () => {
  const line = encodeDashboardSnapshot(
    createDashboardSnapshot(
      "abcdef12",
      0xffff_ffff,
      { run: 99, wait: 99, err: 99 },
      { index: 99, total: 99 },
      {
        ...BASE_TASK,
        id: "abcd0000",
        title: "界".repeat(32),
        project: "项".repeat(16),
        slot: 99,
        status: "WORKING",
        phase: "SEARCHING",
        elapsed: 0xffff_ffff,
        agents: 99,
      },
    ),
  );

  assert.ok(Buffer.byteLength(line, "utf8") < MAX_MESSAGE_BYTES);
});

test("encodes a bounded v3 heartbeat without dashboard content", () => {
  const line = encodeHeartbeat(createHeartbeat("a13f", 43));

  assert.ok(Buffer.byteLength(line, "utf8") < MAX_MESSAGE_BYTES);
  assert.deepEqual(JSON.parse(line), {
    v: 3,
    type: "heartbeat",
    session: "a13f",
    seq: 43,
  });
});

test("rejects unsafe labels, unknown states, and inconsistent pages", () => {
  assert.throws(
    () =>
      createDashboardSnapshot(
        "a13f",
        1,
        { run: 1, wait: 0, err: 0 },
        { index: 1, total: 1 },
        { ...BASE_TASK, title: "unsafe\ntext" },
      ),
    /Invalid title/,
  );
  assert.throws(
    () =>
      createDashboardSnapshot(
        "a13f",
        1,
        { run: 1, wait: 0, err: 0 },
        { index: 1, total: 1 },
        { ...BASE_TASK, status: "THINKING" as never },
      ),
    /Unsupported task status/,
  );
  assert.throws(
    () =>
      createDashboardSnapshot(
        "a13f",
        1,
        { run: 0, wait: 0, err: 0 },
        { index: 0, total: 0 },
        BASE_TASK,
      ),
    /inconsistent/,
  );
});

test("rejects invalid session and sequence values", () => {
  assert.throws(
    () =>
      createDashboardSnapshot(
        "xyz",
        1,
        { run: 0, wait: 0, err: 0 },
        { index: 0, total: 0 },
        null,
      ),
    /Invalid session/,
  );
  assert.throws(
    () =>
      createDashboardSnapshot(
        "a13f",
        -1,
        { run: 0, wait: 0, err: 0 },
        { index: 0, total: 0 },
        null,
      ),
    /uint32/,
  );
});
