import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { type ConversationState, buildDashboardSnapshot } from "./dashboard.js";
import { SerialTransport } from "./serial-transport.js";

const SESSION = randomBytes(4).toString("hex");

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseInterval(value: string | undefined): number {
  if (value === undefined) {
    return 2_500;
  }

  const interval = Number(value);
  if (!Number.isSafeInteger(interval) || interval < 250) {
    throw new Error("--interval must be an integer of at least 250 ms");
  }
  return interval;
}

function task(
  nowMs: number,
  overrides: Partial<ConversationState> &
    Pick<ConversationState, "conversationId" | "project" | "slot">,
): ConversationState {
  return {
    status: "WORKING",
    phase: "THINKING",
    startedAtMs: nowMs - 84_000,
    changedAtMs: nowMs,
    agents: 1,
    ...overrides,
  };
}

function createDemoStages(nowMs: number): readonly ConversationState[][] {
  const glance = task(nowMs, {
    conversationId: "glance-usb",
    project: "Codex Glance",
    slot: 1,
    phase: "TESTING",
  });
  const storefront = task(nowMs, {
    conversationId: "storefront-ui",
    project: "web-store",
    slot: 1,
    phase: "EDITING",
    agents: 3,
    startedAtMs: nowMs - 43_000,
  });
  const api = task(nowMs, {
    conversationId: "api-refactor",
    project: "api-server",
    slot: 2,
    phase: "COMMAND",
    startedAtMs: nowMs - 128_000,
  });
  const mobile = task(nowMs, {
    conversationId: "mobile-release",
    project: "ios-client",
    slot: 3,
    phase: "APPROVAL",
    status: "WAITING",
    changedAtMs: nowMs - 15_000,
  });
  const docs = task(nowMs, {
    conversationId: "docs-build",
    project: "docs-site",
    slot: 1,
    phase: "FAILED",
    status: "ERROR",
    changedAtMs: nowMs - 10_000,
  });

  return [
    [],
    [glance, storefront],
    [glance, storefront, mobile],
    [glance, storefront, api, mobile, docs],
    [
      { ...glance, status: "DONE", phase: "COMPLETE", changedAtMs: nowMs },
      storefront,
      api,
      mobile,
      docs,
    ],
    [
      { ...glance, status: "DONE", phase: "COMPLETE", changedAtMs: nowMs },
      {
        ...storefront,
        status: "DONE",
        phase: "COMPLETE",
        changedAtMs: nowMs,
      },
      { ...api, status: "DONE", phase: "COMPLETE", changedAtMs: nowMs },
    ],
    [],
  ];
}

const portPath = readArgument("--port");
if (!portPath) {
  console.error(
    "Usage: npm run dev -- --port /dev/cu.usbmodemXXXX [--interval 2500]",
  );
  process.exitCode = 1;
} else {
  const intervalMs = parseInterval(readArgument("--interval"));
  const transport = new SerialTransport(portPath);
  const nowMs = Date.now();
  const stages = createDemoStages(nowMs);

  try {
    console.log("[bridge] opening " + portPath);
    await transport.open();
    await delay(1_500);

    let seq = 0;
    for (const [index, conversations] of stages.entries()) {
      seq += 1;
      const snapshot = buildDashboardSnapshot(
        SESSION,
        seq,
        conversations,
        nowMs + index * intervalMs,
      );
      console.log(
        "[bridge] -> dashboard seq=" +
          seq +
          " run=" +
          snapshot.counts.run +
          " wait=" +
          snapshot.counts.wait +
          " err=" +
          snapshot.counts.err +
          " visible=" +
          snapshot.tasks.length,
      );
      await transport.sendDashboard(snapshot);
      console.log("[bridge] <- ACK " + SESSION + ":" + seq);

      if (index === 0) {
        console.log("[bridge] pausing 11s to trigger LINK LOST");
        await delay(11_000);
        seq += 1;
        console.log("[bridge] -> heartbeat seq=" + seq);
        await transport.sendHeartbeat(SESSION, seq);
        console.log("[bridge] <- heartbeat ACK " + SESSION + ":" + seq);
      }
      await delay(intervalMs);
    }

    console.log("[bridge] demo complete; display returned to idle dashboard");
  } finally {
    await transport.close();
  }
}
