// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/messaging/process-message.ts)
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { Agent, ChatRequest } from "../agent/interface.js";
import { sendTyping } from "../api/api.js";
import type { WeixinMessage, MessageItem } from "../api/types.js";
import { MessageItemType, TypingStatus } from "../api/types.js";
import { downloadRemoteImageToTemp } from "../cdn/upload.js";
import { downloadMediaFromItem } from "../media/media-download.js";
import { getExtensionFromMime } from "../media/mime.js";
import { logger } from "../util/logger.js";

import { setContextToken, bodyFromItemList, isMediaItem } from "./inbound.js";
import { sendWeixinErrorNotice } from "./error-notice.js";
import { sendWeixinMediaFile } from "./send-media.js";
import { markdownToPlainText, sendMessageWeixin } from "./send.js";
import { handleSlashCommand } from "./slash-commands.js";

const MEDIA_TEMP_DIR = "/tmp/weixin-agent/media";

/** 把 Buffer 保存为临时文件，并返回文件路径。 */
async function saveMediaBuffer(
  buffer: Buffer,
  contentType?: string,
  subdir?: string,
  _maxBytes?: number,
  originalFilename?: string,
): Promise<{ path: string }> {
  const dir = path.join(MEDIA_TEMP_DIR, subdir ?? "");
  await fs.mkdir(dir, { recursive: true });
  let ext = ".bin";
  if (originalFilename) {
    ext = path.extname(originalFilename) || ".bin";
  } else if (contentType) {
    ext = getExtensionFromMime(contentType);
  }
  const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, buffer);
  return { path: filePath };
}

/** `processOneMessage` 所需依赖。 */
export type ProcessMessageDeps = {
  accountId: string;
  agent: Agent;
  baseUrl: string;
  cdnBaseUrl: string;
  token?: string;
  typingTicket?: string;
  log: (msg: string) => void;
  errLog: (msg: string) => void;
};

/** 从 `item_list` 中提取原始文本，用于识别 slash 命令。 */
function extractTextBody(itemList?: MessageItem[]): string {
  if (!itemList?.length) return "";
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      return String(item.text_item.text);
    }
  }
  return "";
}

/** 在消息中找到第一个可下载的媒体项。 */
function findMediaItem(itemList?: MessageItem[]): MessageItem | undefined {
  if (!itemList?.length) return undefined;

  const hasDownloadableMedia = (m?: { encrypt_query_param?: string; full_url?: string }) =>
    m?.encrypt_query_param || m?.full_url;

  // 直接媒体优先级：IMAGE > VIDEO > FILE > VOICE（带转写文本的语音会跳过）
  const direct =
    itemList.find(
      (i) => i.type === MessageItemType.IMAGE && hasDownloadableMedia(i.image_item?.media),
    ) ??
    itemList.find(
      (i) => i.type === MessageItemType.VIDEO && hasDownloadableMedia(i.video_item?.media),
    ) ??
    itemList.find(
      (i) => i.type === MessageItemType.FILE && hasDownloadableMedia(i.file_item?.media),
    ) ??
    itemList.find(
      (i) =>
        i.type === MessageItemType.VOICE &&
        hasDownloadableMedia(i.voice_item?.media) &&
        !i.voice_item?.text,
    );
  if (direct) return direct;

  // 引用媒体：从 ref_msg 中检查。
  const refItem = itemList.find(
    (i) =>
      i.type === MessageItemType.TEXT &&
      i.ref_msg?.message_item &&
      isMediaItem(i.ref_msg.message_item),
  );
  return refItem?.ref_msg?.message_item ?? undefined;
}

/**
 * 处理一条入站消息：
 *   识别 slash 命令 -> 下载媒体 -> 调用 agent -> 发送回复。
 */
