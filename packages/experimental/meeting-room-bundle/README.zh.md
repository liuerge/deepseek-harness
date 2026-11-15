---
description: "在一个 profile bundle 中同时挂载会议服务与会议页面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-meeting-room-bundle

[English](README.md) | 中文

## 摘要

本 bundle 为 profile 组合会议室产品：包含 `meeting_start` 工具与 SQLite 索引的主机会议服务，以及会议列表页与会议详情页。列出本 bundle 的 profile 会同时挂载两半，因此侧栏入口与工具一并到位。bundle 自身不含运行时代码，其行都在 patch 文件中。本 bundle 不增加任何面向模型的输入。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 profile 的 `dsh.profile.bundles` 数组中列出 `@deepseek-ai/dsh-meeting-room-bundle`。profile 组合器把 bundle 的 patch 应用到空的 profile 根配置上，插入两行：主机会议服务与会议页面。页面随后注册侧栏入口与主面板；服务注册 `meeting_start` 工具，因此模型可以发起会议，页面也能列出它落库的内容。

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
- [会议页面](../client-ui-meeting-room/README.zh.md) —— 会议列表、会议详情页与侧栏入口。

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
