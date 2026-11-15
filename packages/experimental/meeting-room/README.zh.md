---
description: "基于 DSH 会话的会议编排：每场会议一个根会话，每个角色轮次一个 spawn 子代理，首轮互相隔离。"
kind: "package-reference"
---

# @deepseek-ai/dsh-meeting-room

[English](README.md) | 中文

## 概要

`dsh-meeting-room` 把一个目标和一组角色组织成一场会议：专门的根会话承载会议，每个角色在该会话下用自己的子代理完成首轮。角色的首次请求只包含会议目标与自己的角色简报，因此看不到其他角色的初稿。服务返回每轮的子会话 id 与最终文本；会议会话为每个角色记录一条 `subagent/catalog`。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

挂载插件，并给出子代理提供者以及会议会话与子代理使用的路由：

```yaml
- id: meeting-room
  name: '@deepseek-ai/dsh-meeting-room'
  config:
    provider: spawn
    agentOptions:
      provider: deepseek
      model: deepseek-chat
```

在你自己的编排或工具里调用 `ctx.meetingRoom.startMeeting(request, signal?)`。请求包含共享的 `requirement` 和要运行的角色；每个角色给出 `name` 与 `brief`。

- 返回的 `sessionId` 是会议根会话，会议内容从会话日志读取。
- 每个轮次包含角色名、子会话 id 与最终助手文本。
- `signal` 取消子代理启动与后续工作；已完成的轮次仍保留在各自日志中。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `provider` | `spawn` | 每个角色轮次使用的已注册子代理提供者。 |
| `agentOptions` | 未设置 | 会议会话及其子代理的提供者与模型；未设置时沿用组合的路由。 |

## 实现说明

<a id="understand-the-implementation"></a>

<details>
<summary>实现细节——点击展开</summary>

`startMeeting` 先通过 `ctx.agents.create` 创建会议会话，再用 `ctx.subagents.startActivation` 以 `delivery: 'caller'` 依次运行角色，等上一轮结束后才启动下一轮。每个子会话都是空的，因为 `spawn` 提供者声明 `inheritsParentContext: false`，提示文本是它收到的唯一用户消息。

隔离来自提示构造，而非事后过滤：`rolePrompt` 只输出共享目标、角色名与该角色的简报。将来需要阅读他人初稿的讨论轮必须显式构造那部分文本，首轮因此天然独立。

服务在返回前释放会议句柄，因此当前契约不会留下存活的 Agent；会话日志仍然保留。会议会话 id 形如 `meeting-<uuid>`；角色子代理以提供者标签登记在会议会话的目录中。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [子代理运行时](../../subagent/subagent/README.zh.md)：提供者、激活与子代理目录。
- [会话](../../core/session/README.zh.md)：会话头、事件与持久化。

<a id="model-experience"></a>
## 模型体验

### 角色提示

#### 模型看到什么

每个角色收到一条用户消息：`会议目标：<requirement>`、自己的角色名与简报。该请求中不会出现其他角色的提示或初稿，因为 spawn 子会话从空日志开始。

#### Token 影响

每个角色一次请求，大小由会议目标与该角色简报决定；本包不新增工具声明，也不新增系统提示段落。

#### KV 缓存影响

每个子会话从空日志开始，角色之间没有可共享的缓存前缀，首轮按完整提示计费。将来需要读取他人初稿的讨论轮会扩展这段文本，计费方式随之改变。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 只有独立的首次轮次；讨论、异议、裁决与发布尚未实现。
- 轮次串行执行；并行轮次需要先明确工作目录与负责人。
- 服务返回时会释放会议会话，调用方无法拿返回的句柄继续会议。
- 没有客户端页面：会议暂不可在会话日志之外查看。