export async function processOneMessage(
  full: WeixinMessage,
  deps: ProcessMessageDeps,
): Promise<void> {
  const receivedAt = Date.now();
  const textBody = extractTextBody(full.item_list);

  // --- Slash 命令 ---
  if (textBody.startsWith("/")) {
    const conversationId = full.from_user_id ?? "";
    const slashResult = await handleSlashCommand(
      textBody,
      {
        to: conversationId,
        contextToken: full.context_token,
        baseUrl: deps.baseUrl,
        token: deps.token,
        accountId: deps.accountId,
        log: deps.log,
        errLog: deps.errLog,
      },
      receivedAt,
      full.create_time_ms,
    );
    if (slashResult.handled) return;
  }

  // --- 保存 context token ---
  const contextToken = full.context_token;
  if (contextToken) {
    setContextToken(deps.accountId, full.from_user_id ?? "", contextToken);
  }

  // --- 下载媒体 ---
  let media: ChatRequest["media"];
  const mediaItem = findMediaItem(full.item_list);
  if (mediaItem) {
    try {
      const downloaded = await downloadMediaFromItem(mediaItem, {
        cdnBaseUrl: deps.cdnBaseUrl,
        saveMedia: saveMediaBuffer,
        log: deps.log,
        errLog: deps.errLog,
        label: "inbound",
      });
      if (downloaded.decryptedPicPath) {
        media = { type: "image", filePath: downloaded.decryptedPicPath, mimeType: "image/*" };
      } else if (downloaded.decryptedVideoPath) {
        media = { type: "video", filePath: downloaded.decryptedVideoPath, mimeType: "video/mp4" };
      } else if (downloaded.decryptedFilePath) {
        media = {
          type: "file",
          filePath: downloaded.decryptedFilePath,
          mimeType: downloaded.fileMediaType ?? "application/octet-stream",
        };
      } else if (downloaded.decryptedVoicePath) {
        media = {
          type: "audio",
          filePath: downloaded.decryptedVoicePath,
          mimeType: downloaded.voiceMediaType ?? "audio/wav",
        };
      }
    } catch (err) {
      logger.error(`media download failed: ${String(err)}`);
    }
  }

  // --- 构建 ChatRequest ---
  const request: ChatRequest = {
    conversationId: full.from_user_id ?? "",
    permissionContext: {
      baseUrl: deps.baseUrl,
      contextToken,
      token: deps.token,
      to: full.from_user_id ?? "",
    },
    text: bodyFromItemList(full.item_list),
    media,
  };

  // --- “正在输入”状态（启动并定时刷新） ---
  const to = full.from_user_id ?? "";
  let typingTimer: ReturnType<typeof setInterval> | undefined;
  const startTyping = () => {
    if (!deps.typingTicket) return;
    sendTyping({
      baseUrl: deps.baseUrl,
      token: deps.token,
      body: {
        ilink_user_id: to,
        typing_ticket: deps.typingTicket,
        status: TypingStatus.TYPING,
      },
    }).catch(() => {});
  };
  if (deps.typingTicket) {
    startTyping();
    typingTimer = setInterval(startTyping, 10_000);
  }

  // --- 调用 agent 并发送回复 ---
  try {
    const response = await deps.agent.chat(request);

    if (response.media) {
      let filePath: string;
      const mediaUrl = response.media.url;
      if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) {
        filePath = await downloadRemoteImageToTemp(
          mediaUrl,
          path.join(MEDIA_TEMP_DIR, "outbound"),
        );
      } else {
        filePath = path.isAbsolute(mediaUrl) ? mediaUrl : path.resolve(mediaUrl);
      }
      await sendWeixinMediaFile({
        filePath,
        to,
        text: response.text ? markdownToPlainText(response.text) : "",
        opts: { baseUrl: deps.baseUrl, token: deps.token, contextToken },
        cdnBaseUrl: deps.cdnBaseUrl,
      });
    } else if (response.text) {
      await sendMessageWeixin({
        to,
        text: markdownToPlainText(response.text),
        opts: { baseUrl: deps.baseUrl, token: deps.token, contextToken },
      });
    }
  } catch (err) {
    logger.error(`processOneMessage: agent or send failed: ${err instanceof Error ? err.stack ?? err.message : JSON.stringify(err)}`);
    void sendWeixinErrorNotice({
      to,
      contextToken,
      message: `⚠️ 处理消息失败：${err instanceof Error ? err.message : JSON.stringify(err)}`,
      baseUrl: deps.baseUrl,
      token: deps.token,
      errLog: deps.errLog,
    });
  } finally {
    // --- 取消“正在输入”状态 ---
    if (typingTimer) clearInterval(typingTimer);
    if (deps.typingTicket) {
      sendTyping({
        baseUrl: deps.baseUrl,
        token: deps.token,
        body: {
          ilink_user_id: to,
          typing_ticket: deps.typingTicket,
          status: TypingStatus.CANCEL,
        },
      }).catch(() => {});
    }
  }
}
