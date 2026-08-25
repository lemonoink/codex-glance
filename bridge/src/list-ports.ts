import { SerialPort } from "serialport";

const ports = await SerialPort.list();

if (ports.length === 0) {
  console.log("No serial ports found.");
} else {
  for (const port of ports) {
    const details = [port.manufacturer, port.vendorId, port.productId]
      .filter(Boolean)
      .join(" / ");
    console.log(details ? `${port.path} (${details})` : port.path);
  }
}
