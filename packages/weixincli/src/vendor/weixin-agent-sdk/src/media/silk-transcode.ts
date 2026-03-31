// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/media/silk-transcode.ts)
import { logger } from "../util/logger.js";

/** 微信语音消息默认采样率。 */
const SILK_SAMPLE_RATE = 24_000;

/**
 * 把原始 `pcm_s16le` 字节封装到 WAV 容器中。
 * 使用单声道、16 位有符号小端格式。
 */
function pcmBytesToWav(pcm: Uint8Array, sampleRate: number): Buffer {
  const pcmBytes = pcm.byteLength;
  const totalSize = 44 + pcmBytes;
  const buf = Buffer.allocUnsafe(totalSize);
  let offset = 0;

  buf.write("RIFF", offset);
  offset += 4;
  buf.writeUInt32LE(totalSize - 8, offset);
  offset += 4;
  buf.write("WAVE", offset);
  offset += 4;

  buf.write("fmt ", offset);
  offset += 4;
  buf.writeUInt32LE(16, offset);
  offset += 4; // fmt chunk size
  buf.writeUInt16LE(1, offset);
  offset += 2; // PCM format
  buf.writeUInt16LE(1, offset);
  offset += 2; // mono
  buf.writeUInt32LE(sampleRate, offset);
  offset += 4;
  buf.writeUInt32LE(sampleRate * 2, offset);
  offset += 4; // byte rate (mono 16-bit)
  buf.writeUInt16LE(2, offset);
  offset += 2; // block align
  buf.writeUInt16LE(16, offset);
  offset += 2; // bits per sample

  buf.write("data", offset);
  offset += 4;
  buf.writeUInt32LE(pcmBytes, offset);
  offset += 4;

  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buf, offset);

  return buf;
}

/**
 * 尝试使用 `silk-wasm` 把 SILK 音频缓冲区转成 WAV。
 * `silk-wasm` 的 `decode()` 会返回 `{ data: Uint8Array (pcm_s16le), duration: number }`。
 *
 * 成功时返回 WAV Buffer；如果 `silk-wasm` 不可用或解码失败，则返回 `null`。
 * 调用方在拿到 `null` 时应回退到直接传递原始 SILK 文件。
 */
export async function silkToWav(silkBuf: Buffer): Promise<Buffer | null> {
  try {
    const { decode } = await import("silk-wasm");

    logger.debug(`silkToWav: decoding ${silkBuf.length} bytes of SILK`);
    const result = await decode(silkBuf, SILK_SAMPLE_RATE);
    logger.debug(
      `silkToWav: decoded duration=${result.duration}ms pcmBytes=${result.data.byteLength}`,
    );

    const wav = pcmBytesToWav(result.data, SILK_SAMPLE_RATE);
    logger.debug(`silkToWav: WAV size=${wav.length}`);
    return wav;
  } catch (err) {
    logger.warn(`silkToWav: transcode failed, will use raw silk err=${String(err)}`);
    return null;
  }
}
