import { SerialPort } from "serialport";

export interface SerialPortDescriptor {
  path: string;
  manufacturer?: string | undefined;
  pnpId?: string | undefined;
  productId?: string | undefined;
  vendorId?: string | undefined;
}

export type DisplayPortSelection =
  | { kind: "selected"; path: string }
  | { kind: "not_found" }
  | { kind: "ambiguous"; paths: string[] };

const ESPRESSIF_USB_VENDOR_ID = "303a";

function physicalDeviceKey(path: string): string {
  return path.replace(/^\/dev\/(?:cu|tty)\./, "/dev/serial.");
}

function pathPreference(path: string): number {
  if (path.startsWith("/dev/cu.")) {
    return 0;
  }
  if (path.startsWith("/dev/tty.")) {
    return 1;
  }
  return 2;
}

function deduplicateDevices(
  ports: readonly SerialPortDescriptor[],
): SerialPortDescriptor[] {
  const devices = new Map<string, SerialPortDescriptor>();
  for (const port of ports) {
    const key = physicalDeviceKey(port.path);
    const current = devices.get(key);
    if (!current || pathPreference(port.path) < pathPreference(current.path)) {
      devices.set(key, port);
    }
  }
  return [...devices.values()];
}

export function isEspressifPort(port: SerialPortDescriptor): boolean {
  return (
    /espressif/i.test(port.manufacturer ?? "") ||
    (port.vendorId ?? "").toLowerCase() === ESPRESSIF_USB_VENDOR_ID ||
    /espressif|vid_303a/i.test(port.pnpId ?? "")
  );
}

export function selectDisplayPort(
  ports: readonly SerialPortDescriptor[],
): DisplayPortSelection {
  const devices = deduplicateDevices(ports);
  const strongMatches = devices.filter(isEspressifPort);
  const candidates =
    strongMatches.length > 0
      ? strongMatches
      : devices.filter((port) => /usbmodem/i.test(port.path));

  if (candidates.length === 0) {
    return { kind: "not_found" };
  }
  if (candidates.length > 1) {
    return {
      kind: "ambiguous",
      paths: candidates.map((port) => port.path).toSorted(),
    };
  }
  return { kind: "selected", path: candidates[0]?.path ?? "" };
}

export async function discoverDisplayPort(): Promise<string> {
  const selection = selectDisplayPort(await SerialPort.list());
  switch (selection.kind) {
    case "selected":
      return selection.path;
    case "not_found":
      throw new Error("No Espressif USB display found");
    case "ambiguous":
      throw new Error(
        "Multiple Espressif USB displays found; use --port: " +
          selection.paths.join(", "),
      );
  }
}
