# USB CDC Protocol / USB CDC 协议

Codex Glance 使用 115200 波特率的 USB CDC。每条消息是一行 UTF-8 NDJSON，包含换行符在内必须小于 512 字节。当前协议版本为 v2。

Codex Glance uses USB CDC at 115200 baud. Each message is one UTF-8 NDJSON line and must be under 512 bytes including the newline. The current protocol version is v2.

## Dashboard Snapshot / 仪表盘快照

Bridge 仅在仪表盘内容变化时发送完整快照。tasks 已按 ERROR → WAITING → WORKING → DONE 排序，最多包含三项。

The bridge sends a complete snapshot only when dashboard content changes. tasks is ordered by ERROR → WAITING → WORKING → DONE and contains at most three entries.

    {"v":2,"type":"dashboard","session":"a13f","seq":42,"counts":{"run":2,"wait":1,"err":0},"tasks":[{"id":"7c21","project":"codex-glance","slot":2,"status":"WAITING","phase":"APPROVAL","elapsed":84,"agents":1}]}

- session：Bridge 每次启动生成的 4–8 位小写十六进制标识。 / A 4–8 character lowercase hex identifier generated at bridge startup.
- seq：同一 session 内严格递增的 uint32 序号。 / A strictly increasing uint32 within one session.
- counts：所有活动对话的汇总，不仅限于三条可见记录。 / Counts all active conversations, not only visible rows.
- id：对话标识的短哈希。 / Short hash of the conversation identifier.
- project：最多 14 个安全 ASCII 字符的目录简称。 / Sanitized directory label of at most 14 ASCII characters.
- slot：同一项目内的对话序号。 / Conversation number within the project.
- status：WORKING、WAITING、DONE 或 ERROR。
- phase：受限枚举，例如 THINKING、EDITING、TESTING、APPROVAL。
- elapsed：运行秒数。 / Elapsed seconds.
- agents：该对话聚合的代理数量。 / Number of agents aggregated into the conversation.

## Heartbeat / 心跳

内容未变化时，Bridge 至少每 5 秒发送一次心跳。心跳更新连接状态和序号，但不会重绘屏幕。10 秒未收到有效消息时，设备显示 LINK LOST。

When content is unchanged, the bridge sends a heartbeat at least every five seconds. It updates connection state and sequence without redrawing the display. The device shows LINK LOST after ten seconds without a valid message.

    {"v":2,"type":"heartbeat","session":"a13f","seq":43}

## Responses / 设备响应

有效消息会得到包含同一 session 和 seq 的 ACK：

A valid message receives an ACK with the same session and seq:

    {"type":"ack","v":2,"session":"a13f","seq":43}

无效、超长或过期输入会得到 NACK。固件拒绝未知字段和未知枚举。

Invalid, oversized, or stale input receives a NACK. Firmware rejects unknown fields and enum values.

    {"type":"nack","v":2,"code":"stale_snapshot"}

协议不得承载提示词、推理、对话标题、源代码或命令输出。

The protocol must never carry prompts, reasoning, chat titles, source code, or command output.
