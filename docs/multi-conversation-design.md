# Multi-conversation Dashboard / 多对话仪表盘

## Display Model / 显示模型

屏幕以 Codex 对话为最小单元，以项目目录为安全标签。同一对话内的子代理聚合到一行，通过 A2、A3 显示数量。V1 不依赖触控。

The display uses one Codex conversation per row and a project directory as its safe label. Subagents within one conversation are aggregated into that row and shown as A2, A3, and so on. V1 does not require touch.

~~~text
┌────────────────────────────┐
│ CODEX GLANCE         3 ACT │
│ ●2 RUN   ●1 WAIT   ●0 ERR  │
├────────────────────────────┤
│ ■ project #2         01:24 │
│   WAITING    APPROVAL      │
│ ■ web-store #1       00:43 │
│   WORKING    TESTING    A3 │
│ ■ api-server #3      02:08 │
│   WORKING    EDITING       │
├────────────────────────────┤
│ +2 MORE          LINK ●    │
└────────────────────────────┘
~~~

## Selection Rules / 选择规则

1. ERROR 优先，然后是 WAITING、WORKING、DONE。
2. ERROR 和 WAITING 中等待最久的优先；WORKING 和 DONE 中最近变化的优先。
3. DONE 保留 20 秒，IDLE 不占任务行。
4. 最多显示三行，其余通过 +N MORE 汇总。
5. 新出现的 ERROR 或 WAITING 全屏提示两秒，然后固定在列表顶部。

The same rules apply in English: severity determines the first ordering key, oldest actionable alerts come first, recent work comes next, completed items remain for 20 seconds, and only the top three rows are rendered.

## Privacy Boundary / 隐私边界

Bridge 负责把原始 Codex 事件转换成枚举状态。设备只接收短哈希、目录简称、计数、阶段和时间，不接收任何对话内容。

The bridge converts raw Codex events into enum states. The device receives only short hashes, sanitized directory labels, counts, phases, and timing—never conversation content.
