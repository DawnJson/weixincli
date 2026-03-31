// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/weixin-acp/src/types.ts)
export type AcpAgentOptions = {
  /** 启动 ACP agent 的命令，例如 `npx`。 */
  command: string;
  /** 启动命令参数，例如 `["@zed-industries/codex-acp"]`。 */
  args?: string[];
  /** 首次使用该 agent 的会话时要显式恢复的 session id。 */
  startupResumeSessionId?: string;
  /** 传给子进程的额外环境变量。 */
  env?: Record<string, string>;
  /** 子进程和 ACP session 使用的工作目录。 */
  cwd?: string;
  /** Prompt 超时时间，单位毫秒，默认 `120_000`。 */
  promptTimeoutMs?: number;
  /** Session 存储命名空间，通常使用模型名。 */
  resumeStoreKey?: "claude" | "codex";
};
