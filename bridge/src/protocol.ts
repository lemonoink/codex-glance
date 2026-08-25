export const PROTOCOL_VERSION = 2 as const;
export const MAX_MESSAGE_BYTES = 512;
export const MAX_VISIBLE_TASKS = 3;
export const MAX_PROJECT_LENGTH = 14;

export const TASK_STATUSES = ["WORKING", "WAITING", "DONE", "ERROR"] as const;
export const TASK_PHASES = [
  "THINKING",
  "READING",
  "EDITING",
  "COMMAND",
  "TESTING",
  "SEARCHING",
  "TOOL",
  "APPROVAL",
  "COMPLETE",
  "FAILED",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPhase = (typeof TASK_PHASES)[number];

export interface DashboardCounts {
  run: number;
  wait: number;
  err: number;
}

export interface DashboardTask {
  id: string;
  project: string;
  slot: number;
  status: TaskStatus;
  phase: TaskPhase;
  elapsed: number;
  agents: number;
}

export interface DashboardSnapshot {
  v: typeof PROTOCOL_VERSION;
  type: "dashboard";
  session: string;
  seq: number;
  counts: DashboardCounts;
  tasks: DashboardTask[];
}

export interface HeartbeatMessage {
  v: typeof PROTOCOL_VERSION;
  type: "heartbeat";
  session: string;
  seq: number;
}

function isUint32(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function isSmallCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 99;
}

function validateToken(
  name: string,
  value: string,
  pattern: RegExp,
  maximumLength: number,
): void {
  if (
    value.length === 0 ||
    value.length > maximumLength ||
    !pattern.test(value)
  ) {
    throw new TypeError("Invalid " + name + ": " + value);
  }
}

function validateSession(session: string): void {
  validateToken("session", session, /^[a-f0-9]+$/, 8);
  if (session.length < 4) {
    throw new TypeError("Session must contain at least four hex characters");
  }
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    typeof value === "string" &&
    TASK_STATUSES.some((status) => status === value)
  );
}

export function isTaskPhase(value: unknown): value is TaskPhase {
  return (
    typeof value === "string" && TASK_PHASES.some((phase) => phase === value)
  );
}

export function createDashboardSnapshot(
  session: string,
  seq: number,
  counts: DashboardCounts,
  tasks: readonly DashboardTask[],
): DashboardSnapshot {
  validateSession(session);
  if (!isUint32(seq)) {
    throw new RangeError("Sequence must be a uint32 integer");
  }
  if (
    !isSmallCount(counts.run) ||
    !isSmallCount(counts.wait) ||
    !isSmallCount(counts.err)
  ) {
    throw new RangeError("Dashboard counts must be integers from 0 to 99");
  }
  if (tasks.length > MAX_VISIBLE_TASKS) {
    throw new RangeError(
      "Dashboard supports at most " + MAX_VISIBLE_TASKS + " tasks",
    );
  }

  const validatedTasks = tasks.map((task) => {
    validateToken("task id", task.id, /^[a-f0-9]+$/, 8);
    validateToken(
      "project",
      task.project,
      /^[A-Za-z0-9._-]+$/,
      MAX_PROJECT_LENGTH,
    );
    if (!isSmallCount(task.slot) || task.slot === 0) {
      throw new RangeError("Task slot must be an integer from 1 to 99");
    }
    if (!isTaskStatus(task.status)) {
      throw new TypeError("Unsupported task status: " + String(task.status));
    }
    if (!isTaskPhase(task.phase)) {
      throw new TypeError("Unsupported task phase: " + String(task.phase));
    }
    if (!isUint32(task.elapsed)) {
      throw new RangeError("Task elapsed time must be a uint32 integer");
    }
    if (!isSmallCount(task.agents) || task.agents === 0) {
      throw new RangeError("Agent count must be an integer from 1 to 99");
    }
    return { ...task };
  });

  return {
    v: PROTOCOL_VERSION,
    type: "dashboard",
    session,
    seq,
    counts: { ...counts },
    tasks: validatedTasks,
  };
}

export function createHeartbeat(
  session: string,
  seq: number,
): HeartbeatMessage {
  validateSession(session);
  if (!isUint32(seq)) {
    throw new RangeError("Sequence must be a uint32 integer");
  }
  return {
    v: PROTOCOL_VERSION,
    type: "heartbeat",
    session,
    seq,
  };
}

function encodeMessage(message: DashboardSnapshot | HeartbeatMessage): string {
  const line = JSON.stringify(message) + "\n";
  const byteLength = Buffer.byteLength(line, "utf8");

  if (byteLength >= MAX_MESSAGE_BYTES) {
    throw new RangeError(
      "Protocol message is " +
        byteLength +
        " bytes; it must be under " +
        MAX_MESSAGE_BYTES,
    );
  }

  return line;
}

export function encodeDashboardSnapshot(snapshot: DashboardSnapshot): string {
  return encodeMessage(snapshot);
}

export function encodeHeartbeat(message: HeartbeatMessage): string {
  return encodeMessage(message);
}
