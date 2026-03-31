// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/util/logger.ts)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 插件日志器，会把 JSON Lines 写入 OpenClaw 主日志文件：
 *   /tmp/openclaw/openclaw-YYYY-MM-DD.log
 * 与其他 channel 使用同一个文件和格式。
 */

const MAIN_LOG_DIR = path.join("/tmp", "openclaw");
const SUBSYSTEM = "gateway/channels/openclaw-weixin";
const RUNTIME = "node";
const RUNTIME_VERSION = process.versions.node;
const HOSTNAME = os.hostname() || "unknown";
const PARENT_NAMES = ["openclaw"];

/** 兼容 tslog 的级别 ID，数值越大表示级别越严重。 */
const LEVEL_IDS: Record<string, number> = {
  TRACE: 1,
  DEBUG: 2,
  INFO: 3,
  WARN: 4,
  ERROR: 5,
  FATAL: 6,
};

const DEFAULT_LOG_LEVEL = "INFO";

function resolveMinLevel(): number {
  const env = process.env.OPENCLAW_LOG_LEVEL?.toUpperCase();
  if (env && env in LEVEL_IDS) return LEVEL_IDS[env];
  return LEVEL_IDS[DEFAULT_LOG_LEVEL];
}

let minLevelId = resolveMinLevel();

/** 在运行时动态修改最小日志级别。 */
export function setLogLevel(level: string): void {
  const upper = level.toUpperCase();
  if (!(upper in LEVEL_IDS)) {
    throw new Error(`Invalid log level: ${level}. Valid levels: ${Object.keys(LEVEL_IDS).join(", ")}`);
  }
  minLevelId = LEVEL_IDS[upper];
}

/** 把 Date 平移到本地时区，确保 `toISOString()` 输出本地时钟数字。 */
function toLocalISO(now: Date): string {
  const offsetMs = -now.getTimezoneOffset() * 60_000;
  const sign = offsetMs >= 0 ? "+" : "-";
  const abs = Math.abs(now.getTimezoneOffset());
  const offStr = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return new Date(now.getTime() + offsetMs).toISOString().replace("Z", offStr);
}

function localDateKey(now: Date): string {
  return toLocalISO(now).slice(0, 10);
}

function resolveMainLogPath(): string {
  const dateKey = localDateKey(new Date());
  return path.join(MAIN_LOG_DIR, `openclaw-${dateKey}.log`);
}

let logDirEnsured = false;

export type Logger = {
  info(message: string): void;
  debug(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** 返回一个子 logger，输出时会自动带上 `[accountId]` 前缀。 */
  withAccount(accountId: string): Logger;
  /** 返回当前主日志文件路径。 */
  getLogFilePath(): string;
  close(): void;
};

function buildLoggerName(accountId?: string): string {
  return accountId ? `${SUBSYSTEM}/${accountId}` : SUBSYSTEM;
}

function writeLog(level: string, message: string, accountId?: string): void {
  const levelId = LEVEL_IDS[level] ?? LEVEL_IDS.INFO;
  if (levelId < minLevelId) return;

  const now = new Date();
  const loggerName = buildLoggerName(accountId);
  const prefixedMessage = accountId ? `[${accountId}] ${message}` : message;
  const entry = JSON.stringify({
    "0": loggerName,
    "1": prefixedMessage,
    _meta: {
      runtime: RUNTIME,
      runtimeVersion: RUNTIME_VERSION,
      hostname: HOSTNAME,
      name: loggerName,
      parentNames: PARENT_NAMES,
      date: now.toISOString(),
      logLevelId: LEVEL_IDS[level] ?? LEVEL_IDS.INFO,
      logLevelName: level,
    },
    time: toLocalISO(now),
  });
  try {
    if (!logDirEnsured) {
      fs.mkdirSync(MAIN_LOG_DIR, { recursive: true });
      logDirEnsured = true;
    }
    fs.appendFileSync(resolveMainLogPath(), `${entry}\n`, "utf-8");
  } catch {
    // 尽力写日志，不让日志失败阻塞主流程。
  }
}

/** 创建一个 logger 实例，也可以绑定到指定账号。 */
function createLogger(accountId?: string): Logger {
  return {
    info(message: string): void {
      writeLog("INFO", message, accountId);
    },
    debug(message: string): void {
      writeLog("DEBUG", message, accountId);
    },
    warn(message: string): void {
      writeLog("WARN", message, accountId);
    },
    error(message: string): void {
      writeLog("ERROR", message, accountId);
    },
    withAccount(id: string): Logger {
      return createLogger(id);
    },
    getLogFilePath(): string {
      return resolveMainLogPath();
    },
    close(): void {
      // 空实现：appendFileSync 没有需要关闭的持久句柄。
    },
  };
}

export const logger: Logger = createLogger();
