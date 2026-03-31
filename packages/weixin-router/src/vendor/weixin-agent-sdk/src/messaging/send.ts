// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/messaging/send.ts)
import { sendMessage as sendMessageApi } from "../api/api.js";
import type { WeixinApiOptions } from "../api/api.js";
import { logger } from "../util/logger.js";
import { generateId } from "../util/random.js";
import type { MessageItem, SendMessageReq } from "../api/types.js";
import { MessageItemType, MessageState, MessageType } from "../api/types.js";
import type { UploadedFileInfo } from "../cdn/upload.js";

export function generateClientId(): string {
  return generateId("openclaw-weixin");
}

/**
 * 把 markdown 格式的模型回复转换成适合微信发送的纯文本。
 * 会保留换行，但去掉 markdown 语法。
 */
export function markdownToPlainText(text: string): string {
  let result = text;
  // 代码块：去掉 fence，只保留代码内容。
  result = result.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code: string) => code.trim());
  // 图片：整体删除。
  result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  // 链接：只保留展示文本。
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // 表格：去掉分隔行，再去掉首尾竖线，并把中间竖线转为空格。
  result = result.replace(/^\|[\s:|-]+\|$/gm, "");
  result = result.replace(/^\|(.+)\|$/gm, (_, inner: string) =>
    inner.split("|").map((cell) => cell.trim()).join("  "),
  );
  // 去掉行内 markdown 样式。
  result = result
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1");
  return result.trim();
}


/** 构建只包含一条文本消息的 SendMessageReq。 */
function buildTextMessageReq(params: {
  to: string;
  text: string;
  contextToken?: string;
  clientId: string;
}): SendMessageReq {
  const { to, text, contextToken, clientId } = params;
  const item_list: MessageItem[] = text
    ? [{ type: MessageItemType.TEXT, text_item: { text } }]
    : [];
  return {
    msg: {
      from_user_id: "",
      to_user_id: to,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: item_list.length ? item_list : undefined,
      context_token: contextToken ?? undefined,
    },
  };
}

/** 根据文本内容构建 SendMessageReq。 */
function buildSendMessageReq(params: {
  to: string;
  contextToken?: string;
  text: string;
  clientId: string;
}): SendMessageReq {
  const { to, contextToken, text, clientId } = params;
  return buildTextMessageReq({ to, text, contextToken, clientId });
}

/**
 * 向下游发送纯文本消息。
 * 所有回复消息都必须带 `contextToken`，否则无法正确关联会话。
 */
export async function sendMessageWeixin(params: {
  to: string;
  text: string;
  opts: WeixinApiOptions & { contextToken?: string };
}): Promise<{ messageId: string }> {
  const { to, text, opts } = params;
  if (!opts.contextToken) {
    logger.error(`sendMessageWeixin: contextToken missing, refusing to send to=${to}`);
    throw new Error("sendMessageWeixin: contextToken is required");
  }
  const clientId = generateClientId();
  const req = buildSendMessageReq({
    to,
    contextToken: opts.contextToken,
    text,
    clientId,
  });
  try {
    await sendMessageApi({
      baseUrl: opts.baseUrl,
      token: opts.token,
      timeoutMs: opts.timeoutMs,
      body: req,
    });
  } catch (err) {
    logger.error(`sendMessageWeixin: failed to=${to} clientId=${clientId} err=${String(err)}`);
    throw err;
  }
  return { messageId: clientId };
}

/**
 * 向下游发送一个或多个 MessageItem，也可以在前面附带一段文本说明。
 * 每个 item 都会单独发送一次请求，确保 `item_list` 始终只有一个元素。
 */
async function sendMediaItems(params: {
  to: string;
  text: string;
  mediaItem: MessageItem;
  opts: WeixinApiOptions & { contextToken?: string };
  label: string;
}): Promise<{ messageId: string }> {
  const { to, text, mediaItem, opts, label } = params;

  const items: MessageItem[] = [];
  if (text) {
    items.push({ type: MessageItemType.TEXT, text_item: { text } });
  }
  items.push(mediaItem);

  let lastClientId = "";
  for (const item of items) {
    lastClientId = generateClientId();
    const req: SendMessageReq = {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: lastClientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [item],
        context_token: opts.contextToken ?? undefined,
      },
    };
    try {
      await sendMessageApi({
        baseUrl: opts.baseUrl,
        token: opts.token,
        timeoutMs: opts.timeoutMs,
        body: req,
      });
    } catch (err) {
      logger.error(
        `${label}: failed to=${to} clientId=${lastClientId} err=${String(err)}`,
      );
      throw err;
    }
  }

  logger.debug(`${label}: success to=${to} clientId=${lastClientId}`);
  return { messageId: lastClientId };
}

