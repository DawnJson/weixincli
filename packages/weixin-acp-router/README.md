# weixin-acp-router

仓库地址：`https://github.com/DawnJson/weixincli`
问题反馈：`https://github.com/DawnJson/weixincli/issues`

把单个 WeChat Claw 会话路由到 Codex 和 Claude ACP agent 之间。

这个包内置了原本来自以下位置的运行时代码：

- `wong2/weixin-agent-sdk` `packages/sdk`
- `wong2/weixin-agent-sdk` `packages/weixin-acp`

内置文件仍在 `src/vendor/` 中保留来源注释，包内也继续附带 `LICENSE`。

## 安装

```bash
npm install -g weixin-acp-router
```

或者在发布后直接运行：

```bash
npx weixin-acp-router codex
npx weixin-acp-router codex resume <sessionId>
npx weixin-acp-router claude
npx weixin-acp-router claude resume <sessionId>
```

## 用法

先选一个默认模型启动：

```bash
npx weixin-acp-router codex
npx weixin-acp-router claude
```

如果当前还没有微信登录状态，CLI 会自动进入扫码登录流程。

## 运行流程

```text
微信消息
  -> weixin-acp-router
  -> 当前聊天路由
  -> codex-acp / claude-agent-acp
  -> 响应回到微信
```

## 微信命令与行为

- 普通消息：发送到当前聊天绑定的模型。
- 启动命令：决定尚未切换过的聊天默认使用哪个模型。
- `/help`：查看当前微信侧支持的命令说明。
- `/codex` 和 `/claude`：把当前聊天切换到指定模型。
- `/codex <message>` 和 `/claude <message>`：先切模型，再立即转发消息。
- `/cd <path>`：修改当前微信会话的工作目录。
- `/pwd`：查看当前微信会话的工作目录。
- `/sessions`：查看当前模型最近 5 个会话。
- `/sessions codex` 和 `/sessions claude`：查看指定模型最近 5 个会话，但不切换当前聊天路由。
- `/plan`：让当前模型进入规划模式。
- `Claude` 的 `/plan`：使用官方 ACP 原生 `plan` mode。模型会先进入规划态，产出计划后，微信侧会收到计划内容；只有用户回复 `/do` 后才会继续执行，回复 `/undo` 则放弃本次计划。
- `Codex` 的 `/plan`：不是官方 ACP 原生 `plan` mode，而是项目内实现的软规划流程。模型会先按普通对话产出一份计划，系统把这份计划缓存为“待确认计划”，然后回发到微信，等待用户决定。
- `/do`：执行当前聊天里待确认的计划。
- `/undo`：丢弃当前聊天里待确认的计划。
- `/unplan`：把当前模型切回 `default` 模式。
- `plan` 许可流程：无论当前是 Claude 还是 Codex，计划都不会在回发后立刻执行；必须由用户在微信里显式回复 `/do` 才会开始执行，回复 `/undo` 则直接取消。
- `plan` 结束方式：执行完 `/do` 后，会话会回到普通执行流程；如果只想退出规划态而不执行，可以用 `/undo` 或 `/unplan`。
- `/resume latest`：恢复当前工作目录下当前模型最近一次会话。
- `/resume <sessionId>`：恢复当前模型的指定会话 ID。
- `/resume codex <sessionId>` 和 `/resume claude <sessionId>`：恢复指定模型会话，并把当前聊天切到该模型。
- `/resume codex latest` 和 `/resume claude latest`：恢复指定模型在当前工作目录下最近一次会话，并切换当前聊天。
- 使用 `npx weixin-acp-router codex resume <sessionId>` 或 `npx weixin-acp-router claude resume <sessionId>` 启动时，会在默认模型首次被使用时恢复指定会话。
- 会话隔离：Codex 和 Claude 会分别为每个微信会话维护各自独立的 ACP 会话。
