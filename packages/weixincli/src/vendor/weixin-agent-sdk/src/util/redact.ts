// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/util/redact.ts)
const DEFAULT_BODY_MAX_LEN = 200;
const DEFAULT_TOKEN_PREFIX_LEN = 6;

/**
 * 截断字符串，并在被裁剪时追加长度标记。
 * 如果输入为空或未定义，则返回 `""`。
 */
export function truncate(s: string | undefined, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…(len=${s.length})`;
}

/**
 * 脱敏 token 或密钥：只展示前几个字符和总长度。
 * 不存在时返回 `"(none)"`。
 */
export function redactToken(token: string | undefined, prefixLen = DEFAULT_TOKEN_PREFIX_LEN): string {
  if (!token) return "(none)";
  if (token.length <= prefixLen) return `****(len=${token.length})`;
  return `${token.slice(0, prefixLen)}…(len=${token.length})`;
}

/**
 * 把 JSON body 截断到 `maxLen` 个字符，便于安全写日志。
 * 会附加原始长度，方便判断截掉了多少内容。
 */
export function redactBody(body: string | undefined, maxLen = DEFAULT_BODY_MAX_LEN): string {
  if (!body) return "(empty)";
  if (body.length <= maxLen) return body;
  return `${body.slice(0, maxLen)}…(truncated, totalLen=${body.length})`;
}

/**
 * 从 URL 中去掉查询参数（通常包含签名或 token），
 * 只保留 `origin + pathname`。
 */
export function redactUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const base = `${u.origin}${u.pathname}`;
    return u.search ? `${base}?<redacted>` : base;
  } catch {
    return truncate(rawUrl, 80);
  }
}
