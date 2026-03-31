// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/storage/state-dir.ts)
import os from "node:os";
import path from "node:path";

/** 解析 OpenClaw 的状态目录，行为与核心 `src/infra` 逻辑保持一致。 */
export function resolveStateDir(): string {
  return (
    process.env.OPENCLAW_STATE_DIR?.trim() ||
    process.env.CLAWDBOT_STATE_DIR?.trim() ||
    path.join(os.homedir(), ".openclaw")
  );
}
