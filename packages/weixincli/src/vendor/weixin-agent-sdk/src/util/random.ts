// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/util/random.ts)
import crypto from "node:crypto";

/**
 * 使用时间戳和随机字节生成一个带前缀的唯一 ID。
 * 格式：`{prefix}:{timestamp}-{8-char hex}`
 */
export function generateId(prefix: string): string {
  return `${prefix}:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * 生成带随机后缀的临时文件名。
 * 格式：`{prefix}-{timestamp}-{8-char hex}{ext}`
 */
export function tempFileName(prefix: string, ext: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
}
