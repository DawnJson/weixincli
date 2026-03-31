// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/auth/accounts.ts)
import fs from "node:fs";
import path from "node:path";

import { resolveStateDir } from "../storage/state-dir.js";
import { logger } from "../util/logger.js";

export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

/** 将账号 ID 规范化为适合文件系统使用的字符串。 */
export function normalizeAccountId(raw: string): string {
  return raw.trim().toLowerCase().replace(/[@.]/g, "-");
}


// ---------------------------------------------------------------------------
// 账号 ID 兼容逻辑（旧原始 ID -> 规范化 ID）
// ---------------------------------------------------------------------------

/**
 * 针对已知微信 ID 后缀，按规则反推 `normalizeAccountId` 之前的旧 ID。
 * 仅用于兼容加载旧 raw ID 形式保存的账号文件和 sync buf。
 * 例如：`b0f5860fdecb-im-bot` -> `b0f5860fdecb@im.bot`
 */
export function deriveRawAccountId(normalizedId: string): string | undefined {
  if (normalizedId.endsWith("-im-bot")) {
    return `${normalizedId.slice(0, -7)}@im.bot`;
  }
  if (normalizedId.endsWith("-im-wechat")) {
    return `${normalizedId.slice(0, -10)}@im.wechat`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 账号索引（持久化保存已登记账号列表）
// ---------------------------------------------------------------------------

function resolveWeixinStateDir(): string {
  return path.join(resolveStateDir(), "openclaw-weixin");
}

function resolveAccountIndexPath(): string {
  return path.join(resolveWeixinStateDir(), "accounts.json");
}

/** 返回所有通过扫码登录登记过的 accountId。 */
export function listIndexedWeixinAccountIds(): string[] {
  const filePath = resolveAccountIndexPath();
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.trim() !== "");
  } catch {
    return [];
  }
}

