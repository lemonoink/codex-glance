import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_MESSAGE_BYTES,
  createDashboardSnapshot,
  createHeartbeat,
  encodeDashboardSnapshot,
  encodeHeartbeat,
} from "../src/protocol.js";

test("encodes a dashboard as bounded NDJSON", () => {
  const snapshot = createDashboardSnapshot(
    "a13f",
    42,
    { run: 2, wait: 1, err: 0 },
    [
      {
        id: "7c21",
        project: "codex-glance",
        slot: 2,
        status: "WAITING",
        phase: "APPROVAL",
        elapsed: 84,
        agents: 1,
      },
    ],
  );
  const line = encodeDashboardSnapshot(snapshot);

  assert.equal(line.endsWith("\n"), true);
  assert.ok(Buffer.byteLength(line, "utf8") < MAX_MESSAGE_BYTES);
  assert.deepEqual(JSON.parse(line), snapshot);
});

test("maximum dashboard remains under the device limit", () => {
  const tasks = Array.from({ length: 3 }, (_, index) => ({
    id: "abcd000" + index,
    project: "project-name14",
    slot: 99,
    status: "WORKING" as const,
    phase: "SEARCHING" as const,
    elapsed: 0xffff_ffff,
    agents: 99,
  }));
  const line = encodeDashboardSnapshot(
    createDashboardSnapshot(
      "abcdef12",
      0xffff_ffff,
      { run: 99, wait: 99, err: 99 },
      tasks,
    ),
  );

  assert.ok(Buffer.byteLength(line, "utf8") < MAX_MESSAGE_BYTES);
});

test("encodes a bounded heartbeat without dashboard content", () => {
  const line = encodeHeartbeat(createHeartbeat("a13f", 43));

  assert.ok(Buffer.byteLength(line, "utf8") < MAX_MESSAGE_BYTES);
  assert.deepEqual(JSON.parse(line), {
    v: 2,
    type: "heartbeat",
    session: "a13f",
    seq: 43,
  });
});

test("rejects unsafe labels, unknown states, and excess rows", () => {
  const baseTask = {
    id: "7c21",
    project: "safe-project",
    slot: 1,
    status: "WORKING" as const,
    phase: "TESTING" as const,
    elapsed: 1,
    agents: 1,
  };

  assert.throws(
    () =>
      createDashboardSnapshot("a13f", 1, { run: 1, wait: 0, err: 0 }, [
        { ...baseTask, project: "prompt text!" },
      ]),
    /Invalid project/,
  );
  assert.throws(
    () =>
      createDashboardSnapshot("a13f", 1, { run: 1, wait: 0, err: 0 }, [
        { ...baseTask, status: "THINKING" as never },
      ]),
    /Unsupported task status/,
  );
  assert.throws(
    () =>
      createDashboardSnapshot("a13f", 1, { run: 4, wait: 0, err: 0 }, [
        baseTask,
        baseTask,
        baseTask,
        baseTask,
      ]),
    /at most 3/,
  );
});

test("rejects invalid session and sequence values", () => {
  assert.throws(
    () => createDashboardSnapshot("xyz", 1, { run: 0, wait: 0, err: 0 }, []),
    /Invalid session/,
  );
  assert.throws(
    () => createDashboardSnapshot("a13f", -1, { run: 0, wait: 0, err: 0 }, []),
    /uint32/,
  );
});
