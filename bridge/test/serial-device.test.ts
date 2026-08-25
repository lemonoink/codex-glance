import assert from "node:assert/strict";
import test from "node:test";

import { isEspressifPort, selectDisplayPort } from "../src/serial-device.js";

test("selects an Espressif display and ignores unrelated serial ports", () => {
  assert.deepEqual(
    selectDisplayPort([
      { path: "/dev/tty.Bluetooth-Incoming-Port" },
      { path: "/dev/tty.usbmodem83101", manufacturer: "Espressif" },
    ]),
    { kind: "selected", path: "/dev/tty.usbmodem83101" },
  );
});

test("recognizes Espressif VID metadata without a manufacturer", () => {
  assert.equal(
    isEspressifPort({ path: "/dev/tty.usbmodem1", vendorId: "303A" }),
    true,
  );
});

test("prefers the macOS cu path and deduplicates its tty twin", () => {
  assert.deepEqual(
    selectDisplayPort([
      { path: "/dev/tty.usbmodem83101", manufacturer: "Espressif" },
      { path: "/dev/cu.usbmodem83101", manufacturer: "Espressif" },
    ]),
    { kind: "selected", path: "/dev/cu.usbmodem83101" },
  );
});

test("uses one usbmodem fallback but rejects ambiguous displays", () => {
  assert.deepEqual(selectDisplayPort([{ path: "/dev/tty.usbmodem1" }]), {
    kind: "selected",
    path: "/dev/tty.usbmodem1",
  });
  assert.deepEqual(
    selectDisplayPort([
      { path: "/dev/tty.usbmodem1", manufacturer: "Espressif" },
      { path: "/dev/tty.usbmodem2", manufacturer: "Espressif" },
    ]),
    {
      kind: "ambiguous",
      paths: ["/dev/tty.usbmodem1", "/dev/tty.usbmodem2"],
    },
  );
});

test("reports no display when no USB CDC candidate exists", () => {
  assert.deepEqual(
    selectDisplayPort([{ path: "/dev/tty.Bluetooth-Incoming-Port" }]),
    { kind: "not_found" },
  );
});