/**
 * 使用已上传文件向下游发送图片消息。
 * 如有需要，可先发送一条独立的 TEXT 作为图片说明。
 *
 * `ImageItem` 主要字段：
 *   - `media.encrypt_query_param`：CDN 下载参数
 *   - `media.aes_key`：base64 编码后的 AES key
 *   - `mid_size`：原始密文文件大小
 */
export async function sendImageMessageWeixin(params: {
  to: string;
  text: string;
  uploaded: UploadedFileInfo;
  opts: WeixinApiOptions & { contextToken?: string };
}): Promise<{ messageId: string }> {
  const { to, text, uploaded, opts } = params;
  if (!opts.contextToken) {
    logger.error(`sendImageMessageWeixin: contextToken missing, refusing to send to=${to}`);
    throw new Error("sendImageMessageWeixin: contextToken is required");
  }
  logger.debug(
    `sendImageMessageWeixin: to=${to} filekey=${uploaded.filekey} fileSize=${uploaded.fileSize} aeskey=present`,
  );

  const imageItem: MessageItem = {
    type: MessageItemType.IMAGE,
    image_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(uploaded.aeskey).toString("base64"),
        encrypt_type: 1,
      },
      mid_size: uploaded.fileSizeCiphertext,
    },
  };

  return sendMediaItems({ to, text, mediaItem: imageItem, opts, label: "sendImageMessageWeixin" });
}

/**
 * 使用已上传文件向下游发送视频消息。
 * `VideoItem` 包含 `media`（CDN 引用）和 `video_size`（密文字节数）。
 * 也支持先发一条独立 TEXT 作为说明。
 */
export async function sendVideoMessageWeixin(params: {
  to: string;
  text: string;
  uploaded: UploadedFileInfo;
  opts: WeixinApiOptions & { contextToken?: string };
}): Promise<{ messageId: string }> {
  const { to, text, uploaded, opts } = params;
  if (!opts.contextToken) {
    logger.error(`sendVideoMessageWeixin: contextToken missing, refusing to send to=${to}`);
    throw new Error("sendVideoMessageWeixin: contextToken is required");
  }

  const videoItem: MessageItem = {
    type: MessageItemType.VIDEO,
    video_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(uploaded.aeskey).toString("base64"),
        encrypt_type: 1,
      },
      video_size: uploaded.fileSizeCiphertext,
    },
  };

  return sendMediaItems({ to, text, mediaItem: videoItem, opts, label: "sendVideoMessageWeixin" });
}

/**
 * 使用已上传文件向下游发送文件附件。
 * `FileItem` 包含 `media`（CDN 引用）、`file_name`、`len`（明文字节数的字符串形式）。
 * 也支持先发一条独立 TEXT 作为说明。
 */
export async function sendFileMessageWeixin(params: {
  to: string;
  text: string;
  fileName: string;
  uploaded: UploadedFileInfo;
  opts: WeixinApiOptions & { contextToken?: string };
}): Promise<{ messageId: string }> {
  const { to, text, fileName, uploaded, opts } = params;
  if (!opts.contextToken) {
    logger.error(`sendFileMessageWeixin: contextToken missing, refusing to send to=${to}`);
    throw new Error("sendFileMessageWeixin: contextToken is required");
  }
  const fileItem: MessageItem = {
    type: MessageItemType.FILE,
    file_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(uploaded.aeskey).toString("base64"),
        encrypt_type: 1,
      },
      file_name: fileName,
      len: String(uploaded.fileSize),
    },
  };

  return sendMediaItems({ to, text, mediaItem: fileItem, opts, label: "sendFileMessageWeixin" });
}
