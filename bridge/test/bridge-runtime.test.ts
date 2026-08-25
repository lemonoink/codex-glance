import assert from "node:assert/strict";
import test from "node:test";

import { BridgeRuntime, type BridgeTransport } from "../src/bridge-runtime.js";
import type { NormalizedCodexEvent } from "../src/codex-events.js";
import type { CodexEventSource } from "../src/desktop-event-source.js";
import type { DashboardSnapshot } from "../src/protocol.js";

class FakeSource implements CodexEventSource {
  batches: NormalizedCodexEvent[][] = [];
  closed = false;

  async scan(): Promise<NormalizedCodexEvent[]> {
    return this.batches.shift() ?? [];
  }

  close(): void {
    this.closed = true;
  }
}

class FakeTransport implements BridgeTransport {
  dashboards: DashboardSnapshot[] = [];
  heartbeats: number[] = [];
  failDashboard = false;
  opened = false;

  async open(): Promise<void> {
    this.opened = true;
  }

  async close(): Promise<void> {
    this.opened = false;
  }

  async sendDashboard(snapshot: DashboardSnapshot): Promise<void> {
    if (this.failDashboard) {
      throw new Error("simulated link failure");
    }
    this.dashboards.push(snapshot);
  }

  async sendHeartbeat(_session: string, seq: number): Promise<void> {
    this.heartbeats.push(seq);
  }
}

test("sends a full snapshot then heartbeats while idle", async () => {
  const source = new FakeSource();
  const transport = new FakeTransport();
  const runtime = new BridgeRuntime({
    source,
    transportFactory: () => transport,
    connectionSettleMs: 0,
    session: "a13f",
  });

  await runtime.step(0);
  await runtime.step(5_000);

  assert.equal(transport.dashboards.length, 1);
  assert.deepEqual(transport.dashboards[0]?.counts, {
    run: 0,
    wait: 0,
    err: 0,
  });
  assert.equal(transport.heartbeats.length, 1);
  await runtime.close();
  assert.equal(source.closed, true);
});

test("reconnects and sends the latest full state after a write failure", async () => {
  const source = new FakeSource();
  source.batches.push([
    { type: "thread_discovered", threadId: "root", project: "glance", atMs: 0 },
    { type: "turn_started", threadId: "root", atMs: 0 },
  ]);
  const failed = new FakeTransport();
  failed.failDashboard = true;
  const recovered = new FakeTransport();
  const transports = [failed, recovered];
  const runtime = new BridgeRuntime({
    source,
    transportFactory: () => transports.shift() ?? recovered,
    connectionSettleMs: 0,
    session: "a13f",
  });

  await runtime.step(0);
  assert.equal(failed.opened, false);
  await runtime.step(999);
  assert.equal(recovered.opened, false);
  await runtime.step(1_000);

  assert.equal(recovered.opened, true);
  assert.equal(recovered.dashboards.length, 1);
  assert.deepEqual(recovered.dashboards[0]?.counts, {
    run: 1,
    wait: 0,
    err: 0,
  });
  await runtime.close();
});
