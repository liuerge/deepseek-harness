# Team 派工可靠性验收记录

本记录对应分工文档《双助手并行开发分工》中助手 B 的 B1–B4，范围限于 Team 关联、领取、同步、完成、关闭收尾和同 Host 并发重试。多厂商配置、团队模式入口和最终产品验收仍由助手 A 负责。

## 基线与改动

- 基线为 `meeting-room` 分支的已提交 HEAD（提交信息为“会议工作台：接入 Team 共享任务关联与幂等派发”），在独立 worktree `D:\agentProjet\deepseek-harness-b`、分支 `meeting-room-team-reliability` 上开发，未复制或改动主工作区中助手 A 的未提交修改。
- 生产代码只修改 `packages/experimental/meeting-room/src/team-link.ts` 和 `packages/experimental/meeting-room/src/project-tools.ts`。
- 新增 `packages/experimental/meeting-room/tests/team-dispatch-reliability.spec.ts` 和专用辅助 `tests/team-dispatch-fixtures.ts`，未修改既有 `tests/meeting-room.spec.ts`。
- 未修改 `src/index.ts`、`src/dashboard.ts`、`src/roster-tools.ts`、`src/types.ts`、`src/store.ts`、Client 包、模型提供者和公共规划文档。

## 最终行为

### B1 人工改派与编辑

项目在领取和完成前核对 Team 任务的项目标记、修订号、状态和负责人，不再用读取到的最新 revision 直接覆盖外部变化。

- 领取要求当前修订号和状态与本项目上次保存的关联一致。人工编辑、释放、改派、重新打开或删除都会产生差异，项目返回 `PROJECT_TEAM_TASK_CONFLICT`，消息包含 `projectId`、`index`、`taskId`、`reason`、保存与当前 revision、保存与当前状态及当前 `ownerId` 的 JSON。
- 任务被删除返回 `PROJECT_TEAM_TASK_DELETED`；在项目放行前被完成返回 `PROJECT_TEAM_TASK_COMPLETED`；续跑时发现未放行节点已完成返回 `PROJECT_TEAM_TASK_AHEAD`。
- 合法返工仍从该项目此前的员工子会话交接：仅当任务仍由保留检查点中该任务的产出会话持有，且修订号和状态未变化时，项目先释放再让新子会话领取。其他负责人不会被抢占。
- 完成只接受产出该放行节点的员工会话。人工放行后的同步从保留检查点取得该会话；待处理状态或负责人不符时不替代新负责人完成，也不解除下游。
- 工作台人工放行本身仍按既有产物版本核对执行；Team 变化会在随后 `project_execute` 的续跑核对中被拒绝，因此下游不会启动。该检查没有侵入 `dashboard.ts`。

### B2 领取前执行门控

Team 已关联的老员工启动使用预留子会话身份，并在产品插件的 `agent/pre-step` 扩展点等待领取结果。`agent/pre-step` 在模型请求和工具执行前运行，因此领取完成前模型请求及有副作用工具都为零。

- 只有领取成功后放行该子会话的步骤。门控按精确子会话 id 匹配，其他员工、验收员工和会议参与者不受影响。
- 领取被拒绝、取消、Team 模式关闭或插件关闭时，门控以失败结束，子会话不产生模型请求和工具写入，项目记录失败或中断。
- 门控条目在成功、失败、取消、启动失败和卸载路径释放；等待同时响应子会话取消信号，取消不会留下悬挂等待。
- 依赖当前本地可续运行子代理提供者（默认 `spawn`）。Team 已关联但提供者不支持预留子会话时不静默降级，返回 `PROJECT_TEAM_GATE_UNAVAILABLE`。未启用 Team 的既有执行不经过门控。

### B3 关联与同步期间的卸载

`project_execute` 从首次异步操作起登记 running 跟踪，覆盖续跑核对、放行同步、工作目录解析、Team 关联、员工执行和验收。插件卸载会中止这些操作并等待其结束，随后才关闭 SQLite。

- 关联或同步阶段被取消时不会写入晚于存储关闭的记录；已启动的子会话在关闭前完成收尾。
- 关联失败仍保留已预留的计划执行和已创建任务的项目标记，不假装外部操作未发生；下次启动按标记吸收原任务。
- 任务持久性未知时继续返回 `PROJECT_TEAM_TASK_UNKNOWN`，要求检查看板后重试，不自动认定成功或失败。

### B4 同 Host 并发重试

计划执行在首次启动时按计划 id 和修订号取得本 Host 实例内的临时占用。

