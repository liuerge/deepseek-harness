---
kind: upgrade-guide
description: "会议插件的自定义组合需要文件和工作目录服务，以执行带版本核对的验收。"
---

# 会议插件的验收服务

[English](guide.md) | 中文

## 变更

会议插件在 agents、tools 和 subagents 之外还依赖 `fs` 和 `workingDirectory`。缺少其中任一服务的自定义组合无法激活该插件。内置 Web 和 headless 基础组合均提供这两项服务。保存的计划仍可读取；未明确产物路径的结构化验收节点在产出后停住，需要修改并重新确认计划才能执行验收员工检查。

meeting_start 工具返回包含 meetingId、sessionId 和 rounds 的 JSON 对象，替代按角色拼接的文本。工具发起的参与角色归发起主会话。独立会议侧边栏入口改为会话页头菜单。SQLite 升至 schema 4，旧应用版本拒绝升级后的数据库。新计划保存 originSessionId，未关联旧草稿需要明确接续到主会话。

## 迁移

1. 在包含 `@deepseek-ai/dsh-base` 的 profile 中运行会议插件，或在自定义组合的会议插件条目前挂载文件和工作目录提供者。参见[文件服务](../../../../packages/fs/fs/README.zh.md)和[工作目录服务](../../../../packages/session/working-directory/README.zh.md)。
2. 通过 `project_plan_save` 修改结构化验收节点时，在 `review.artifactPaths` 中提供执行目录内非空的 UTF-8 文件路径，并在项目工作台确认新版本。已有草稿保留原内容。
3. 执行确认计划。自动节点仅在全部独立验收员工通过后继续；人工节点展示报告和工作台放行操作，确认后使用已放行项目 id 和精确检查点继续。产物变化需要返工和重新验收。

4. 将 meeting_start 结果读取者更新为解析 JSON 字段。从主会话页头更多菜单查看会议，用 meeting_records 和 meeting_record_decision 留存主助手结论。未关联历史会议行继续保留，不推测负责人。
5. 对没有执行记录或主会话关联的旧计划，选择让主助手接续旧计划，发送准备好的接续草稿，并确认新保存的版本。
6. 已有执行仅能从原主会话续跑或返工。授权有界返工时，在启动前保存并确认含 `review.rework.maxAttempts` 的计划，用 `project_execute` 领取最新验收失败检查点。未授权或次数耗尽时先检查并修订计划；已有计划不会自动获得返工授权。
