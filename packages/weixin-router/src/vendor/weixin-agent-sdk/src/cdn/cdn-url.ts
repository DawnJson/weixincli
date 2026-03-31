// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/cdn/cdn-url.ts)
/**
 * 统一构建微信 CDN 上传和下载 URL。
 */

/** 根据 `encrypt_query_param` 构建 CDN 下载 URL。 */
export function buildCdnDownloadUrl(encryptedQueryParam: string, cdnBaseUrl: string): string {
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}

/** 根据 `upload_param` 和 `filekey` 构建 CDN 上传 URL。 */
export function buildCdnUploadUrl(params: {
  cdnBaseUrl: string;
  uploadParam: string;
  filekey: string;
}): string {
  return `${params.cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(params.uploadParam)}&filekey=${encodeURIComponent(params.filekey)}`;
}
