# 会议室 · 基于 DeepSeek Harness 的产品规划

本目录是"会议室"新一轮产品化的目标、设计与实施规划。底座改为 DeepSeek Harness（DSH），当前仓库 `D:\agentProjet\deepseek-harness`，分支 `meeting-room`。

## 文档索引

1. [目标与产品定位](01-目标与产品定位.md)：要做什么、为什么、和现有会议室/DSH/Marvis 的关系
2. [产品设计与交互](02-产品设计与交互.md)：角色 Agent、能力 Agent、页面结构、过程透明与审批
3. [技术方案与阶段计划](03-技术方案与阶段计划.md)：DSH 插件架构、数据模型、分阶段里程碑、验收与风险

## 决策记录

- 2026-11-15：底座从自研 Python 会议室转向 DSH（MIT，插件化、Web/Electron 桌面、工具/MCP/技能生态）。
- 现会议室（`meeting-room-studio`）保留为回退与业务规则参考；不直接迁移 UI。
- 角色 Agent 与能力 Agent 分开：角色负责"谁来决定/交付"，能力负责"怎么查/怎么操作"。
- 主助手负责拆解、调度、汇总；会议是它调度的一种协作任务，会议内部治理（独立首轮、争议、终审）不可被主助手跳过。
- 参考产品：Marvis（主 Agent + 预置能力 Agent + 过程透明 + L2 硬审批）、DSH（superagent/会话/工具/MCP/技能）、OpenCode/OpenHands/Magpie（工具与技能生态）。

## 当前状态

- 阶段 0（Spike）尚未开始：先验证 DSH 插件两页 + 多会话编排 + MCP + 桌面打包。
- 现有会议室 v1/v2 已完成并提交到 Gitea `dev/meeting-room-studio`（`ebc9ec6`、`cb68a2f`、`926a528`）。
- 新底座版本库：Gitea `dev/meeting-room-dsh`（private，分支 `meeting-room`），本目录的文档随分支提交。
