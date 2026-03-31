// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/storage/sync-buf.ts)
import fs from "node:fs";
import path from "node:path";

import { deriveRawAccountId } from "../auth/accounts.js";

import { resolveStateDir } from "./state-dir.js";

function resolveAccountsDir(): string {
  return path.join(resolveStateDir(), "openclaw-weixin", "accounts");
}

/**
 * 返回某个账号对应的持久化 `get_updates_buf` 文件路径。
 * 与账号数据文件放在一起：
 * `~/.openclaw/openclaw-weixin/accounts/{accountId}.sync.json`
 */
export function getSyncBufFilePath(accountId: string): string {
  return path.join(resolveAccountsDir(), `${accountId}.sync.json`);
}

/** 旧版单账号 syncbuf 路径（多账号支持之前）：`.openclaw-weixin-sync/default.json`。 */
function getLegacySyncBufDefaultJsonPath(): string {
  return path.join(
    resolveStateDir(),
    "agents",
    "default",
    "sessions",
    ".openclaw-weixin-sync",
    "default.json",
  );
}

export type SyncBufData = {
  get_updates_buf: string;
};

function readSyncBufFile(filePath: string): string | undefined {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as { get_updates_buf?: string };
    if (typeof data.get_updates_buf === "string") {
      return data.get_updates_buf;
    }
  } catch {
    // 文件不存在或内容非法时忽略。
  }
  return undefined;
}

/**
 * 读取持久化的 `get_updates_buf`。
 * 回退顺序如下：
 *   1. 主路径（规范化 accountId，新安装使用）
 *   2. 兼容路径（由规则推导出的 raw accountId，兼容旧安装）
 *   3. 旧版单账号路径（更早期、未支持多账号的安装）
 */
export function loadGetUpdatesBuf(filePath: string): string | undefined {
  const value = readSyncBufFile(filePath);
  if (value !== undefined) return value;

  // 兼容逻辑：如果当前路径使用的是规范化 accountId，
  // 则再尝试一次旧 raw-ID 文件名。
  const accountId = path.basename(filePath, ".sync.json");
  const rawId = deriveRawAccountId(accountId);
  if (rawId) {
    const compatPath = path.join(resolveAccountsDir(), `${rawId}.sync.json`);
    const compatValue = readSyncBufFile(compatPath);
    if (compatValue !== undefined) return compatValue;
  }

  // 旧版回退：更早的单账号安装不会把 accountId 带进 syncbuf 文件名。
  return readSyncBufFile(getLegacySyncBufDefaultJsonPath());
}

/**
 * 持久化 `get_updates_buf`，必要时自动创建父目录。
 */
export function saveGetUpdatesBuf(filePath: string, getUpdatesBuf: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ get_updates_buf: getUpdatesBuf }, null, 0), "utf-8");
}
