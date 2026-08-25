import { SerialPort } from "serialport";

import {
  type DashboardSnapshot,
  createHeartbeat,
  encodeDashboardSnapshot,
  encodeHeartbeat,
} from "./protocol.js";

const ACK_TIMEOUT_MS = 2_000;

interface PendingAck {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class SerialTransport {
  readonly #port: SerialPort;
  readonly #pendingAcks = new Map<string, PendingAck>();
  #inputBuffer = "";

  constructor(path: string) {
    this.#port = new SerialPort({
      path,
      baudRate: 115_200,
      autoOpen: false,
    });
    this.#port.on("data", (chunk: Buffer) => this.#handleData(chunk));
  }

  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#port.open((error) => (error ? reject(error) : resolve()));
    });
  }

  async close(): Promise<void> {
    for (const pending of this.#pendingAcks.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Serial port closed before ACK"));
    }
    this.#pendingAcks.clear();

    if (!this.#port.isOpen) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.#port.close((error) => (error ? reject(error) : resolve()));
    });
  }

  async sendDashboard(snapshot: DashboardSnapshot): Promise<void> {
    await this.#send(
      encodeDashboardSnapshot(snapshot),
      snapshot.session,
      snapshot.seq,
    );
  }

  async sendHeartbeat(session: string, seq: number): Promise<void> {
    await this.#send(
      encodeHeartbeat(createHeartbeat(session, seq)),
      session,
      seq,
    );
  }

  async #send(payload: string, session: string, seq: number): Promise<void> {
    const key = this.#ackKey(session, seq);
    const ack = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingAcks.delete(key);
        reject(new Error("Timed out waiting for ACK " + key));
      }, ACK_TIMEOUT_MS);

      this.#pendingAcks.set(key, { resolve, reject, timer });
    });

    try {
      await new Promise<void>((resolve, reject) => {
        this.#port.write(payload, (writeError) => {
          if (writeError) {
            reject(writeError);
            return;
          }
          this.#port.drain((drainError) =>
            drainError ? reject(drainError) : resolve(),
          );
        });
      });
    } catch (error) {
      const pending = this.#pendingAcks.get(key);
      if (pending) {
        clearTimeout(pending.timer);
        this.#pendingAcks.delete(key);
      }
      throw error;
    }

    await ack;
  }

  #ackKey(session: string, seq: number): string {
    return session + ":" + seq;
  }

  #handleData(chunk: Buffer): void {
    this.#inputBuffer += chunk.toString("utf8");

    let newlineIndex = this.#inputBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.#inputBuffer.slice(0, newlineIndex).trim();
      this.#inputBuffer = this.#inputBuffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        this.#handleLine(line);
      }
      newlineIndex = this.#inputBuffer.indexOf("\n");
    }
  }

  #handleLine(line: string): void {
    console.log("[device] " + line);

    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (typeof message !== "object" || message === null) {
      return;
    }

    const record = message as Record<string, unknown>;
    if (record.type === "nack") {
      const reason = String(record.code ?? "unknown_error");
      for (const [key, pending] of this.#pendingAcks) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Device rejected message: " + reason));
        this.#pendingAcks.delete(key);
      }
      return;
    }

    if (
      record.type !== "ack" ||
      typeof record.session !== "string" ||
      typeof record.seq !== "number"
    ) {
      return;
    }

    const key = this.#ackKey(record.session, record.seq);
    const pending = this.#pendingAcks.get(key);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.#pendingAcks.delete(key);
    pending.resolve();
  }
}
