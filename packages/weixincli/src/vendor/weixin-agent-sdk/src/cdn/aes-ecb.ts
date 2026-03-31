// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/cdn/aes-ecb.ts)
/**
 * CDN 上传和下载共用的 AES-128-ECB 加解密工具。
 */
import { createCipheriv, createDecipheriv } from "node:crypto";

/** 使用 AES-128-ECB 加密 Buffer（默认启用 PKCS7 padding）。 */
export function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

/** 使用 AES-128-ECB 解密 Buffer（PKCS7 padding）。 */
export function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** 计算 AES-128-ECB 密文大小（PKCS7 padding 对齐到 16 字节边界）。 */
export function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}
