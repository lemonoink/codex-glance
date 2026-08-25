# Codex Glance

Codex Glance 是一款用于显示本地 Codex Desktop 并行任务状态的紧凑型 ESP32-S3 设备。Mac Bridge 会统一处理本地任务事件，并通过 USB CDC 向 Waveshare ESP32-S3-Touch-LCD-1.69 发送经过隐私过滤的 NDJSON 仪表盘快照。

Codex Glance is a compact ESP32-S3 display for parallel local Codex Desktop tasks. A Mac bridge normalizes local task events and sends privacy-filtered NDJSON dashboard snapshots over USB CDC to a Waveshare ESP32-S3-Touch-LCD-1.69.

## 开发环境 / Development Environment

- macOS on Apple Silicon
- Node.js 24.18.0
- Arduino CLI 1.5.1
- Espressif Arduino Core 3.3.11
- GFX Library for Arduino 1.6.7
- ArduinoJson 7.4.3
- Board FQBN: esp32:esp32:waveshare_esp32_s3_touch_lcd_169

这里有意使用较新的 ESP32/GFX 版本。厂商文档中的 3.0.5/1.6.5 组合目前在编译 Arduino_GFX 的 ESP32 LCD 总线时会失败；以上版本已通过本仓库的编译检查。

The newer ESP32/GFX versions are intentional. The vendor-documented 3.0.5/1.6.5 combination currently fails while compiling Arduino_GFX's ESP32 LCD buses; the versions above pass this repository's compile check.

## 构建与开发 / Build and Development

检查环境、Bridge 和固件：

Check the environment, bridge, and firmware:

~~~bash
make env-check
make bridge-install
make bridge-test
make firmware-compile
~~~

上传固件前先使用 arduino-cli board list 查找串口：

Before uploading, locate the port with arduino-cli board list:

~~~bash
make firmware-upload PORT=/dev/cu.usbmodemXXXX
~~~

## 多对话实机演示 / Multi-conversation Hardware Demo

屏幕自检已在实机上通过。当前固件启动后显示 WAITING FOR BRIDGE，收到快照后显示活动汇总和最多三个并行对话。新的 ERROR 或 WAITING 会全屏提示两秒；10 秒未收到快照或心跳时显示 LINK LOST。

The display self-test has passed on hardware. The firmware starts at WAITING FOR BRIDGE, then shows activity counts and up to three parallel conversations. A new ERROR or WAITING takes over the screen for two seconds; LINK LOST appears after ten seconds without a snapshot or heartbeat.

插入设备并启动真实 Codex Desktop Bridge；Bridge 会自动发现唯一的 Espressif USB CDC 屏幕：

Connect the device and start the real Codex Desktop bridge. The bridge automatically discovers the single Espressif USB CDC display:

~~~bash
make bridge-run
~~~

如果连接了多个候选设备，可查询端口并手动指定：

If multiple candidate devices are connected, list the ports and select one explicitly:

~~~bash
npm --prefix bridge run ports
make bridge-run PORT=/dev/tty.usbmodemXXXX
~~~

Bridge 只读监听 `~/.codex/sessions/`，将根任务和子代理聚合后发送到屏幕。设备断连时会重新扫描，因此 USB 接口或设备编号变化后也能自动恢复。当前兼容目标是 Codex CLI `0.149.0-alpha.4.3`；原始提示词、回复、推理、代码、命令和输出不会写入日志或 USB。运行方式、状态映射与排障说明见 [Desktop Bridge](docs/bridge.md)。

The bridge watches `~/.codex/sessions/` read-only, aggregates root tasks and subagents, and sends the reduced state to the display. It rescans devices after a disconnect, so a changed USB device number is recovered automatically. The current compatibility target is Codex CLI `0.149.0-alpha.4.3`; raw prompts, responses, reasoning, code, commands, and output are never logged or sent over USB. See [Desktop Bridge](docs/bridge.md) for runtime behavior, state mapping, and troubleshooting.

也可以运行五对话模拟：

You can also run the five-conversation simulation:

~~~bash
npm --prefix bridge run ports
make bridge-demo PORT=/dev/cu.usbmodemXXXX
~~~

演示验证优先级、三行裁剪、子代理计数、完成态和空闲仪表盘。每次消息都必须收到设备 ACK。完整规则见 [USB CDC 协议](docs/protocol.md) 和 [多对话仪表盘设计](docs/multi-conversation-design.md)。

The demo verifies priority, three-row clipping, subagent counts, completed states, and the empty dashboard. Every message must receive a device ACK. See the [USB CDC protocol](docs/protocol.md) and [multi-conversation dashboard design](docs/multi-conversation-design.md).

演示开始时会静默 11 秒验证 LINK LOST 和 heartbeat 恢复；演示退出 10 秒后再次显示 LINK LOST 属于预期行为，真实 Bridge 会持续发送心跳。

The demo starts with an 11-second silence to verify LINK LOST and heartbeat recovery. LINK LOST appearing again ten seconds after the demo exits is expected; the real bridge will keep sending heartbeats.

## 仓库结构 / Repository Layout

- bridge/：TypeScript Desktop 事件适配器、状态 reducer、USB Bridge 和模拟器。 / TypeScript Desktop event adapter, state reducer, USB bridge, and simulator.
- firmware/codex_glance/：ESP32-S3 固件。 / ESP32-S3 firmware.
- scripts/：可复现的开发环境检查脚本。 / Reproducible development checks.
- docs/：架构、仪表盘和通信协议文档。 / Architecture, dashboard, and protocol documentation.

## 隐私与安全 / Privacy and Security

USB 协议只包含短哈希、目录简称、状态枚举、计数和时间。请勿在测试样本或串口日志中保存提示词、推理内容、对话标题、源代码、命令输出或原始 Codex 会话文件。

The USB protocol contains only short hashes, sanitized directory labels, enum states, counts, and timing. Do not place prompts, reasoning, chat titles, source code, command output, or raw Codex session files in fixtures or serial logs.
