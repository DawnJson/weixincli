// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/messaging/error-notice.ts)
import { logger } from "../util/logger.js";
import { sendMessageWeixin } from "./send.js";

/**
 * 向用户回发一条纯文本错误通知。
 * 该函数采用 fire-and-forget 方式：错误只记日志，不向上抛出，避免影响调用方。
 * 如果没有 `contextToken`，则不会执行任何操作，因为此时无法正确回复到原会话。
 */
export async function sendWeixinErrorNotice(params: {
  to: string;
  contextToken: string | undefined;
  message: string;
  baseUrl: string;
  token?: string;
  errLog: (m: string) => void;
}): Promise<void> {
  if (!params.contextToken) {
    logger.warn(`sendWeixinErrorNotice: no contextToken for to=${params.to}, cannot notify user`);
    return;
  }
  try {
    await sendMessageWeixin({ to: params.to, text: params.message, opts: {
      baseUrl: params.baseUrl,
      token: params.token,
      contextToken: params.contextToken,
    }});
    logger.debug(`sendWeixinErrorNotice: sent to=${params.to}`);
  } catch (err) {
    params.errLog(`[weixin] sendWeixinErrorNotice failed to=${params.to}: ${String(err)}`);
  }
}
