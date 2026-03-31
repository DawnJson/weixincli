// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/bot.ts)
import type { Agent } from "./agent/interface.js";
import {
  clearAllWeixinAccounts,
  DEFAULT_BASE_URL,
  listWeixinAccountIds,
  loadWeixinAccount,
  normalizeAccountId,
  registerWeixinAccountId,
  resolveWeixinAccount,
  saveWeixinAccount,
} from "./auth/accounts.js";
import {
  DEFAULT_ILINK_BOT_TYPE,
  startWeixinLoginWithQr,
  waitForWeixinLogin,
} from "./auth/login-qr.js";
import { monitorWeixinProvider } from "./monitor/monitor.js";
import { logger } from "./util/logger.js";

export type LoginOptions = {
  /** 覆盖默认 API 基础地址。 */
  baseUrl?: string;
  /** 日志回调，默认使用 `console.log`。 */
  log?: (msg: string) => void;
};

export type StartOptions = {
  /** 要使用的账号 ID；为空时自动选择第一个已登记账号。 */
  accountId?: string;
  /** 用于停止 bot 的 AbortSignal。 */
  abortSignal?: AbortSignal;
  /** 日志回调，默认使用 `console.log`。 */
  log?: (msg: string) => void;
};

/**
 * 交互式扫码登录。
 * 会在终端打印二维码，并等待用户使用微信扫码。
 *
 * 成功时返回规范化后的账号 ID。
 */
export async function login(opts?: LoginOptions): Promise<string> {
  const log = opts?.log ?? console.log;
  const apiBaseUrl = opts?.baseUrl ?? DEFAULT_BASE_URL;

  log("正在启动微信扫码登录...");

  const startResult = await startWeixinLoginWithQr({
    apiBaseUrl,
    botType: DEFAULT_ILINK_BOT_TYPE,
  });

  if (!startResult.qrcodeUrl) {
    throw new Error(startResult.message);
  }

  log("\n使用微信扫描以下二维码，以完成连接：\n");
  try {
    const qrcodeterminal = await import("qrcode-terminal");
    await new Promise<void>((resolve) => {
      qrcodeterminal.default.generate(startResult.qrcodeUrl!, { small: true }, (qr: string) => {
        console.log(qr);
        resolve();
      });
    });
  } catch {
    log(`二维码链接: ${startResult.qrcodeUrl}`);
  }

  log("\n等待扫码...\n");

  const waitResult = await waitForWeixinLogin({
    sessionKey: startResult.sessionKey,
    apiBaseUrl,
    timeoutMs: 480_000,
    botType: DEFAULT_ILINK_BOT_TYPE,
  });

  if (!waitResult.connected || !waitResult.botToken || !waitResult.accountId) {
    throw new Error(waitResult.message);
  }

  const normalizedId = normalizeAccountId(waitResult.accountId);
  saveWeixinAccount(normalizedId, {
    token: waitResult.botToken,
    baseUrl: waitResult.baseUrl,
    userId: waitResult.userId,
  });
  registerWeixinAccountId(normalizedId);

  log("\n✅ 与微信连接成功！");
  return normalizedId;
}

/**
 * 移除所有已保存的微信账号凭据。
 */
export function logout(opts?: { log?: (msg: string) => void }): void {
  const log = opts?.log ?? console.log;
  const ids = listWeixinAccountIds();
  if (ids.length === 0) {
    log("当前没有已登录的账号");
    return;
  }
  clearAllWeixinAccounts();
  log("✅ 已退出登录");
}

/**
 * 检查是否至少有一个微信账号已经登录并完成配置。
 */
export function isLoggedIn(): boolean {
  const ids = listWeixinAccountIds();
  if (ids.length === 0) return false;
  const account = resolveWeixinAccount(ids[0]);
  return account.configured;
}

/**
 * 启动 bot。
 * 该函数会持续长轮询新消息并分发给 agent，直到收到 abort 信号或出现不可恢复错误。
 */
export async function start(agent: Agent, opts?: StartOptions): Promise<void> {
  const log = opts?.log ?? console.log;

  // 解析要使用的账号。
  let accountId = opts?.accountId;
  if (!accountId) {
    const ids = listWeixinAccountIds();
    if (ids.length === 0) {
      throw new Error("没有已登录的账号，请先运行 login");
    }
    accountId = ids[0];
    if (ids.length > 1) {
      log(`[weixin] 检测到多个账号，使用第一个: ${accountId}`);
    }
  }

  const account = resolveWeixinAccount(accountId);
  if (!account.configured) {
    throw new Error(
      `账号 ${accountId} 未配置 (缺少 token)，请先运行 login`,
    );
  }

  log(`[weixin] 启动 bot, account=${account.accountId}`);

  await monitorWeixinProvider({
    baseUrl: account.baseUrl,
    cdnBaseUrl: account.cdnBaseUrl,
    token: account.token,
    accountId: account.accountId,
    agent,
    abortSignal: opts?.abortSignal,
    log,
  });
}
