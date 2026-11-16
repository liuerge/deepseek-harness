---
description: "在一个 profile bundle 中同时挂载会议服务与会议页面。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-meeting-room-bundle

[English](README.md) | 中文

## 概述

在 Web profile 中一起启用会议与项目流程的 Host 服务和 Client 界面。从主会话发起角色、查看既有子智能体记录，并分别留存角色意见和助手结论。项目工作台展示真实计划、进度与验收。模型路由和持久化在 profile 补丁中配置，bundle 自身不增加模型输入。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将 `@deepseek-ai/dsh-meeting-room-bundle` 追加到现有 Web profile 的 `dsh.profile.bundles` 数组，在基础和 Web bundle 之后加载。它加入 Host 会议服务与 Client 界面。Client 提供项目工作台和主会话会议菜单，Host 提供工具与持久流程记录。基础组合提供所需的 Agent、文件、Session 和子智能体服务。

bundle 不负责配置服务。服务自身的配置（`provider`、`agentOptions` 与 `databasePath`）属于 profile 的 patch 层，靠后的一层会替换该行的配置。

-----

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现细节 —— 点击展开</summary>

bundle 的实质是它的 patch 文件，由 `dsh.bundle.patch` 清单字段声明，profile 组合器通过该字段解析。模块本身不含运行时 API。

| 文件 | 作用 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | bundle 插入的两行 |
| [`src/index.ts`](src/index.ts) | 空模块；行都在 patch 中 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [会议室主机插件](../meeting-room/README.zh.md) —— 会议服务、`meeting_start` 工具与 SQLite 索引。
- [会议页面](../client-ui-meeting-room/README.zh.md) —— 项目工作台和会话会议菜单。

-----

<a id="model-experience"></a>
## 模型体验

无。本 bundle 只组合插件，不增加任何面向模型的输入。

#### KV Cache 影响

无直接影响；会议服务与 `meeting_start` 工具负责后续面向模型的使用。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **自身不带配置** —— 服务的 provider、模型路由与数据库路径仍放在 profile 的 patch 层。
- **两行合为一个产品** —— bundle 挂载两半；只要页面的 profile 可以直接列 client 包。

<a id="dev-note"></a>
### 开发备注

补丁仅负责组合，流程行为和导航分别由 Host 与 Client 包 README 描述。
