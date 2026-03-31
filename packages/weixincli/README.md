# weixincli

仓库地址：`https://github.com/DawnJson/weixincli`
问题反馈：`https://github.com/DawnJson/weixincli/issues`

把单个 WeChat Claw 会话路由到 Codex 和 Claude ACP agent 之间。

这个包内置了原本来自以下位置的运行时代码：

- `wong2/weixin-agent-sdk` `packages/sdk`
- `wong2/weixin-agent-sdk` `packages/weixin-acp`

内置文件仍在 `src/vendor/` 中保留来源注释，包内也继续附带 `LICENSE`。

## 安装

```bash
npm install -g weixincli
```

或者在发布后直接运行：

```bash
npx weixincli codex
npx weixincli codex resume <sessionId>
npx weixincli claude
npx weixincli claude resume <sessionId>
```

## 用法

先选一个默认模型启动：

```bash
npx weixincli codex
npx weixincli claude
```

如果当前还没有微信登录状态，CLI 会自动进入扫码登录流程。

## 运行流程

```text
微信消息
  -> weixincli
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
- `/plan`：让当前模型进入规划模式。Claude 使用原生 ACP `plan` mode；Codex 使用软规划流程，先返回计划再等待确认。
- `/do`：执行当前聊天里待确认的计划。
- `/undo`：丢弃当前聊天里待确认的计划。
- `/unplan`：把当前模型切回 `default` 模式。
- `plan` 模式：计划会先回发到微信，再等待 `/do` 或 `/undo`。
- `/resume latest`：恢复当前工作目录下当前模型最近一次会话。
- `/resume <sessionId>`：恢复当前模型的指定会话 ID。
- `/resume codex <sessionId>` 和 `/resume claude <sessionId>`：恢复指定模型会话，并把当前聊天切到该模型。
- `/resume codex latest` 和 `/resume claude latest`：恢复指定模型在当前工作目录下最近一次会话，并切换当前聊天。
- 使用 `npx weixincli codex resume <sessionId>` 或 `npx weixincli claude resume <sessionId>` 启动时，会在默认模型首次被使用时恢复指定会话。
- 会话隔离：Codex 和 Claude 会分别为每个微信会话维护各自独立的 ACP 会话。