- 两个请求同时到达时，先取得占用的请求继续关联和派发，竞争请求返回 `PROJECT_EXECUTION_BUSY`，不创建第二套 Team 任务，也不启动第二名员工。
- 关联在部分任务创建后失败时，占用在退出路径释放；下一次请求复用已预留执行，按标记吸收已创建任务并只补齐缺失任务。
- 已预留但尚无检查点的执行再次请求走同一条占用路径；已记录启动的重复请求继续由现有 `PROJECT_PLAN_NOT_RUNNABLE` 拒绝。
- 占用在成功、失败、取消和卸载路径释放。该占用只覆盖单进程，不提供跨进程互斥。

## 结构化错误与恢复

| 错误码 | 含义 | 恢复方式 |
|---|---|---|
| `PROJECT_TEAM_TASK_CONFLICT` | Team 任务内容、修订号、状态或负责人已被外部改变 | 检查共享看板与项目检查点；由用户决定恢复原任务、重新规划或接受当前负责人，项目不自动覆盖 |
| `PROJECT_TEAM_TASK_DELETED` | 关联任务已删除 | 恢复看板条目，或保存并确认新的计划版本 |
| `PROJECT_TEAM_TASK_COMPLETED` | 项目放行前任务已完成 | 检查看板与验收记录后重新规划 |
| `PROJECT_TEAM_TASK_AHEAD` | 续跑时发现未放行节点已完成 | 检查验收记录；不得把 Team 完成状态当作项目放行 |
| `PROJECT_TEAM_TASK_OWNER` | 领取后的负责人不是派发员工 | 检查看板与员工会话 |
| `PROJECT_TEAM_TASK_BLOCKED` | 任务依赖尚未解除 | 先完成并放行上游节点 |
| `PROJECT_TEAM_DISABLED` | 执行期间 Team 模式关闭 | 重新启用 Team 并检查看板，或重新规划为未关联执行 |
| `PROJECT_TEAM_GATE_UNAVAILABLE` | Team 已关联但提供者不支持预留子会话 | 配置本地可续运行提供者，或关闭 Team 模式后执行 |
| `PROJECT_EXECUTION_BUSY` | 同 Host 正在启动同一计划 | 等待该请求结束并检查其检查点，不重复派发 |

所有冲突都在启动新员工前返回，并保留现有检查点、报告和 Team 任务现场。

## 实际执行的检查

环境：Windows，Node `v26.13.1`，pnpm `11.28.5`，独立 worktree。未使用 WSL。

| 命令 | 结果 |
|---|---|
| `npx vitest run packages/experimental/meeting-room/tests --reporter=dot` | 2 个文件、56 个测试通过（既有 40 个 + 新增 16 个） |
| `npx vitest run packages/experimental/client-ui-meeting-room/tests packages/experimental/meeting-room-bundle/tests --reporter=dot` | 4 个文件、16 个测试通过 |
| `pnpm run lint` | 通过（`host-contracts` 生成后 oxlint 无错误） |
| `pnpm run build:artifacts` | 8 个 gate 通过，0 失败 |
| `pnpm run build:check` | Host 与 Client aggregate check 均通过 |
| `pnpm run test:docs` | 21 个 gate 通过，0 失败 |

该 worktree 首次执行 `build:artifacts` 时，`meeting-room-bundle` 未被 `tsconfig.host.json` 的 host aggregate 引用，缺省忽略的 `lib/types` 未生成，Host bundle 报入口缺失。先执行 `npx tsc -b packages/experimental/meeting-room-bundle` 生成该被忽略产物（未改源码），随后上述构建通过。

新增 16 个测试覆盖：人工改派、人工释放、人工编辑、删除、提前完成、合法返工交接、领取前零模型请求与零写入、无关员工不被阻塞、领取拒绝、Team 模式关闭、取消后无粘滞门控、关联阶段卸载、放行同步阶段卸载、员工运行阶段卸载、并发初始与已预留启动、部分关联失败后的吸收重试。

`docs/meeting-room` 不属于翻译配对范围；本记录未修改既有规划文档和 README 索引，由助手 A 集成时合并。

## 未完成项与限制

- 仅实现同 Host 单进程占用，未实现跨进程锁或崩溃后的自动恢复。另开进程仍可能重复创建或派发；当前要求人工检查看板与检查点后重试。
- 工作台放行入口不读取 Team 看板；冲突在后续 `project_execute` 核对时报告，期间 Team 任务可能显示与项目检查点不同的临时状态。
- 外部提供者不支持预留子会话时，Team 关联执行会明确失败，尚未提供等价的门控实现。
- 未新增录制会话快照：本次没有改变模型可见输入，门控只阻止请求；会议产品现有回归仍由包内真实 Agent/Team/Session 测试覆盖。若助手 A 的集成改变可见提示或产品入口，应补充对应快照。
- 未使用真实厂商密钥或真实多厂商联调；本记录的证据均为合成适配器。真实连接和多厂商验收由助手 A 完成。
- 未推送、未合并、未改写主工作区历史；改动以独立提交保存在本 worktree。
