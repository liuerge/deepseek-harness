---
description: "Web 客户端的会议列表页与会议详情页。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-meeting-room

[English](README.md) | 中文

## 摘要

本包为 Web 客户端增加会议页面：侧栏入口打开会议列表，行点击进入某场会议的详情页。两页展示本包自带的样例会议，因此在真实会议存在之前，版式、阶段条与会议治理规则已经可见。列表按会议状态筛选，并按标题与项目搜索；详情页展示阶段条、各轮发言、右侧卡片、争议台账与产物。所有文案都在带类型的 locale 字典中，提供八种已发布语言。本包不增加任何面向模型的输入。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

侧栏显示一个 **会议** 入口，图标是人群。选中后，主面板打开会议列表；打开某场会议的详情页时，同一个入口保持选中。

列表页标题为 **会议**，右侧是主色按钮 **新建会议**，其下是分段筛选 **全部 / 进行中 / 待我确认 / 已完成** 与一个搜索框。每行显示会议标题与所属项目、以圆点和文字表示的会议状态、最多三个成员头像加其余人数、`完成/总数` 形式的轮次进度、距上次更新的时间，以及当前方案版本与其终审状态。筛选与搜索都没有命中时列表为空并给出说明；一个还没有任何会议的配置显示指向主助手的空态。

详情页显示会议标题、会议状态、**暂停** 与 **追加轮次** 两个按钮，以及五段阶段条：独立首轮、讨论、综合裁决、独立终审、发布完成。各轮按时间线排列；发言卡标注角色、模型与时间，讨论轮的发言标出它回应的是哪一轮哪个角色。其他角色在独立首轮的初稿以斜纹占位遮住并写明发布规则，因为首轮在终审前保持独立。右侧一列依次是控制卡（含调用预算）、只读材料、方案版本与终审状态、成员及其权限。轮次之下是争议台账（异议、提出人、裁决、依据）与产物文件卡及 **验收** 操作。

两页读取其注册方注入的记录。本包自带六场样例会议与三份完整记录：界面文案随界面语言，样例记录保留样例自身的语言。

-----

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现细节 —— 点击展开</summary>

客户端导出通过 Cordis effect 注册 locale 字典与两个 slot，不挂载任何 Remote 命名空间。主 slot 以面板 id `meeting-room` 为键，`sidebar.panellist` 列表项使用同一 id，因此侧栏行与面板占位共享一个身份。插件 fiber 释放时，两处注册与字典一并移除。

面板的查看状态放在声明式 store 中：当前打开的会议、列表筛选与搜索词。组件通过框架的选择器 hook 读状态，通过声明的动作写状态。没有打开会议时面板渲染列表页，否则渲染该会议的详情页。

文案集中在一个带类型的字典里；样例记录在独立模块中，保留自身语言。注册时注入这些记录，后续由 Host 数据源替换时不必改动页面。

| 文件 | 作用 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 字典、主面板与侧栏入口注册 |
| [`src/client/MeetingRoomPanel.tsx`](src/client/MeetingRoomPanel.tsx) | 在列表页与详情页之间切换 |
| [`src/client/MeetingListPage.tsx`](src/client/MeetingListPage.tsx) | 筛选、搜索与会议行 |
| [`src/client/MeetingDetailPage.tsx`](src/client/MeetingDetailPage.tsx) | 阶段条、轮次时间线、右侧卡片、台账与产物 |
| [`src/client/meeting-store.ts`](src/client/meeting-store.ts) | 面板的查看状态 |
| [`src/client/meeting-format.ts`](src/client/meeting-format.ts) | 状态、阶段、权限与相对时间辅助函数 |
| [`src/client/demo-data.ts`](src/client/demo-data.ts) | 样例会议及其完整记录 |
| [`src/client/locales.ts`](src/client/locales.ts) | 八种语言的页面文案 |
| [`src/index.ts`](src/index.ts) | 空实现的 Host 入口 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [会议室主机插件](../meeting-room/README.zh.md) —— 会议服务、`meeting_start` 工具与 SQLite 索引。
- [产品设计与交互](../../../docs/meeting-room/02-产品设计与交互.md) —— 两页遵循的信息架构。
- [UI 出图需求](../../../docs/meeting-room/08-UI出图需求.md) —— 两页的版式、配色与样例内容。

-----

<a id="model-experience"></a>
## 模型体验

无。这些页面只渲染注册方注入的记录，不增加任何面向模型的输入。

#### KV Cache 影响

无直接影响；会议服务与 `meeting_start` 工具负责后续面向模型的使用。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **只有样例记录** —— 两页读取本包自带的样例会议，尚无 Host 数据源接入。
- **只读页面** —— 筛选、搜索与按钮只改变本地查看状态；创建会议、暂停会议、验收产物属于 Host 服务。
- **没有产品导航** —— 侧栏入口只打开一个面板；产品自己的导航属于产品设计中描述的会议室外壳。
