// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/api/api.ts)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigRouteTag } from "../auth/accounts.js";
import { logger } from "../util/logger.js";
import { redactBody, redactUrl } from "../util/redact.js";

import type {
  BaseInfo,
  GetUploadUrlReq,
  GetUploadUrlResp,
  GetUpdatesReq,
  GetUpdatesResp,
  SendMessageReq,
  SendTypingReq,
  GetConfigResp,
} from "./types.js";

export type WeixinApiOptions = {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  /** `getUpdates` 的长轮询超时时间，服务端可能会一直持有到该时长。 */
  longPollTimeoutMs?: number;
};

// ---------------------------------------------------------------------------
// BaseInfo：附加到每个出站 CGI 请求上的公共字段
// ---------------------------------------------------------------------------

function readChannelVersion(): string {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(dir, "..", "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

const CHANNEL_VERSION = readChannelVersion();

/** 构建每个 API 请求都会携带的 `base_info`。 */
export function buildBaseInfo(): BaseInfo {
  return { channel_version: CHANNEL_VERSION };
}

/** `getUpdates` 长轮询请求的默认超时时间。 */
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
/** 普通 API 请求（如 `sendMessage`、`getUploadUrl`）的默认超时时间。 */
const DEFAULT_API_TIMEOUT_MS = 15_000;
/** 轻量 API 请求（如 `getConfig`、`sendTyping`）的默认超时时间。 */
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000;

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** 生成 `X-WECHAT-UIN` 请求头：随机 uint32 -> 十进制字符串 -> base64。 */
function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

/** 构建 GET 和 POST 共用的请求头。 */
function buildCommonHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const routeTag = loadConfigRouteTag();
  if (routeTag) {
    headers.SKRouteTag = routeTag;
  }
  return headers;
}

function buildHeaders(opts: { token?: string; body: string }): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "Content-Length": String(Buffer.byteLength(opts.body, "utf-8")),
    "X-WECHAT-UIN": randomWechatUin(),
    ...buildCommonHeaders(),
  };
  if (opts.token?.trim()) {
    headers.Authorization = `Bearer ${opts.token.trim()}`;
  }
  logger.debug(
    `requestHeaders: ${JSON.stringify({ ...headers, Authorization: headers.Authorization ? "Bearer ***" : undefined })}`,
  );
  return headers;
}

/**
 * GET 请求封装：向微信 API 端点发起 GET 请求，并处理超时与 abort。
 * 查询参数需要事先编码进 `endpoint`。
 * 成功时返回原始响应文本；发生 HTTP 错误或超时时抛出异常。
 */
export async function apiGetFetch(params: {
  baseUrl: string;
  endpoint: string;
  timeoutMs: number;
  label: string;
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl);
  const url = new URL(params.endpoint, base);
  const hdrs = buildCommonHeaders();
  logger.debug(`GET ${redactUrl(url.toString())}`);

  const controller = new AbortController();
  let timedOut = false;
  const t = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, params.timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: hdrs,
      signal: controller.signal,
    });
    clearTimeout(t);
    const rawText = await res.text();
    logger.debug(`${params.label} status=${res.status} raw=${redactBody(rawText)}`);
    if (!res.ok) {
      throw new Error(`${params.label} ${res.status}: ${rawText}`);
    }
    return rawText;
  } catch (err) {
    clearTimeout(t);
    if (timedOut && err instanceof Error && err.name === "AbortError") {
      throw new Error(`${params.label} request timed out after ${params.timeoutMs}ms`);
    }
    throw err;
  }
}

/**
 * 通用请求封装：向微信 API 端点发送 JSON POST，并处理超时与 abort。
 * 成功时返回原始响应文本；发生 HTTP 错误或超时时抛出异常。
 */
