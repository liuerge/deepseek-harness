---
kind: upgrade-guide
description: "会话日志上传和桌面埋点改为需要显式启用，不再默认导出。"
---

# 日志上传改为显式启用

[English](guide.md) | 中文

## 变更

会话遥测默认使用 `DISABLED`，官方 DeepSeek 的 `dsh_session_log` 贡献器默认 `enabled: false`，随附 profile 禁用桌面埋点及其导出器。本地 Session 持久保存、反馈、正常模型请求及 Agent 工具操作仍可使用。既有显式设置及后置覆盖仍优先；默认值变更不会撤销此前的启用设置，也不能撤回已经发送的请求。

## 迁移

1. 如需禁止上传，删除 profile、home 和命令行 patch 中的显式启用配置。设置 `session-telemetry-otel.config.mode: DISABLED`、`session-log-deepseek.config.enabled: false`，并禁用 `product-analytics` 与 `desktop-product-telemetry` 两行。重启活动 Host，以替换此前的有效配置。
2. 如需保留反馈触发的导出，显式设置 `session-telemetry-otel.config.mode: FEEDBACK_ONLY`，或设置 `DSH_TELEMETRY_MODE=FEEDBACK_ONLY`。`DSH_TELEMETRY_DISABLED` 强制禁用开关仍然优先。
3. 如需保留官方模型的日志贡献，显式设置 `session-log-deepseek.config.enabled: true`。桌面埋点需显式启用两行，并设置 `product-analytics.config.enabled: true`。
4. 提交反馈或模型请求前检查有效配置。默认配置下，反馈保存在本地，官方模型请求不携带 `dsh_session_log`，桌面埋点不查询身份，也不创建采集导出器。
