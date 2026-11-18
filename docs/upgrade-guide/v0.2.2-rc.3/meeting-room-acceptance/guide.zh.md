---
kind: upgrade-guide
description: "会议插件的自定义组合需要文件、工作目录及系统提示服务。"
---

# 会议插件的验收服务

[English](guide.md) | 中文

## 变更

会议插件在 agents、tools 和 subagents 之外还依赖 `fs`、`workingDirectory` 和 `systemPrompt`。缺少任一必需服务的自定义组合无法激活该插件。内置 Web 和 headless 基础组合均提供这些服务。保存的计划仍可读取；未明确产物路径的结构化验收节点在产出后停住，需要修改并重新确认计划才能执行验收员工检查。

meeting_start 工具返回包含 meetingId、sessionId 和 rounds 的 JSON 对象，替代按角色拼接的文本。工具发起的参与角色归发起主会话。独立会议侧边栏入口改为会话页头菜单。SQLite 升至 schema 6，包含 Team 共享任务关联及会话团队偏好；旧应用版本拒绝升级后的数据库。新计划保存 originSessionId，未关联旧草稿需要明确接续到主会话。

## 迁移

计划现在必须关联真实工程文档。先用既有文件工具在选定 Git 工程中写文档，再向 `project_plan_save` 传入 `documentPath`。确认和派发前重新检查捕获的路径、哈希及目录。旧计划仍可读取，但新确认或执行前必须保存关联文件的新版本。文件变化后需重新审核，文档历史由 Git 管理。

1. 在包含 `@deepseek-ai/dsh-base` 的 profile 中运行会议插件，或在自定义组合的会议插件条目前挂载文件、工作目录及系统提示提供者。参见[文件服务](../../../../packages/fs/fs/README.zh.md)、[工作目录服务](../../../../packages/session/working-directory/README.zh.md)和[系统提示服务](../../../../packages/core/system-prompt/README.zh.md)。
2. 填写 `review.artifactPaths`，列出执行目录内 UTF-8 文件，再确认修订计划。原草稿保留原内容。
3. 自动节点要求全部验收员工通过。人工节点要求工作台放行，再领取精确检查点续跑。产物变化需要返工和重新验收。

4. 将 meeting_start 结果读取者更新为解析 JSON 字段。从主会话页头更多菜单查看会议，用 meeting_records 和 meeting_record_decision 留存主助手结论。未关联历史会议行继续保留，不推测负责人。
5. 对没有执行记录或主会话关联的旧计划，选择让主助手接续旧计划，发送准备好的接续草稿，并确认新保存的版本。
6. 已有执行仅能从原主会话续跑或返工。授权有界返工时，在启动前保存并确认含 `review.rework.maxAttempts` 的计划，用 `project_execute` 领取最新验收失败检查点。未授权或次数耗尽时先检查并修订计划；已有计划不会自动获得返工授权。
7. 让会议角色使用独立模型路由时，保存含显式提供者和模型字段的员工，在所选角色中提供对应 `employeeId`，通过既有 DSH 提供者配置连接与凭据。未引用员工的角色保留继承路由，缺失员工引用在派发前拒绝会议。
8. 将 `awaiting-direction` 视为等待主会话处理新输入的派工停留状态。先处理输入；计划未变时领取精确检查点续跑，需求变化时保存并确认新版本。不要重复已产出任务，也不要将该状态视为验收通过。
