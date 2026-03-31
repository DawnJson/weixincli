// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/auth/pairing.ts)
import fs from "node:fs";
import path from "node:path";

import { resolveStateDir } from "../storage/state-dir.js";
import { logger } from "../util/logger.js";

/**
 * 解析框架层的凭据目录，行为与核心的 `resolveOAuthDir` 保持一致。
 * 路径优先级：
 * `$OPENCLAW_OAUTH_DIR` || `$OPENCLAW_STATE_DIR/credentials` || `~/.openclaw/credentials`
 */
function resolveCredentialsDir(): string {
  const override = process.env.OPENCLAW_OAUTH_DIR?.trim();
  if (override) return override;
  return path.join(resolveStateDir(), "credentials");
}

/**
 * 清洗 channel/account key，确保文件名可安全使用，行为与核心 `safeChannelKey` 保持一致。
 */
function safeKey(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) throw new Error("invalid key for allowFrom path");
  const safe = trimmed.replace(/[\\/:*?"<>|]/g, "_").replace(/\.\./g, "_");
  if (!safe || safe === "_") throw new Error("invalid key for allowFrom path");
  return safe;
}

/**
 * 解析指定账号的框架层 `allowFrom` 文件路径。
 * 行为与核心的 `resolveAllowFromPath(channel, env, accountId)` 保持一致。
 * 最终路径形如：`<credDir>/openclaw-weixin-<accountId>-allowFrom.json`
 */
export function resolveFrameworkAllowFromPath(accountId: string): string {
  const base = safeKey("openclaw-weixin");
  const safeAccount = safeKey(accountId);
  return path.join(resolveCredentialsDir(), `${base}-${safeAccount}-allowFrom.json`);
}

type AllowFromFileContent = {
  version: number;
  allowFrom: string[];
};

/**
 * 读取某个账号的框架层 `allowFrom` 列表，也就是经由配对授权的用户 ID。
 * 文件不存在或不可读时返回空数组。
 */
export function readFrameworkAllowFromList(accountId: string): string[] {
  const filePath = resolveFrameworkAllowFromPath(accountId);
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as AllowFromFileContent;
    if (Array.isArray(parsed.allowFrom)) {
      return parsed.allowFrom.filter((id): id is string => typeof id === "string" && id.trim() !== "");
    }
  } catch {
    // 尽力读取，失败时忽略。
  }
  return [];
}

/**
 * 把一个用户 ID 注册到当前 channel 的 allowFrom 存储里。
 */
export function registerUserInAllowFromStore(params: {
  accountId: string;
  userId: string;
}): { changed: boolean } {
  const { accountId, userId } = params;
  const trimmedUserId = userId.trim();
  if (!trimmedUserId) return { changed: false };

  const filePath = resolveFrameworkAllowFromPath(accountId);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  let content: AllowFromFileContent = { version: 1, allowFrom: [] };
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as AllowFromFileContent;
      if (Array.isArray(parsed.allowFrom)) {
        content = parsed;
      }
    }
  } catch {
    // 读取失败时按空数据重新开始。
  }

  if (content.allowFrom.includes(trimmedUserId)) {
    return { changed: false };
  }

  content.allowFrom.push(trimmedUserId);
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), "utf-8");
  logger.info(
    `registerUserInAllowFromStore: added userId=${trimmedUserId} accountId=${accountId} path=${filePath}`,
  );
  return { changed: true };
}
