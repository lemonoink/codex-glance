import assert from "node:assert/strict";
import {
  appendFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { DesktopEventSource } from "../src/desktop-event-source.js";

function jsonLine(value: unknown): string {
  return JSON.stringify(value) + "\n";
}

function session(id: string): unknown {
  return {
    timestamp: "2026-08-25T10:00:00.000Z",
    type: "session_meta",
    payload: {
      id,
      cwd: "/Users/example/codex-glance",
      originator: "Codex Desktop",
    },
  };
}

test("recovers JSONL state, handles partial appends, and detects rotation", async () => {
  const codexHome = await mkdtemp(join(tmpdir(), "codex-glance-source-"));
  const sessions = join(codexHome, "sessions", "2026", "08", "25");
  await mkdir(sessions, { recursive: true });
  const rollout = join(sessions, "rollout.jsonl");
  await writeFile(
    rollout,
    jsonLine(session("thread-one")) +
      jsonLine({ type: "event_msg", payload: { type: "task_started" } }),
  );
  const database = new DatabaseSync(join(codexHome, "logs_1.sqlite"));
  database.exec(
    "CREATE TABLE logs (id INTEGER PRIMARY KEY, ts INTEGER, ts_nanos INTEGER, target TEXT, feedback_log_body TEXT, thread_id TEXT)",
  );
  database.exec(
    "INSERT INTO logs VALUES (1, 1787640000, 0, 'codex_app_server::outgoing_message', 'initial record', 'thread-one')",
  );

  const source = new DesktopEventSource({ codexHome });
  try {
    const initial = await source.scan(Date.now());
    assert.deepEqual(
      initial.map((event) => event.type),
      ["thread_discovered", "turn_started"],
    );

    const completed = JSON.stringify({
      type: "event_msg",
      payload: { type: "task_complete", content: "discarded" },
    });
    await appendFile(rollout, completed.slice(0, 20));
    assert.deepEqual(await source.scan(Date.now()), []);
    await appendFile(rollout, completed.slice(20) + "\n");
    assert.equal((await source.scan(Date.now()))[0]?.type, "turn_completed");

    database.exec(
      "INSERT INTO logs VALUES (2, 1787640001, 0, 'codex_app_server::outgoing_message', 'event: item/tool/requestUserInput thread=x', 'thread-one')",
    );
    assert.equal(
      (await source.scan(Date.now()))[0]?.type,
      "attention_required",
    );
    database.exec(
      "INSERT INTO logs VALUES (3, 1787640002, 0, 'codex_app_server::outgoing_message', 'event: serverRequest/resolved thread=x', 'thread-one')",
    );
    assert.equal(
      (await source.scan(Date.now()))[0]?.type,
      "attention_resolved",
    );

    await rename(rollout, rollout + ".old");
    await writeFile(
      rollout,
      jsonLine(session("thread-two")) +
        jsonLine({ type: "event_msg", payload: { type: "task_started" } }),
    );
    const rotated = await source.scan(Date.now());
    assert.deepEqual(
      rotated.map((event) => event.type),
      ["thread_discovered", "turn_started"],
    );
  } finally {
    source.close();
    database.close();
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("reads only explicit user-facing task names from the state database", async () => {
  const codexHome = await mkdtemp(join(tmpdir(), "codex-glance-metadata-"));
  await mkdir(join(codexHome, "sessions"), { recursive: true });
  const database = new DatabaseSync(join(codexHome, "state_1.sqlite"));
  database.exec(
    "CREATE TABLE threads (id TEXT, name TEXT, cwd TEXT, archived INTEGER, title TEXT)",
  );
  database.exec(
    "INSERT INTO threads VALUES ('thread-named', '实现中文界面', '/Users/example/中文项目', 0, 'private prompt must not escape')",
  );

  const source = new DesktopEventSource({ codexHome });
  try {
    const events = await source.scan(100);
    assert.deepEqual(events, [
      {
        type: "thread_discovered",
        threadId: events[0]?.threadId,
        title: "实现中文界面",
        project: "中文项目",
        atMs: 100,
      },
    ]);
    assert.equal(JSON.stringify(events).includes("private prompt"), false);
    assert.deepEqual(await source.scan(200), []);
  } finally {
    source.close();
    database.close();
    await rm(codexHome, { recursive: true, force: true });
  }
});