async function apiFetch(params: {
  baseUrl: string;
  endpoint: string;
  body: string;
  token?: string;
  timeoutMs: number;
  label: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl);
  const url = new URL(params.endpoint, base);
  const hdrs = buildHeaders({ token: params.token, body: params.body });
  logger.debug(`POST ${redactUrl(url.toString())} body=${redactBody(params.body)}`);

  const controller = new AbortController();
  let timedOut = false;
  const t = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, params.timeoutMs);

  // 把外部 abort 信号透传给内部 controller。
  const onAbort = () => controller.abort();
  params.abortSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: hdrs,
      body: params.body,
      signal: controller.signal,
    });
    clearTimeout(t);
    const rawText = await res.text();
    logger.debug(`${params.label} status=${res.status} raw=${redactBody(rawText)}`);
    if (!res.ok) {
      throw new Error(`${params.label} ${res.status}: ${rawText}`);
    }
    return rawText;
  } catch (err) {
    clearTimeout(t);
    if (timedOut && err instanceof Error && err.name === "AbortError") {
      throw new Error(`${params.label} request timed out after ${params.timeoutMs}ms`);
    }
    if (params.abortSignal?.aborted && err instanceof Error && err.name === "AbortError") {
      throw new Error(`${params.label} request was aborted by caller`);
    }
    throw err;
  } finally {
    params.abortSignal?.removeEventListener("abort", onAbort);
  }
}

/**
 * 长轮询 `getUpdates`。
 * 正常情况下服务端会一直持有请求，直到有新消息或达到超时时间。
 *
 * 如果发生客户端超时（`timeoutMs` 内没有服务端响应），会返回一个 `ret=0` 的空响应，
 * 这样调用方可以直接重试。这是长轮询中的正常行为。
 */
export async function getUpdates(
  params: GetUpdatesReq & {
    baseUrl: string;
    token?: string;
    timeoutMs?: number;
    abortSignal?: AbortSignal;
  },
): Promise<GetUpdatesResp> {
  const timeout = params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
  try {
    const rawText = await apiFetch({
      baseUrl: params.baseUrl,
      endpoint: "ilink/bot/getupdates",
      body: JSON.stringify({
        get_updates_buf: params.get_updates_buf ?? "",
        base_info: buildBaseInfo(),
      }),
      token: params.token,
      timeoutMs: timeout,
      label: "getUpdates",
      abortSignal: params.abortSignal,
    });
    const resp: GetUpdatesResp = JSON.parse(rawText);
    return resp;
  } catch (err) {
    // 长轮询超时属于正常情况，返回空响应让调用方继续重试。
    if (
      err instanceof Error &&
      (err.name === "AbortError" || err.message.includes("timed out after"))
    ) {
      logger.debug(`getUpdates: client-side timeout after ${timeout}ms, returning empty response`);
      return { ret: 0, msgs: [], get_updates_buf: params.get_updates_buf };
    }
    throw err;
  }
}

/** 为文件获取预签名的 CDN 上传地址。 */
export async function getUploadUrl(
  params: GetUploadUrlReq & WeixinApiOptions,
): Promise<GetUploadUrlResp> {
  const rawText = await apiFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/getuploadurl",
    body: JSON.stringify({
      filekey: params.filekey,
      media_type: params.media_type,
      to_user_id: params.to_user_id,
      rawsize: params.rawsize,
      rawfilemd5: params.rawfilemd5,
      filesize: params.filesize,
      thumb_rawsize: params.thumb_rawsize,
      thumb_rawfilemd5: params.thumb_rawfilemd5,
      thumb_filesize: params.thumb_filesize,
      no_need_thumb: params.no_need_thumb,
      aeskey: params.aeskey,
      base_info: buildBaseInfo(),
    }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    label: "getUploadUrl",
  });
  const resp: GetUploadUrlResp = JSON.parse(rawText);
  return resp;
}

/** 向下游发送一条消息。 */
export async function sendMessage(
  params: WeixinApiOptions & { body: SendMessageReq },
): Promise<void> {
  await apiFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify({ ...params.body, base_info: buildBaseInfo() }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    label: "sendMessage",
  });
}

/** 获取指定用户的 bot 配置，其中包含 `typing_ticket`。 */
export async function getConfig(
  params: WeixinApiOptions & { ilinkUserId: string; contextToken?: string },
): Promise<GetConfigResp> {
  const rawText = await apiFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/getconfig",
    body: JSON.stringify({
      ilink_user_id: params.ilinkUserId,
      context_token: params.contextToken,
      base_info: buildBaseInfo(),
    }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
    label: "getConfig",
  });
  const resp: GetConfigResp = JSON.parse(rawText);
  return resp;
}

/** 向用户发送“正在输入”状态。 */
export async function sendTyping(
  params: WeixinApiOptions & { body: SendTypingReq },
): Promise<void> {
  await apiFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/sendtyping",
    body: JSON.stringify({ ...params.body, base_info: buildBaseInfo() }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
    label: "sendTyping",
  });
}
