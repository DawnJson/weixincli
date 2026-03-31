// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/messaging/debug-mode.ts)
/**
 * 每个 bot 独立维护的 debug mode 开关，会落盘保存，因此网关重启后仍然生效。
 *
 * 状态文件：`<stateDir>/openclaw-weixin/debug-mode.json`
 * 文件格式：`{ "accounts": { "<accountId>": true, ... } }`
 *
 * 开启后，`processOneMessage` 会在每次 AI 回复发给用户后附加耗时摘要。
 */
import fs from "node:fs";
import path from "node:path";

import { resolveStateDir } from "../storage/state-dir.js";
import { logger } from "../util/logger.js";

interface DebugModeState {
  accounts: Record<string, boolean>;
}

function resolveDebugModePath(): string {
  return path.join(resolveStateDir(), "openclaw-weixin", "debug-mode.json");
}

function loadState(): DebugModeState {
  try {
    const raw = fs.readFileSync(resolveDebugModePath(), "utf-8");
    const parsed = JSON.parse(raw) as DebugModeState;
    if (parsed && typeof parsed.accounts === "object") return parsed;
  } catch {
    // 文件不存在或损坏时，按空状态重新开始。
  }
  return { accounts: {} };
}

function saveState(state: DebugModeState): void {
  const filePath = resolveDebugModePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

/** 切换指定 bot 账号的 debug mode，并返回切换后的状态。 */
export function toggleDebugMode(accountId: string): boolean {
  const state = loadState();
  const next = !state.accounts[accountId];
  state.accounts[accountId] = next;
  try {
    saveState(state);
  } catch (err) {
    logger.error(`debug-mode: failed to persist state: ${String(err)}`);
  }
  return next;
}

/** 检查指定 bot 账号当前是否开启了 debug mode。 */
export function isDebugMode(accountId: string): boolean {
  return loadState().accounts[accountId] === true;
}

/**
 * 重置内部状态，仅供测试使用。
 * @internal
 */
export function _resetForTest(): void {
  try {
    fs.unlinkSync(resolveDebugModePath());
  } catch {
    // 文件不存在时忽略。
  }
}
