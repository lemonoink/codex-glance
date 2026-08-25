import { homedir } from "node:os";
import { resolve } from "node:path";

import { BridgeRuntime } from "./bridge-runtime.js";
import { DesktopEventSource } from "./desktop-event-source.js";
import { discoverDisplayPort } from "./serial-device.js";
import { SerialTransport } from "./serial-transport.js";

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const configuredPort = readArgument("--port");
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
let lastPortPath: string | undefined;
const runtime = new BridgeRuntime({
  source,
  transportFactory: async () => {
    const portPath = configuredPort ?? (await discoverDisplayPort());
    if (portPath !== lastPortPath) {
      console.log("[bridge] using display " + portPath);
      lastPortPath = portPath;
    }
    return new SerialTransport(portPath);
  },
  logger: (message) => console.log(message),
});

console.log(
  configuredPort
    ? "[bridge] watching Codex Desktop events with a fixed display port"
    : "[bridge] watching Codex Desktop events with automatic display discovery",
);
try {
  await runtime.run(abortController.signal);
} catch {
  console.error("[bridge] stopped after an unexpected runtime error");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", requestStop);
  process.removeListener("SIGTERM", requestStop);
}
