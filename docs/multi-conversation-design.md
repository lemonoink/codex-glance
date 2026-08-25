# Single-task Carousel / 单任务轮播

## Display Model / 显示模型

屏幕一次只显示一个 Codex 根任务。子代理聚合到根任务并显示代理数；顶部保留全局 RUN、WAIT、ERROR 计数，底部显示页码和轮播进度。LVGL 负责卡片、圆角、颜色、中文字体和滑入动画。内置 Noto Sans SC 字库覆盖 GB2312 的 6763 个简体中文字，避免 LVGL 默认 1338 字子集造成缺字方框。

The display shows one Codex root task at a time. Subagents are aggregated into the root and shown as an agent count. Global RUN, WAIT, and ERROR counts remain in the header; page number and carousel progress appear in the footer. LVGL provides the card, rounded styling, colors, CJK font, and slide-in animation. The embedded Noto Sans SC font covers all 6,763 GB2312 Simplified Chinese characters, replacing LVGL's limited 1,338-glyph built-in subset.

~~~text
┌────────────────────────────┐
│ CODEX GLANCE   R2 W1 E0    │
├────────────────────────────┤
│ 项目：Codex Glance    WAIT │
│                            │
│ 优化屏幕任务卡片           │
│                            │
│ APPROVAL                   │
│ 01:24          AGENTS  2   │
├────────────────────────────┤
│      ━━━━━       2 / 3 LINK│
└────────────────────────────┘
~~~

## Ordering and Rotation / 排序与轮播

1. `ERROR` 优先，其次为 `WAITING`、`WORKING`、`DONE`。
2. `ERROR` 和 `WAITING` 中等待最久的优先；其他状态按最近变化排序。
3. `DONE` 保留 20 秒；`IDLE` 不生成页面。
4. Bridge 每 5 秒选择下一页并只发送该页；状态变化立即回到第 1 页。
5. 最多 99 页，单条 USB 消息仍小于 512 字节。

The same rules apply in English: severity is the first ordering key, oldest actionable alerts come first, recent work follows, DONE remains for 20 seconds, and the bridge advances one page every five seconds. A state change returns to page one.

## Touch Extension / 触控扩展

本版不启用 CST816T。后续触控驱动会把左滑、右滑转换为 `next`、`previous` 导航消息，由 Bridge 更新页索引并返回标准 v3 dashboard 页面。这样自动轮播、触控和任务优先级共用同一个状态源，LVGL 页面无需改结构。

The CST816T is intentionally disabled in this revision. A later touch driver will convert swipes into `next` and `previous` navigation messages. The bridge will update its page index and return a normal v3 dashboard page, allowing automatic rotation, touch, and priority ordering to share one state source without restructuring the LVGL screen.

## Privacy Boundary / 隐私边界

设备只接收短哈希、显式设置的 `threads.name`、项目目录 basename、计数、状态、阶段和时间。未设置名称时使用 `Codex 任务 #N`。Bridge 不读取内部 `title` 或 `preview`，也不发送提示词、回复、推理、代码、命令或输出。

The device receives only a short hash, explicit `threads.name`, project basename, counts, state, phase, and timing. Unnamed tasks use `Codex 任务 #N`. The bridge does not read internal `title` or `preview`, and never sends prompts, responses, reasoning, code, commands, or output.
