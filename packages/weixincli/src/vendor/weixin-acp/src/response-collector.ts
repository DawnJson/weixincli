// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/weixin-acp/src/response-collector.ts)
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { ChatResponse } from "../../weixin-agent-sdk/index.js";
import type { SessionNotification } from "@agentclientprotocol/sdk";

const ACP_MEDIA_OUT_DIR = "/tmp/weixin-agent/media/acp-out";

/**
 * 收集单次 prompt 往返过程中的 sessionUpdate 通知，
 * 并把累计结果转换为 ChatResponse。
 */
export class ResponseCollector {
  private textChunks: string[] = [];
  private imageData: { base64: string; mimeType: string } | null = null;

  /**
   * 把一条 sessionUpdate 通知喂给收集器。
   */
  handleUpdate(notification: SessionNotification): void {
    const update = notification.update;

    if (update.sessionUpdate === "agent_message_chunk") {
      const content = update.content;

      if (content.type === "text") {
        this.textChunks.push(content.text);
      } else if (content.type === "image") {
        this.imageData = {
          base64: content.data,
          mimeType: content.mimeType,
        };
      }
    }
  }

  /**
   * 用所有已收集的分片构建 ChatResponse。
   */
  async toResponse(): Promise<ChatResponse> {
    const response: ChatResponse = {};

    const text = this.textChunks.join("");
    if (text) {
      response.text = text;
    }

    if (this.imageData) {
      await fs.mkdir(ACP_MEDIA_OUT_DIR, { recursive: true });
      const ext = this.imageData.mimeType.split("/")[1] ?? "png";
      const filename = `${crypto.randomUUID()}.${ext}`;
      const filePath = path.join(ACP_MEDIA_OUT_DIR, filename);
      await fs.writeFile(filePath, Buffer.from(this.imageData.base64, "base64"));
      response.media = { type: "image", url: filePath };
    }

    return response;
  }
}
