import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { ConversationReducer } from "./conversation-reducer.js";
import type { CodexEventSource } from "./desktop-event-source.js";
import { buildDashboardSnapshot } from "./dashboard.js";
import type { DashboardSnapshot } from "./protocol.js";

const SOURCE_SCAN_INTERVAL_MS = 1_000;
const UPDATE_DEBOUNCE_MS = 100;
const LINK_MESSAGE_INTERVAL_MS = 5_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 10_000] as const;

export interface BridgeTransport {
  open(): Promise<void>;
  close(): Promise<void>;
  sendDashboard(snapshot: DashboardSnapshot): Promise<void>;
  sendHeartbeat(session: string, seq: number): Promise<void>;
}

export interface BridgeRuntimeOptions {
  source: CodexEventSource;
  transportFactory: () => BridgeTransport;
  logger?: (message: string) => void;
  connectionSettleMs?: number;
  session?: string;
}

export class BridgeRuntime {
  readonly #connectionSettleMs: number;
  readonly #logger: (message: string) => void;
  readonly #reducer = new ConversationReducer();
  readonly #source: CodexEventSource;
  readonly #transportFactory: () => BridgeTransport;
  #dirtySinceMs: number | undefined = 0;
  #forceDashboard = true;
  #lastDashboardAtMs = Number.NEGATIVE_INFINITY;
  #lastScanAtMs = Number.NEGATIVE_INFINITY;
  #lastSendAtMs = Number.NEGATIVE_INFINITY;
  #nextReconnectAtMs = Number.NEGATIVE_INFINITY;
  #reconnectAttempt = 0;
  #seq = 0;
  #session: string;
  #transport: BridgeTransport | undefined;

  constructor(options: BridgeRuntimeOptions) {
    this.#source = options.source;
    this.#transportFactory = options.transportFactory;
    this.#logger = options.logger ?? (() => undefined);
    this.#connectionSettleMs = options.connectionSettleMs ?? 1_500;
    this.#session = options.session ?? randomBytes(4).toString("hex");
  }

  async run(signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted) {
        await this.step(Date.now());
        try {
          await delay(100, undefined, { signal });
        } catch (error) {
          if (!signal.aborted) {
            throw error;
          }
        }
      }
    } finally {
      await this.close();
    }
  }

  async step(nowMs: number): Promise<void> {
    if (nowMs - this.#lastScanAtMs >= SOURCE_SCAN_INTERVAL_MS) {
      this.#lastScanAtMs = nowMs;
      const events = await this.#source.scan(nowMs);
      const changed = events.reduce(
        (anyChanged, event) => this.#reducer.apply(event) || anyChanged,
        false,
      );
      if (changed && this.#dirtySinceMs === undefined) {
        this.#dirtySinceMs = nowMs;
      }
    }

    if (
      this.#reducer.expireCompleted(nowMs) &&
      this.#dirtySinceMs === undefined
    ) {
      this.#dirtySinceMs = nowMs;
    }

    if (!this.#transport && nowMs >= this.#nextReconnectAtMs) {
      await this.#connect(nowMs);
    }
    if (!this.#transport) {
      return;
    }

    const conversations = this.#reducer.conversations();
    const needsElapsedRefresh =
      conversations.some((item) => item.status !== "IDLE") &&
      nowMs - this.#lastDashboardAtMs >= LINK_MESSAGE_INTERVAL_MS;
    const debounceComplete =
      this.#dirtySinceMs !== undefined &&
      nowMs - this.#dirtySinceMs >= UPDATE_DEBOUNCE_MS;

    if (this.#forceDashboard || debounceComplete || needsElapsedRefresh) {
      await this.#sendDashboard(nowMs, conversations);
      return;
    }
    if (nowMs - this.#lastSendAtMs >= LINK_MESSAGE_INTERVAL_MS) {
      await this.#sendHeartbeat(nowMs);
    }
  }

  async close(): Promise<void> {
    this.#source.close();
    const transport = this.#transport;
    this.#transport = undefined;
    if (transport) {
      await transport.close().catch(() => undefined);
    }
  }

  async #connect(nowMs: number): Promise<void> {
    const transport = this.#transportFactory();
    try {
      await transport.open();
      if (this.#connectionSettleMs > 0) {
        await delay(this.#connectionSettleMs);
      }
      this.#transport = transport;
      this.#reconnectAttempt = 0;
      this.#forceDashboard = true;
      this.#logger("[bridge] device connected");
    } catch {
      await transport.close().catch(() => undefined);
      this.#scheduleReconnect(nowMs);
      this.#logger("[bridge] device connection failed; retry scheduled");
    }
  }

  async #sendDashboard(
    nowMs: number,
    conversations: ReturnType<ConversationReducer["conversations"]>,
  ): Promise<void> {
    const seq = this.#nextSequence();
    const snapshot = buildDashboardSnapshot(
      this.#session,
      seq,
      conversations,
      nowMs,
    );
    try {
      await this.#transport?.sendDashboard(snapshot);
      this.#forceDashboard = false;
      this.#dirtySinceMs = undefined;
      this.#lastDashboardAtMs = nowMs;
      this.#lastSendAtMs = nowMs;
      this.#logger(
        `[bridge] dashboard run=${snapshot.counts.run} wait=${snapshot.counts.wait} err=${snapshot.counts.err} visible=${snapshot.tasks.length}`,
      );
    } catch {
      await this.#handleTransportFailure(nowMs);
    }
  }

  async #sendHeartbeat(nowMs: number): Promise<void> {
    const seq = this.#nextSequence();
    try {
      await this.#transport?.sendHeartbeat(this.#session, seq);
      this.#lastSendAtMs = nowMs;
      this.#logger("[bridge] heartbeat acknowledged");
    } catch {
      await this.#handleTransportFailure(nowMs);
    }
  }

  async #handleTransportFailure(nowMs: number): Promise<void> {
    const transport = this.#transport;
    this.#transport = undefined;
    if (transport) {
      await transport.close().catch(() => undefined);
    }
    this.#forceDashboard = true;
    this.#scheduleReconnect(nowMs);
    this.#logger("[bridge] device link lost; retry scheduled");
  }

  #scheduleReconnect(nowMs: number): void {
    const index = Math.min(
      this.#reconnectAttempt,
      RECONNECT_DELAYS_MS.length - 1,
    );
    this.#nextReconnectAtMs = nowMs + (RECONNECT_DELAYS_MS[index] ?? 10_000);
    this.#reconnectAttempt += 1;
  }

  #nextSequence(): number {
    if (this.#seq >= 0xffff_ffff) {
      this.#session = randomBytes(4).toString("hex");
      this.#seq = 0;
    }
    this.#seq += 1;
    return this.#seq;
  }
}
