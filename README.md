# weixincli

仓库地址：`https://github.com/DawnJson/weixincli`
问题反馈：`https://github.com/DawnJson/weixincli/issues`

基于 `wong2/weixin-agent-sdk` 构建的微信路由工作区。

## 包结构

```text
packages/
  weixincli/   对外发布的 weixincli CLI 源码
```

原来的 `packages/sdk` 和 `packages/weixin-acp` 代码已经内置到 `packages/weixincli/src/vendor`，因此当前项目不再依赖这些本地工作区包。

## weixincli

`weixincli` 会启动一个微信 Bot 进程，并接入两个 ACP 后端：

- `codex` -> `codex-acp`
- `claude` -> `claude-agent-acp`

按你希望的默认模型启动：

```bash
npx weixincli codex
npx weixincli codex resume <sessionId>
npx weixincli claude
npx weixincli claude resume <sessionId>
```

在微信里可用的命令：

```text
/help
/codex
/codex Fix the failing code path
/claude
/claude Review this change
/cd ..
/cd E:\PostGraduateFile\code\repo
/pwd
/sessions
/sessions codex
/sessions claude
/plan
/do
/undo
/unplan
/resume latest
/resume 8ffd4196-fcdb-47fa-bb31-aebd35c6e435
/resume codex 8ffd4196-fcdb-47fa-bb31-aebd35c6e435
/resume claude latest
```

行为说明：

- `/help`：查看当前微信侧支持的命令。
- 普通消息会发送到该微信会话当前绑定的模型。
- 启动命令会决定一个会话首次使用前的默认路由。
- `/codex` 和 `/claude`：持久切换当前微信会话所使用的模型。
- `/codex <message>` 和 `/claude <message>`：先切模型，再立即转发消息。
- `/cd <path>`：修改当前微信会话的工作目录。
- `/pwd`：查看当前微信会话的工作目录。
- `/sessions`：查看当前模型最近 5 个会话。
- `/sessions codex` 和 `/sessions claude`：查看指定模型最近 5 个会话，但不切换当前聊天路由。
- `/plan`：让当前模型进入规划模式。Claude 使用原生 ACP plan mode；Codex 使用软规划流程，先返回计划再等待确认。
- `/do`：执行当前聊天里待确认的计划。
- `/undo`：丢弃当前聊天里待确认的计划。
- `/unplan`：把当前模型切回 `default` 模式。
- 当聊天处于 `plan` 模式时，计划会先回发到微信，再等待 `/do` 或 `/undo`。
- `/resume latest`：显式恢复当前工作目录下该模型最近一次会话。
- `/resume <sessionId>`：显式恢复当前模型的指定会话 ID。
- `/resume codex <sessionId>` 和 `/resume claude <sessionId>`：恢复指定模型会话，并把当前聊天切到该模型。
- `/resume codex latest` 和 `/resume claude latest`：恢复指定模型在当前工作目录下最近一次会话，并切换当前聊天。
- Codex 和 Claude 会分别为每个微信会话维护各自独立的 ACP 会话。
- 使用 `npx weixincli codex resume <sessionId>` 或 `npx weixincli claude resume <sessionId>` 启动时，会在默认模型首次被使用时恢复指定会话。

## 开发

```bash
corepack pnpm install
corepack pnpm --filter weixincli typecheck
corepack pnpm --filter weixincli test
```