/** 把指定 accountId 记录为持久索引中的唯一账号。 */
export function registerWeixinAccountId(accountId: string): void {
  const dir = resolveWeixinStateDir();
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(resolveAccountIndexPath(), JSON.stringify([accountId], null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// 账号存储（每个账号一份凭据文件）
// ---------------------------------------------------------------------------

/** 单个账号统一存储的数据：在一个文件里保存 token 和 baseUrl。 */
export type WeixinAccountData = {
  token?: string;
  savedAt?: string;
  baseUrl?: string;
  /** 扫码登录后最后一次绑定的微信用户 ID（可选）。 */
  userId?: string;
};

function resolveAccountsDir(): string {
  return path.join(resolveWeixinStateDir(), "accounts");
}

function resolveAccountPath(accountId: string): string {
  return path.join(resolveAccountsDir(), `${accountId}.json`);
}

/**
 * 旧版单文件 token 存储位置：
 * `credentials/openclaw-weixin/credentials.json`
 * 这是引入“每账号一个文件”之前的兼容路径。
 */
function loadLegacyToken(): string | undefined {
  const legacyPath = path.join(resolveStateDir(), "credentials", "openclaw-weixin", "credentials.json");
  try {
    if (!fs.existsSync(legacyPath)) return undefined;
    const raw = fs.readFileSync(legacyPath, "utf-8");
    const parsed = JSON.parse(raw) as { token?: string };
    return typeof parsed.token === "string" ? parsed.token : undefined;
  } catch {
    return undefined;
  }
}

function readAccountFile(filePath: string): WeixinAccountData | null {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as WeixinAccountData;
    }
  } catch {
    // 忽略读取失败。
  }
  return null;
}

/** 按账号 ID 加载账号数据，并带有兼容回退逻辑。 */
export function loadWeixinAccount(accountId: string): WeixinAccountData | null {
  // 主路径：直接尝试当前规范化后的账号 ID。
  const primary = readAccountFile(resolveAccountPath(accountId));
  if (primary) return primary;

  // 兼容路径：如果传入的是规范化 ID，则回推旧 raw 文件名，
  // 以兼容历史安装中的旧文件命名方式。
  const rawId = deriveRawAccountId(accountId);
  if (rawId) {
    const compat = readAccountFile(resolveAccountPath(rawId));
    if (compat) return compat;
  }

  // 最后回退到旧版单账号凭据文件。
  const token = loadLegacyToken();
  if (token) return { token };

  return null;
}

/**
 * 扫码登录后持久化账号数据，并与现有文件合并。
 * - `token`：传入时直接覆盖
 * - `baseUrl`：非空时写入；读取时为空会回退到 `DEFAULT_BASE_URL`
 * - `userId`：传入时更新；若显式清空则不会写回文件
 */
export function saveWeixinAccount(
  accountId: string,
  update: { token?: string; baseUrl?: string; userId?: string },
): void {
  const dir = resolveAccountsDir();
  fs.mkdirSync(dir, { recursive: true });

  const existing = loadWeixinAccount(accountId) ?? {};

  const token = update.token?.trim() || existing.token;
  const baseUrl = update.baseUrl?.trim() || existing.baseUrl;
  const userId =
    update.userId !== undefined
      ? update.userId.trim() || undefined
      : existing.userId?.trim() || undefined;

  const data: WeixinAccountData = {
    ...(token ? { token, savedAt: new Date().toISOString() } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(userId ? { userId } : {}),
  };

  const filePath = resolveAccountPath(accountId);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // 尽力设置权限，失败时忽略。
  }
}

/** 删除账号数据文件。 */
export function clearWeixinAccount(accountId: string): void {
  try {
    fs.unlinkSync(resolveAccountPath(accountId));
  } catch {
    // 文件不存在时忽略。
  }
}

/** 删除所有账号数据文件，并清空账号索引。 */
export function clearAllWeixinAccounts(): void {
  const ids = listIndexedWeixinAccountIds();
  for (const id of ids) {
    clearWeixinAccount(id);
  }
  try {
    fs.writeFileSync(resolveAccountIndexPath(), "[]", "utf-8");
  } catch {
    // 忽略写入失败。
  }
}

/**
 * 解析 `openclaw.json` 配置文件路径。
 * 优先读取 `OPENCLAW_CONFIG`，否则回退到状态目录。
 */
function resolveConfigPath(): string {
  const envPath = process.env.OPENCLAW_CONFIG?.trim();
  if (envPath) return envPath;
  return path.join(resolveStateDir(), "openclaw.json");
}

/**
 * 从 `openclaw.json` 中读取 `routeTag`，供没有 `OpenClawConfig` 对象的调用方使用。
 * 会先查 `channels.<id>.accounts[accountId].routeTag`，再查节级别的
 * `channels.<id>.routeTag`。这里的行为与 `feat_weixin_extension` 保持一致，
 * channel key 固定为 `"openclaw-weixin"`。
 */
export function loadConfigRouteTag(accountId?: string): string | undefined {
  try {
    const configPath = resolveConfigPath();
    if (!fs.existsSync(configPath)) return undefined;
    const raw = fs.readFileSync(configPath, "utf-8");
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    const channels = cfg.channels as Record<string, unknown> | undefined;
    const section = channels?.["openclaw-weixin"] as Record<string, unknown> | undefined;
    if (!section) return undefined;
    if (accountId) {
      const accounts = section.accounts as Record<string, Record<string, unknown>> | undefined;
      const tag = accounts?.[accountId]?.routeTag;
      if (typeof tag === "number") return String(tag);
      if (typeof tag === "string" && tag.trim()) return tag.trim();
    }
    if (typeof section.routeTag === "number") return String(section.routeTag);
    return typeof section.routeTag === "string" && section.routeTag.trim()
      ? section.routeTag.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 空实现占位函数。
 * 当前配置重载由外部通过 `openclaw gateway restart` 处理。
 */
export async function triggerWeixinChannelReload(): Promise<void> {}

// ---------------------------------------------------------------------------
// 账号解析（合并配置与已保存凭据）
// ---------------------------------------------------------------------------

export type ResolvedWeixinAccount = {
  accountId: string;
  baseUrl: string;
  cdnBaseUrl: string;
  token?: string;
  enabled: boolean;
  /** 如果已通过扫码登录拿到 token，则为 `true`。 */
  configured: boolean;
};

/** 列出索引文件中的 accountId，也就是扫码登录时写入的账号列表。 */
export function listWeixinAccountIds(): string[] {
  return listIndexedWeixinAccountIds();
}

/** 按 ID 解析微信账号，并读取已保存凭据。 */
export function resolveWeixinAccount(accountId?: string | null): ResolvedWeixinAccount {
  const raw = accountId?.trim();
  if (!raw) {
    throw new Error("weixin: accountId is required (no default account)");
  }
  const id = normalizeAccountId(raw);

  const accountData = loadWeixinAccount(id);
  const token = accountData?.token?.trim() || undefined;
  const stateBaseUrl = accountData?.baseUrl?.trim() || "";

  return {
    accountId: id,
    baseUrl: stateBaseUrl || DEFAULT_BASE_URL,
    cdnBaseUrl: CDN_BASE_URL,
    token,
    enabled: true,
    configured: Boolean(token),
  };
}
