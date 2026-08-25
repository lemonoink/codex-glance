import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { StringDecoder } from "node:string_decoder";

import {
  CodexJsonlParser,
  type NormalizedCodexEvent,
  safeThreadId,
} from "./codex-events.js";

const INITIAL_SESSION_WINDOW_MS = 24 * 60 * 60 * 1_000;
const READ_CHUNK_BYTES = 64 * 1024;

interface FileCursor {
  decoder: StringDecoder;
  inode: number;
  offset: number;
  parser: CodexJsonlParser;
}

interface SafeLogRow {
  atMs: number;
  id: number;
  safeKind: "attention_required" | "attention_resolved" | null;
  threadId: string | null;
}

export interface CodexEventSource {
  scan(nowMs: number): Promise<NormalizedCodexEvent[]>;
  close(): void;
}

export interface DesktopEventSourceOptions {
  codexHome: string;
  logger?: (message: string) => void;
}

async function collectJsonlFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsonlFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(path);
    }
  }
  return files;
}

function logDatabaseNumber(name: string): number | undefined {
  const match = /^logs_(\d+)\.sqlite$/.exec(name);
  return match?.[1] ? Number(match[1]) : undefined;
}

export class DesktopEventSource implements CodexEventSource {
  readonly #codexHome: string;
  readonly #cursors = new Map<string, FileCursor>();
  readonly #logger: (message: string) => void;
  readonly #warnings = new Set<string>();
  #logCursor = 0;
  #logDatabase: DatabaseSync | undefined;
  #logDatabasePath: string | undefined;

  constructor(options: DesktopEventSourceOptions) {
    this.#codexHome = options.codexHome;
    this.#logger = options.logger ?? (() => undefined);
  }

  async scan(nowMs: number): Promise<NormalizedCodexEvent[]> {
    const events: NormalizedCodexEvent[] = [];
    try {
      const files = await collectJsonlFiles(join(this.#codexHome, "sessions"));
      for (const path of files) {
        try {
          const metadata = await stat(path);
          const tracked = this.#cursors.get(path);
          if (
            !tracked &&
            nowMs - metadata.mtimeMs > INITIAL_SESSION_WINDOW_MS
          ) {
            continue;
          }

          let cursor = tracked;
          if (
            !cursor ||
            cursor.inode !== metadata.ino ||
            metadata.size < cursor.offset
          ) {
            cursor = {
              decoder: new StringDecoder("utf8"),
              inode: metadata.ino,
              offset: 0,
              parser: new CodexJsonlParser(),
            };
            this.#cursors.set(path, cursor);
          }
          if (metadata.size > cursor.offset) {
            events.push(
              ...(await this.#readAppended(path, cursor, metadata.size, nowMs)),
            );
          }
        } catch {
          // Codex can rotate a file between discovery and read; retry next scan.
        }
      }
    } catch {
      this.#warnOnce(
        "sessions",
        "[source] Codex session directory is unavailable",
      );
    }

    events.push(...(await this.#scanSafeLogEvents(nowMs)));
    return events.toSorted((left, right) => left.atMs - right.atMs);
  }

  close(): void {
    this.#logDatabase?.close();
    this.#logDatabase = undefined;
  }

  async #readAppended(
    path: string,
    cursor: FileCursor,
    size: number,
    nowMs: number,
  ): Promise<NormalizedCodexEvent[]> {
    const events: NormalizedCodexEvent[] = [];
    const handle = await open(path, "r");
    try {
      while (cursor.offset < size) {
        const length = Math.min(READ_CHUNK_BYTES, size - cursor.offset);
        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(
          buffer,
          0,
          length,
          cursor.offset,
        );
        if (bytesRead === 0) {
          break;
        }
        cursor.offset += bytesRead;
        events.push(
          ...cursor.parser.push(
            cursor.decoder.write(buffer.subarray(0, bytesRead)),
            nowMs,
          ),
        );
      }
    } finally {
      await handle.close();
    }
    return events;
  }

  async #scanSafeLogEvents(nowMs: number): Promise<NormalizedCodexEvent[]> {
    try {
      await this.#ensureLatestLogDatabase();
      if (!this.#logDatabase) {
        return [];
      }

      // feedback_log_body is classified inside SQLite and is never selected.
      const rows = this.#logDatabase
        .prepare(
          `SELECT id,
                  (ts * 1000) + (ts_nanos / 1000000) AS atMs,
                  thread_id AS threadId,
                  CASE
                    WHEN instr(lower(feedback_log_body), 'requestapproval') BETWEEN 1 AND 160
                      OR instr(lower(feedback_log_body), 'requestuserinput') BETWEEN 1 AND 160
                      THEN 'attention_required'
                    WHEN instr(lower(feedback_log_body), 'serverrequest/resolved') BETWEEN 1 AND 160
                      THEN 'attention_resolved'
                    ELSE NULL
                  END AS safeKind
             FROM logs
            WHERE id > ?
              AND target = 'codex_app_server::outgoing_message'
            ORDER BY id`,
        )
        .all(this.#logCursor) as unknown as SafeLogRow[];

      const events: NormalizedCodexEvent[] = [];
      for (const row of rows) {
        this.#logCursor = Math.max(this.#logCursor, Number(row.id));
        if (!row.safeKind || !row.threadId) {
          continue;
        }
        events.push({
          type: row.safeKind,
          threadId: safeThreadId(row.threadId),
          atMs: Number(row.atMs) || nowMs,
        });
      }
      return events;
    } catch {
      this.#warnOnce(
        "logs",
        "[source] transient approval events are unavailable",
      );
      this.#closeLogDatabase();
      return [];
    }
  }

  async #ensureLatestLogDatabase(): Promise<void> {
    const entries = await readdir(this.#codexHome, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isFile())
      .map((entry) => ({
        name: entry.name,
        number: logDatabaseNumber(entry.name),
      }))
      .filter(
        (entry): entry is { name: string; number: number } =>
          entry.number !== undefined,
      )
      .sort((left, right) => right.number - left.number);
    const latest = candidates[0];
    if (!latest) {
      return;
    }

    const path = join(this.#codexHome, latest.name);
    if (path === this.#logDatabasePath && this.#logDatabase) {
      return;
    }

    this.#closeLogDatabase();
    this.#logDatabase = new DatabaseSync(path, { readOnly: true });
    this.#logDatabasePath = path;
    const row = this.#logDatabase
      .prepare("SELECT coalesce(max(id), 0) AS id FROM logs")
      .get() as { id: number };
    // Replay a bounded tail so a Bridge started during an approval can recover it.
    this.#logCursor = Math.max(0, Number(row.id) - 1_000);
  }

  #closeLogDatabase(): void {
    this.#logDatabase?.close();
    this.#logDatabase = undefined;
    this.#logDatabasePath = undefined;
    this.#logCursor = 0;
  }

  #warnOnce(key: string, message: string): void {
    if (this.#warnings.has(key)) {
      return;
    }
    this.#warnings.add(key);
    this.#logger(message);
  }
}
