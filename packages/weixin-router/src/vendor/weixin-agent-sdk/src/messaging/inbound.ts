// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/messaging/inbound.ts)
import { logger } from "../util/logger.js";
import { generateId } from "../util/random.js";
import type { WeixinMessage, MessageItem } from "../api/types.js";
import { MessageItemType } from "../api/types.js";

// ---------------------------------------------------------------------------
// Context token 存储（进程内缓存：accountId+userId -> contextToken）
// ---------------------------------------------------------------------------

/**
 * `contextToken` 由微信 `getupdates` API 按消息下发，
 * 每次出站回复都必须原样带回去。
 * 该值不会持久化；监控循环会在每条入站消息到来时写入这里，
 * 出站适配器在 agent 回复时再从这里读回。
 */
const contextTokenStore = new Map<string, string>();

function contextTokenKey(accountId: string, userId: string): string {
  return `${accountId}:${userId}`;
}

/** 为指定账号和用户对保存一个 context token。 */
export function setContextToken(accountId: string, userId: string, token: string): void {
  const k = contextTokenKey(accountId, userId);
  logger.debug(`setContextToken: key=${k}`);
  contextTokenStore.set(k, token);
}

/** 读取指定账号和用户对缓存下来的 context token。 */
export function getContextToken(accountId: string, userId: string): string | undefined {
  const k = contextTokenKey(accountId, userId);
  const val = contextTokenStore.get(k);
  logger.debug(
    `getContextToken: key=${k} found=${val !== undefined} storeSize=${contextTokenStore.size}`,
  );
  return val;
}

// ---------------------------------------------------------------------------
// 消息 ID 生成
// ---------------------------------------------------------------------------

function generateMessageSid(): string {
  return generateId("openclaw-weixin");
}

/** 传入 OpenClaw 核心流水线的入站上下文，结构与 `MsgContext` 对齐。 */
export type WeixinMsgContext = {
  Body: string;
  From: string;
  To: string;
  AccountId: string;
  OriginatingChannel: "openclaw-weixin";
  OriginatingTo: string;
  MessageSid: string;
  Timestamp?: number;
  Provider: "openclaw-weixin";
  ChatType: "direct";
  /** monitor 在 resolveAgentRoute 后写入，确保 dispatchReplyFromConfig 用到正确 session。 */
  SessionKey?: string;
  context_token?: string;
  MediaUrl?: string;
  MediaPath?: string;
  MediaType?: string;
  /** 用于框架命令鉴权的原始消息体。 */
  CommandBody?: string;
  /** 发送方是否有权限执行 slash 命令。 */
  CommandAuthorized?: boolean;
};

/** 如果消息项属于媒体类型（图片、视频、文件、语音）则返回 true。 */
export function isMediaItem(item: MessageItem): boolean {
  return (
    item.type === MessageItemType.IMAGE ||
    item.type === MessageItemType.VIDEO ||
    item.type === MessageItemType.FILE ||
    item.type === MessageItemType.VOICE
  );
}

export function bodyFromItemList(itemList?: MessageItem[]): string {
  if (!itemList?.length) return "";
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      const text = String(item.text_item.text);
      const ref = item.ref_msg;
      if (!ref) return text;
      // 被引用的媒体会通过 MediaPath 传递，这里正文只保留当前文本。
      if (ref.message_item && isMediaItem(ref.message_item)) return text;
      // 通过 title 和 message_item 一起拼出引用上下文。
      const parts: string[] = [];
      if (ref.title) parts.push(ref.title);
      if (ref.message_item) {
        const refBody = bodyFromItemList([ref.message_item]);
        if (refBody) parts.push(refBody);
      }
      if (!parts.length) return text;
      return `[引用: ${parts.join(" | ")}]\n${text}`;
    }
    // 语音转文字：如果语音消息有 text 字段，直接使用文字内容
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}

export type WeixinInboundMediaOpts = {
  /** 解密后图片文件的本地路径。 */
  decryptedPicPath?: string;
  /** 转码后或原始语音文件的本地路径（`.wav` 或 `.silk`）。 */
  decryptedVoicePath?: string;
  /** 语音文件的 MIME 类型，例如 `audio/wav` 或 `audio/silk`。 */
  voiceMediaType?: string;
  /** 解密后文件附件的本地路径。 */
  decryptedFilePath?: string;
  /** 文件附件的 MIME 类型，通常由 `file_name` 推断。 */
  fileMediaType?: string;
  /** 解密后视频文件的本地路径。 */
  decryptedVideoPath?: string;
};

/**
 * 把 `getUpdates` 拿到的 WeixinMessage 转成核心流水线需要的入站 MsgContext。
 * 媒体只传 `MediaPath`，也就是 CDN 下载并解密后的本地文件。
 * 不会传 `MediaUrl`，因为上游 CDN URL 通常是加密且仅认证后可访问的。
 * 多种媒体同时存在时，优先级为：image > video > file > voice。
 */
export function weixinMessageToMsgContext(
  msg: WeixinMessage,
  accountId: string,
  opts?: WeixinInboundMediaOpts,
): WeixinMsgContext {
  const from_user_id = msg.from_user_id ?? "";
  const ctx: WeixinMsgContext = {
    Body: bodyFromItemList(msg.item_list),
    From: from_user_id,
    To: from_user_id,
    AccountId: accountId,
    OriginatingChannel: "openclaw-weixin",
    OriginatingTo: from_user_id,
    MessageSid: generateMessageSid(),
    Timestamp: msg.create_time_ms,
    Provider: "openclaw-weixin",
    ChatType: "direct",
  };
  if (msg.context_token) {
    ctx.context_token = msg.context_token;
  }

  if (opts?.decryptedPicPath) {
    ctx.MediaPath = opts.decryptedPicPath;
    ctx.MediaType = "image/*";
  } else if (opts?.decryptedVideoPath) {
    ctx.MediaPath = opts.decryptedVideoPath;
    ctx.MediaType = "video/mp4";
  } else if (opts?.decryptedFilePath) {
    ctx.MediaPath = opts.decryptedFilePath;
    ctx.MediaType = opts.fileMediaType ?? "application/octet-stream";
  } else if (opts?.decryptedVoicePath) {
    ctx.MediaPath = opts.decryptedVoicePath;
    ctx.MediaType = opts.voiceMediaType ?? "audio/wav";
  }

  return ctx;
}

/** 从入站 WeixinMsgContext 中取出 `context_token`。 */
export function getContextTokenFromMsgContext(ctx: WeixinMsgContext): string | undefined {
  return ctx.context_token;
}
