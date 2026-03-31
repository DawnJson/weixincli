// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/weixin-acp/src/content-converter.ts)
import fs from "node:fs/promises";

import type { ChatRequest } from "../../weixin-agent-sdk/index.js";
import type { ContentBlock } from "@agentclientprotocol/sdk";

/**
 * 把 ChatRequest 转成 ACP 所需的 ContentBlock[]。
 */
export async function convertRequestToContentBlocks(
  request: ChatRequest,
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];

  if (request.text) {
    blocks.push({ type: "text", text: request.text });
  }

  if (request.media) {
    const data = await fs.readFile(request.media.filePath);
    const base64 = data.toString("base64");
    const mimeType = request.media.mimeType;

    switch (request.media.type) {
      case "image":
        blocks.push({ type: "image", data: base64, mimeType });
        break;
      case "audio":
        blocks.push({ type: "audio", data: base64, mimeType });
        break;
      case "video":
      case "file": {
        const uri = `file://${request.media.filePath}`;
        blocks.push({
          type: "resource",
          resource: { uri, blob: base64, mimeType },
        });
        break;
      }
    }
  }

  return blocks;
}
