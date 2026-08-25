# Desktop Bridge / 桌面桥接程序

## Data Flow / 数据流

Bridge 以只读方式扫描 `~/.codex/sessions/` 中最近活动的 Codex Desktop JSONL 文件。每条原始记录会立即转换为安全事件：任务短哈希、项目目录简称、状态、阶段、时间和父任务关系。原始提示词、回复、推理、代码、命令及输出不会进入 reducer、日志或 USB 消息。

The bridge scans recently active Codex Desktop JSONL files under `~/.codex/sessions/` in read-only mode. Each source record is immediately reduced to a safe event containing only a short task hash, sanitized project label, state, phase, timing, and parent relationship. Prompts, responses, reasoning, code, commands, and output never enter the reducer, logs, or USB messages.

瞬时审批状态通过最新的 `logs_*.sqlite` 补充。SQL 只返回事件分类和任务 ID，不会把原始日志正文返回给 Bridge。该兼容层当前针对 Codex CLI `0.149.0-alpha.4.3`，未知记录会被安全忽略。

Transient approval state is supplemented from the latest `logs_*.sqlite`. SQL returns only an event classification and task ID; raw log bodies are never returned to the bridge. This compatibility layer currently targets Codex CLI `0.149.0-alpha.4.3`, and unknown records are ignored safely.

## Run / 运行

先查找串口，再启动真实 Bridge：

Find the serial port, then start the real bridge:

~~~bash
npm --prefix bridge run ports
npm --prefix bridge run dev -- --port /dev/tty.usbmodemXXXX
~~~

如需读取另一个 Codex 数据目录：

To read another Codex data directory:

~~~bash
npm --prefix bridge run dev -- --port /dev/tty.usbmodemXXXX --codex-home /path/to/.codex
~~~

`Ctrl-C` 会安全关闭串口。设备断连后 Bridge 按 1、2、4、8、10 秒退避重试；连接恢复后立即发送完整快照。空闲时每五秒发送 heartbeat，设备十秒未收到有效消息时显示 `LINK LOST`。

`Ctrl-C` closes the serial port cleanly. After a disconnect, the bridge retries after 1, 2, 4, 8, then 10 seconds and sends a full snapshot immediately after recovery. While idle it sends a heartbeat every five seconds; the device shows `LINK LOST` after ten seconds without a valid message.

## State Mapping / 状态映射

- 活动任务为 `WORKING`；推理、文件修改、命令、MCP 和搜索映射到对应 phase。 / Active turns are `WORKING`; reasoning, edits, commands, MCP calls, and searches map to their matching phase.
- 明确的审批或用户输入请求为 `WAITING / APPROVAL`。 / Explicit approval or user-input requests become `WAITING / APPROVAL`.
- 正常完成或中断为 `DONE / COMPLETE`；明确失败为 `ERROR / FAILED`。 / Completion or interruption becomes `DONE / COMPLETE`; explicit failure becomes `ERROR / FAILED`.
- 子代理根据 `parent_thread_id` 聚合到根任务，并显示 `A2`、`A3`。 / Subagents are aggregated by `parent_thread_id` and shown as `A2`, `A3`, and so on.

模拟器仍可用于不启动真实 Codex 任务的屏幕检查：

The simulator remains available for display checks without real Codex tasks:

~~~bash
npm --prefix bridge run demo -- --port /dev/tty.usbmodemXXXX
~~~
