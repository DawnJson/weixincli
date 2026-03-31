// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/messaging/slash-commands.ts)
import type { WeixinApiOptions } from "../api/api.js";
import { logger } from "../util/logger.js";

import { sendMessageWeixin } from "./send.js";

export interface SlashCommandResult {
  handled: boolean;
}

export interface SlashCommandContext {
  to: string;
  contextToken?: string;
  baseUrl: string;
  token?: string;
  accountId: string;
  log: (msg: string) => void;
  errLog: (msg: string) => void;
}

async function sendReply(ctx: SlashCommandContext, text: string): Promise<void> {
  const opts: WeixinApiOptions & { contextToken?: string } = {
    baseUrl: ctx.baseUrl,
    token: ctx.token,
    contextToken: ctx.contextToken,
  };
  await sendMessageWeixin({ to: ctx.to, text, opts });
}

function getHelpText(): string {
  return [
    "weixin-router 命令",
    "",
    "模型切换",
    "- /codex：把当前聊天切到 Codex",
    "- /codex <message>：切到 Codex 并立即发送这条消息",
    "- /claude：把当前聊天切到 Claude",
    "- /claude <message>：切到 Claude 并立即发送这条消息",
    "",
    "工作目录",
    "- /cd <path>：修改当前聊天的工作目录",
    "- /pwd：查看当前聊天的工作目录",
    "",
    "会话管理",
    "- /sessions：查看当前模型最近 5 个会话",
    "- /sessions codex：查看 Codex 最近 5 个会话",
    "- /sessions claude：查看 Claude 最近 5 个会话",
    "",
    "规划模式",
    "- /plan：让当前模型进入规划模式",
    "- /do：执行当前聊天里待确认的计划",
    "- /undo：丢弃当前聊天里待确认的计划",
    "- /unplan：让当前模型退出规划模式并回到默认模式",
    "- /resume latest：恢复当前模型最近一次会话",
    "- /resume <sessionId>：恢复当前模型的指定会话",
    "- /resume codex <sessionId>：恢复一个 Codex 会话并切到 Codex",
    "- /resume claude <sessionId>：恢复一个 Claude 会话并切到 Claude",
    "",
    "帮助",
    "- /help：查看这份帮助信息",
  ].join("\n");
}

export async function handleSlashCommand(
  content: string,
  ctx: SlashCommandContext,
  _receivedAt: number,
  _eventTimestamp?: number,
): Promise<SlashCommandResult> {
  const trimmed = content.trim();
  if (!trimmed.startsWith("/")) {
    return { handled: false };
  }

  const spaceIdx = trimmed.indexOf(" ");
  const command = spaceIdx === -1 ? trimmed.toLowerCase() : trimmed.slice(0, spaceIdx).toLowerCase();
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);

  logger.info(`[weixin] Slash command: ${command}, args: ${args.slice(0, 50)}`);

  try {
    switch (command) {
      case "/help":
        await sendReply(ctx, getHelpText());
        return { handled: true };
      default:
        return { handled: false };
    }
  } catch (err) {
    logger.error(`[weixin] Slash command error: ${String(err)}`);
    try {
      await sendReply(ctx, `命令执行失败：${String(err).slice(0, 200)}`);
    } catch {
      // 忽略后续回消息失败。
    }
    return { handled: true };
  }
}
