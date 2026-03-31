// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/cdn/pic-decrypt.ts)
import { decryptAesEcb } from "./aes-ecb.js";
import { buildCdnDownloadUrl } from "./cdn-url.js";
import { logger } from "../util/logger.js";

/**
 * 从 CDN 下载原始字节，不做解密。
 */
async function fetchCdnBytes(url: string, label: string): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    const cause =
      (err as NodeJS.ErrnoException).cause ?? (err as NodeJS.ErrnoException).code ?? "(no cause)";
    logger.error(
      `${label}: fetch network error url=${url} err=${String(err)} cause=${String(cause)}`,
    );
    throw err;
  }
  logger.debug(`${label}: response status=${res.status} ok=${res.ok}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    const msg = `${label}: CDN download ${res.status} ${res.statusText} body=${body}`;
    logger.error(msg);
    throw new Error(msg);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * 把 `CDNMedia.aes_key` 解析成原始 16 字节 AES key。
 *
 * 线上常见两种编码方式：
 *   - `base64(raw 16 bytes)`：图片（来自 `media` 字段的 `aes_key`）
 *   - `base64(hex string of 16 bytes)`：文件 / 语音 / 视频
 *
 * 第二种情况下，base64 解码后会得到 32 个 ASCII 十六进制字符，
 * 需要再按 hex 解析，才能还原成真正的 16 字节 key。
 */
function parseAesKey(aesKeyBase64: string, label: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, "base64");
  if (decoded.length === 16) {
    return decoded;
  }
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    // 十六进制编码的 key：base64 -> 十六进制字符串 -> 原始字节。
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  const msg = `${label}: aes_key must decode to 16 raw bytes or 32-char hex string, got ${decoded.length} bytes (base64="${aesKeyBase64}")`;
  logger.error(msg);
  throw new Error(msg);
}

/**
 * 下载并用 AES-128-ECB 解密 CDN 媒体文件，返回明文 Buffer。
 * `aesKeyBase64` 对应 `CDNMedia.aes_key` 的 JSON 字段，支持格式见 `parseAesKey`。
 */
export async function downloadAndDecryptBuffer(
  encryptedQueryParam: string,
  aesKeyBase64: string,
  cdnBaseUrl: string,
  label: string,
  fullUrl?: string,
): Promise<Buffer> {
  const key = parseAesKey(aesKeyBase64, label);
  const url = fullUrl || buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl);
  logger.debug(`${label}: fetching url=${url}`);
  const encrypted = await fetchCdnBytes(url, label);
  logger.debug(`${label}: downloaded ${encrypted.byteLength} bytes, decrypting`);
  const decrypted = decryptAesEcb(encrypted, key);
  logger.debug(`${label}: decrypted ${decrypted.length} bytes`);
  return decrypted;
}

/**
 * 从 CDN 下载明文字节（不加密），返回原始 Buffer。
 */
export async function downloadPlainCdnBuffer(
  encryptedQueryParam: string,
  cdnBaseUrl: string,
  label: string,
  fullUrl?: string,
): Promise<Buffer> {
  const url = fullUrl || buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl);
  logger.debug(`${label}: fetching url=${url}`);
  return fetchCdnBytes(url, label);
}
