// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/api/config-cache.ts)
import { getConfig } from "./api.js";

/** 当前真正会用到的 getConfig 字段子集；后续需要时可继续补充。 */
export interface CachedConfig {
  typingTicket: string;
}

const CONFIG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CONFIG_CACHE_INITIAL_RETRY_MS = 2_000;
const CONFIG_CACHE_MAX_RETRY_MS = 60 * 60 * 1000;

interface ConfigCacheEntry {
  config: CachedConfig;
  everSucceeded: boolean;
  nextFetchAt: number;
  retryDelayMs: number;
}

/**
 * 按用户维度缓存 getConfig 结果。
 * 成功后会在 24 小时内随机时间点刷新；失败时按指数退避重试，最长退避到 1 小时。
 */
export class WeixinConfigManager {
  private cache = new Map<string, ConfigCacheEntry>();

  constructor(
    private apiOpts: { baseUrl: string; token?: string },
    private log: (msg: string) => void,
  ) {}

  async getForUser(userId: string, contextToken?: string): Promise<CachedConfig> {
    const now = Date.now();
    const entry = this.cache.get(userId);
    const shouldFetch = !entry || now >= entry.nextFetchAt;

    if (shouldFetch) {
      let fetchOk = false;
      try {
        const resp = await getConfig({
          baseUrl: this.apiOpts.baseUrl,
          token: this.apiOpts.token,
          ilinkUserId: userId,
          contextToken,
        });
        if (resp.ret === 0) {
          this.cache.set(userId, {
            config: { typingTicket: resp.typing_ticket ?? "" },
            everSucceeded: true,
            nextFetchAt: now + Math.random() * CONFIG_CACHE_TTL_MS,
            retryDelayMs: CONFIG_CACHE_INITIAL_RETRY_MS,
          });
          this.log(
            `[weixin] config ${entry?.everSucceeded ? "refreshed" : "cached"} for ${userId}`,
          );
          fetchOk = true;
        }
      } catch (err) {
        this.log(`[weixin] getConfig failed for ${userId} (ignored): ${String(err)}`);
      }
      if (!fetchOk) {
        const prevDelay = entry?.retryDelayMs ?? CONFIG_CACHE_INITIAL_RETRY_MS;
        const nextDelay = Math.min(prevDelay * 2, CONFIG_CACHE_MAX_RETRY_MS);
        if (entry) {
          entry.nextFetchAt = now + nextDelay;
          entry.retryDelayMs = nextDelay;
        } else {
          this.cache.set(userId, {
            config: { typingTicket: "" },
            everSucceeded: false,
            nextFetchAt: now + CONFIG_CACHE_INITIAL_RETRY_MS,
            retryDelayMs: CONFIG_CACHE_INITIAL_RETRY_MS,
          });
        }
      }
    }

    return this.cache.get(userId)?.config ?? { typingTicket: "" };
  }
}
