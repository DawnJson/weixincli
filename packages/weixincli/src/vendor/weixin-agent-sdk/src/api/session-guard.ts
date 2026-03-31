// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/api/session-guard.ts)
import { logger } from "../util/logger.js";

const SESSION_PAUSE_DURATION_MS = 60 * 60 * 1000;

/** 服务端在 bot session 过期时返回的错误码。 */
export const SESSION_EXPIRED_ERRCODE = -14;

const pauseUntilMap = new Map<string, number>();

/** 将 `accountId` 的所有入站/出站 API 调用暂停一小时。 */
export function pauseSession(accountId: string): void {
  const until = Date.now() + SESSION_PAUSE_DURATION_MS;
  pauseUntilMap.set(accountId, until);
  logger.info(
    `session-guard: paused accountId=${accountId} until=${new Date(until).toISOString()} (${SESSION_PAUSE_DURATION_MS / 1000}s)`,
  );
}

/** 如果 bot 仍处在一小时冷却窗口内，则返回 `true`。 */
export function isSessionPaused(accountId: string): boolean {
  const until = pauseUntilMap.get(accountId);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    pauseUntilMap.delete(accountId);
    return false;
  }
  return true;
}

/** 返回距离暂停结束还剩多少毫秒；未暂停时返回 `0`。 */
export function getRemainingPauseMs(accountId: string): number {
  const until = pauseUntilMap.get(accountId);
  if (until === undefined) return 0;
  const remaining = until - Date.now();
  if (remaining <= 0) {
    pauseUntilMap.delete(accountId);
    return 0;
  }
  return remaining;
}

/** 如果当前 session 仍被暂停则直接抛错；应在每次 API 请求前调用。 */
export function assertSessionActive(accountId: string): void {
  if (isSessionPaused(accountId)) {
    const remainingMin = Math.ceil(getRemainingPauseMs(accountId) / 60_000);
    throw new Error(
      `session paused for accountId=${accountId}, ${remainingMin} min remaining (errcode ${SESSION_EXPIRED_ERRCODE})`,
    );
  }
}

/**
 * 重置内部状态，仅供测试使用。
 * @internal
 */
export function _resetForTest(): void {
  pauseUntilMap.clear();
}
