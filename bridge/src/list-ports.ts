import { SerialPort } from "serialport";

import { isEspressifPort } from "./serial-device.js";

const ports = await SerialPort.list();

if (ports.length === 0) {
  console.log("No serial ports found.");
} else {
  for (const port of ports) {
    const details = [port.manufacturer, port.vendorId, port.productId]
      .filter(Boolean)
      .join(" / ");
    const candidate = isEspressifPort(port) ? " [Codex Glance candidate]" : "";
    console.log(
      (details ? `${port.path} (${details})` : port.path) + candidate,
    );
  }
}
