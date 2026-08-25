# USB CDC Protocol / USB CDC 协议

Codex Glance 使用 115200 波特率的 USB CDC。每条消息是一行 UTF-8 NDJSON，包含换行符在内必须小于 512 字节。当前协议版本为 v3。

Codex Glance uses USB CDC at 115200 baud. Each message is one UTF-8 NDJSON line and must be under 512 bytes including the newline. The current protocol version is v3.

## Dashboard Page / 仪表盘页面

每条完整快照只包含当前页的一个任务。Bridge 按 ERROR → WAITING → WORKING → DONE 排序，并每 5 秒选择下一页；固件负责 LVGL 滑入动画。`page.index` 从 1 开始，空列表使用 `{index:0,total:0}` 和 `task:null`。

Each full snapshot contains only the task on the current page. The bridge orders tasks by ERROR → WAITING → WORKING → DONE and selects the next page every five seconds; firmware renders the LVGL slide animation. `page.index` is one-based. An empty list uses `{index:0,total:0}` and `task:null`.

    {"v":3,"type":"dashboard","session":"a13f","seq":42,"counts":{"run":2,"wait":1,"err":0},"page":{"index":2,"total":3},"task":{"id":"7c21","title":"优化屏幕任务卡片","project":"Codex Glance","slot":2,"status":"WAITING","phase":"APPROVAL","elapsed":84,"agents":1}}

- `session`：Bridge 启动时生成的 4–8 位小写十六进制标识。 / A 4–8 character lowercase hex identifier generated at bridge startup.
- `seq`：同一 session 内严格递增的 uint32。 / A strictly increasing uint32 within one session.
- `counts`：全部活动任务的汇总，最大值 99。 / Counts all active tasks, capped at 99.
- `page`：当前页和总页数，最多 99 页。 / Current page and total page count, up to 99.
- `id`：任务 ID 的 8 位短哈希。 / Eight-character task ID hash.
- `title`：显式设置的 `threads.name`，UTF-8 最多 96 字节；未设置时使用本地通用名称。 / Explicit `threads.name`, up to 96 UTF-8 bytes; otherwise a generic local fallback.
- `project`：项目目录 basename，UTF-8 最多 48 字节。 / Project directory basename, up to 48 UTF-8 bytes.
- `status`：`WORKING`、`WAITING`、`DONE` 或 `ERROR`。
- `phase`：受限枚举，例如 `THINKING`、`EDITING`、`TESTING`、`APPROVAL`。
- `elapsed`：运行秒数。 / Elapsed seconds.
- `agents`：聚合到该根任务的代理数量。 / Agents aggregated into the root task.

## Heartbeat / 心跳

没有任务时由 5 秒 heartbeat 保活；只有一个任务时每 5 秒刷新耗时；多任务轮播本身构成完整快照。设备 10 秒未收到有效消息时显示 `OFFLINE`。

With zero tasks, a five-second heartbeat keeps the link alive. With one task, a page snapshot refreshes elapsed time every five seconds. With multiple tasks, carousel snapshots keep the link alive. The device shows `OFFLINE` after ten seconds without a valid message.

    {"v":3,"type":"heartbeat","session":"a13f","seq":43}

## Responses / 设备响应

有效消息返回相同 `session` 和 `seq` 的 ACK；无效、超长、过期或包含未知字段的输入返回 NACK。

Valid messages receive an ACK with the same `session` and `seq`. Invalid, oversized, stale, or unknown-field input receives a NACK.

    {"type":"ack","v":3,"session":"a13f","seq":43}
    {"type":"nack","v":3,"code":"stale_snapshot"}

协议只允许显式用户任务名和项目目录名，不得承载提示词、回复、推理、源代码、命令或输出。未来触控翻页会增加设备到 Bridge 的导航消息，不改变 dashboard 页面结构。

The protocol permits only explicit user-facing task names and project directory names. Prompts, responses, reasoning, source code, commands, and output are forbidden. Future touch paging will add a device-to-bridge navigation message without changing the dashboard page shape.
