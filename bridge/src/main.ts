import { homedir } from "node:os";
import { resolve } from "node:path";

import { BridgeRuntime } from "./bridge-runtime.js";
import { DesktopEventSource } from "./desktop-event-source.js";
import { SerialTransport } from "./serial-transport.js";

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const portPath = readArgument("--port");
if (!portPath) {
  console.error(
    "Usage: npm run dev -- --port /dev/tty.usbmodemXXXX [--codex-home ~/.codex]",
  );
  process.exitCode = 1;
} else {
  const configuredHome = readArgument("--codex-home");
  const codexHome = configuredHome
    ? resolve(configuredHome.replace(/^~(?=\/|$)/, homedir()))
    : resolve(homedir(), ".codex");
  const abortController = new AbortController();
  const requestStop = (): void => abortController.abort();
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  const source = new DesktopEventSource({
    codexHome,
    logger: (message) => console.warn(message),
  });
  const runtime = new BridgeRuntime({
    source,
    transportFactory: () => new SerialTransport(portPath),
    logger: (message) => console.log(message),
  });

  console.log("[bridge] watching Codex Desktop events");
  try {
    await runtime.run(abortController.signal);
  } catch {
    console.error("[bridge] stopped after an unexpected runtime error");
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", requestStop);
    process.removeListener("SIGTERM", requestStop);
  }
}
