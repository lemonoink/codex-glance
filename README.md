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
- LVGL 9.5.0
- Board FQBN: esp32:esp32:waveshare_esp32_s3_touch_lcd_169

这里有意使用较新的 ESP32/GFX 版本。厂商文档中的 3.0.5/1.6.5 组合目前在编译 Arduino_GFX 的 ESP32 LCD 总线时会失败；以上版本已通过本仓库的编译检查。

The newer ESP32/GFX versions are intentional. The vendor-documented 3.0.5/1.6.5 combination currently fails while compiling Arduino_GFX's ESP32 LCD buses; the versions above pass this repository's compile check.

固件内置由 Noto Sans SC 生成的 16px/2bpp 中文字库，覆盖 GB2312 的 6763 个简体中文字以及常用标点。生成文件遵循 [SIL Open Font License](firmware/codex_glance/OFL-NotoSansSC.txt)；8MB 原始 OTF 不进入仓库。

Firmware embeds a 16px/2bpp bitmap generated from Noto Sans SC, covering all 6,763 GB2312 Simplified Chinese characters plus common punctuation. The generated asset follows the [SIL Open Font License](firmware/codex_glance/OFL-NotoSansSC.txt); the 8 MB source OTF is not committed.

## 构建与开发 / Build and Development

检查环境、Bridge 和固件：

Check the environment, bridge, and firmware:

~~~bash
make env-check
make bridge-install
arduino-cli lib install lvgl@9.5.0
make bridge-test
make firmware-compile
~~~

如需从官方 Noto Sans SC OTF 重建字库：

To regenerate the font from the official Noto Sans SC OTF:

~~~bash
make firmware-font FONT=/path/to/NotoSansSC-Regular.otf
~~~

上传固件前先使用 arduino-cli board list 查找串口：

Before uploading, locate the port with arduino-cli board list:

~~~bash
make firmware-upload PORT=/dev/cu.usbmodemXXXX
~~~

## 多对话实机演示 / Multi-conversation Hardware Demo

屏幕自检已在实机上通过。当前固件使用 LVGL，每页只显示一个任务，并每 5 秒自动轮播；ERROR 和 WAITING 仍优先显示。任务卡包含显式设置的中文任务名、项目目录名、状态、阶段、耗时和代理数。10 秒未收到快照或心跳时显示 OFFLINE。

The display self-test has passed on hardware. The LVGL firmware shows one task per page and rotates every five seconds, while ERROR and WAITING remain prioritized. Each card shows the explicitly assigned task name, project directory, state, phase, elapsed time, and agent count. OFFLINE appears after ten seconds without a snapshot or heartbeat.

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

演示验证优先级、单任务分页、中文标签、子代理计数、完成态和空闲仪表盘。每次消息都必须收到设备 ACK。完整规则见 [USB CDC 协议](docs/protocol.md) 和 [多对话仪表盘设计](docs/multi-conversation-design.md)。

The demo verifies priority, one-task paging, Unicode labels, subagent counts, completed states, and the empty dashboard. Every message must receive a device ACK. See the [USB CDC protocol](docs/protocol.md) and [multi-conversation dashboard design](docs/multi-conversation-design.md).

演示开始时会静默 11 秒验证 OFFLINE 和 heartbeat 恢复；演示退出 10 秒后再次显示 OFFLINE 属于预期行为，真实 Bridge 会持续发送有效消息。

The demo starts with an 11-second silence to verify OFFLINE and heartbeat recovery. OFFLINE appearing again ten seconds after the demo exits is expected; the real bridge continuously sends valid messages.

## 仓库结构 / Repository Layout

- bridge/：TypeScript Desktop 事件适配器、状态 reducer、USB Bridge 和模拟器。 / TypeScript Desktop event adapter, state reducer, USB bridge, and simulator.
- firmware/codex_glance/：ESP32-S3 固件。 / ESP32-S3 firmware.
- scripts/：可复现的开发环境检查脚本。 / Reproducible development checks.
- docs/：架构、仪表盘和通信协议文档。 / Architecture, dashboard, and protocol documentation.

## 隐私与安全 / Privacy and Security

USB v3 协议包含短哈希、显式设置的用户任务名、项目目录简称、状态枚举、计数和时间。Bridge 只读取 `threads.name`，不会读取可能包含提示词的内部 `title` 或 `preview` 字段。请勿在测试样本或串口日志中保存提示词、回复、推理内容、源代码、命令输出或原始 Codex 会话文件。

The USB v3 protocol contains short hashes, explicitly assigned user-facing task names, project directory labels, enum states, counts, and timing. The bridge reads only `threads.name`; it never reads internal `title` or `preview` fields that may contain prompt text. Do not place prompts, responses, reasoning, source code, command output, or raw Codex session files in fixtures or serial logs.
