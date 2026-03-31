// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/weixin-acp/src/acp-connection.ts)
import type { ChildProcess } from "node:child_process";
import spawn from "cross-spawn";
import { Readable, Writable } from "node:stream";

import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";
import type {
  AgentCapabilities,
  InitializeResponse,
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionId,
  SessionInfo,
} from "@agentclientprotocol/sdk";

import type { AcpAgentOptions } from "./types.js";
import { ResponseCollector } from "./response-collector.js";
import { sendMessageWeixin } from "../../weixin-agent-sdk/src/messaging/send.js";

function log(msg: string) {
  console.log(`[acp] ${msg}`);
}

const THINKING_LOG_FLUSH_THRESHOLD = 120;
const THINKING_LOG_BOUNDARY_CHARS = ".!?;:\u3002\uFF01\uFF1F\uFF1B\uFF1A";

type PermissionContext = {
  baseUrl: string;
  contextToken?: string;
  token?: string;
  to: string;
};

type PendingPermission = {
  params: RequestPermissionRequest;
  resolve: (response: RequestPermissionResponse) => void;
};

function describeToolCall(update: {
  title?: string | null;
  kind?: string | null;
  toolCallId?: string;
}): string {
  return update.title ?? update.kind ?? update.toolCallId ?? "tool";
}

function isPlanApprovalRequest(params: RequestPermissionRequest): boolean {
  return (
    params.options.some((option) => option.optionId === "default") &&
    params.options.some((option) => option.optionId === "plan")
  );
}

function extractPlanText(toolCall: RequestPermissionRequest["toolCall"]): string | null {
  const rawInput = toolCall.rawInput;
  if (rawInput && typeof rawInput === "object" && "plan" in rawInput) {
    const plan = (rawInput as { plan?: unknown }).plan;
    if (typeof plan === "string" && plan.trim()) {
      return plan.trim();
    }
  }

  const contentText = (toolCall.content ?? [])
    .flatMap((item) => {
      if (item.type !== "content" || item.content.type !== "text") {
        return [];
      }
      return item.content.text?.trim() ? [item.content.text.trim()] : [];
    })
    .join("\n\n")
    .trim();

  return contentText || null;
}

/**
 * 管理 ACP agent 子进程以及 ClientSideConnection 的生命周期。
 */
export class AcpConnection {
  private process: ChildProcess | null = null;
  private connection: ClientSideConnection | null = null;
  private ready = false;
  private collectors = new Map<SessionId, ResponseCollector>();
  private thoughtBuffers = new Map<SessionId, string>();
  private agentCapabilities: AgentCapabilities | undefined;
  private pendingPermissions = new Map<SessionId, PendingPermission>();
  private permissionContexts = new Map<SessionId, PermissionContext>();

  private onExit?: () => void;

  constructor(private options: AcpAgentOptions, onExit?: () => void) {
    this.onExit = onExit;
  }

  registerCollector(sessionId: SessionId, collector: ResponseCollector): void {
    this.collectors.set(sessionId, collector);
  }

  unregisterCollector(sessionId: SessionId): void {
    this.flushThoughtBuffer(sessionId, true);
    this.collectors.delete(sessionId);
  }

  setPermissionContext(sessionId: SessionId, context: PermissionContext): void {
    this.permissionContexts.set(sessionId, context);
  }

  /**
   * 确保子进程已经启动，且连接已完成初始化。
   */
  async ensureReady(): Promise<ClientSideConnection> {
    if (this.ready && this.connection) {
      return this.connection;
    }

    const args = this.options.args ?? [];
    log(`spawning: ${this.options.command} ${args.join(" ")}`);

    const proc = spawn(this.options.command, args, {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, ...this.options.env },
      cwd: this.options.cwd,
    });
    this.process = proc;

    proc.on("exit", (code) => {
      this.flushAllThoughtBuffers();
      log(`subprocess exited (code=${code})`);
      this.ready = false;
      this.connection = null;
      this.process = null;
      this.onExit?.();
    });

    const writable = Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>;
    const readable = Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>;
    const stream = ndJsonStream(writable, readable);

    const conn = new ClientSideConnection((_agent) => ({
      sessionUpdate: async (params) => {
        const update = params.update;
        if (update.sessionUpdate !== "agent_thought_chunk") {
          this.flushThoughtBuffer(params.sessionId, true);
        }
        switch (update.sessionUpdate) {
          case "tool_call":
            log(`tool_call: ${describeToolCall(update)} (${update.status ?? "started"})`);
            break;
          case "tool_call_update":
            if (update.status) {
              log(`tool_call_update: ${describeToolCall(update)} → ${update.status}`);
            }
            break;
          case "agent_thought_chunk":
            if (update.content.type === "text") {
              this.appendThought(params.sessionId, update.content.text);
            }
            break;
        }
        const collector = this.collectors.get(params.sessionId);
        if (collector) {
          collector.handleUpdate(params);
        }
      },
      requestPermission: async (params) => {
        log(`permission requested for session=${params.sessionId}: ${describeToolCall(params.toolCall)}`);
        if (!isPlanApprovalRequest(params)) {
          const selected = this.selectAutomaticPermissionOption(params.options);
          log(
            `permission auto-approved for session=${params.sessionId}: ${selected.name} [${selected.kind}]`,
          );
          return {
            outcome: {
              outcome: "selected",
              optionId: selected.optionId,
            },
          };
        }

        const promptSent = await this.sendPlanApprovalPrompt(params);
        if (!promptSent) {
          const selected = this.selectPlanDecisionOption(params.options, "allow");
          log(
            `plan approval prompt unavailable for session=${params.sessionId}, auto-selecting ${selected.optionId}`,
          );
          return {
            outcome: {
              outcome: "selected",
              optionId: selected.optionId,
            },
          };
        }

        return await new Promise<RequestPermissionResponse>((resolve) => {
          this.pendingPermissions.set(params.sessionId, {
            params,
            resolve: (response) => {
              this.pendingPermissions.delete(params.sessionId);
              resolve(response);
            },
          });
        });
      },
    }), stream);

    log("initializing connection...");
    const initializeResponse = await conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: "weixin-router", version: "0.1.0" },
      clientCapabilities: {},
    });
    this.agentCapabilities = initializeResponse.agentCapabilities;
    log("connection initialized");

    this.connection = conn;
    this.ready = true;
    return conn;
  }

  /**
   * 结束子进程并完成清理。
   */
  dispose(): void {
    this.flushAllThoughtBuffers();
    this.ready = false;
    this.collectors.clear();
    this.agentCapabilities = undefined;
    this.pendingPermissions.clear();
    this.permissionContexts.clear();
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.connection = null;
  }

  async listSessions(cwd?: string): Promise<SessionInfo[]> {
    const conn = await this.ensureReady();
    if (!this.agentCapabilities?.sessionCapabilities?.list || !conn.listSessions) {
      throw new Error("ACP agent does not support listing sessions.");
    }

    const sessions: SessionInfo[] = [];
    let cursor: string | null | undefined;

    do {
      const response = await conn.listSessions({ cursor, cwd });
      sessions.push(...response.sessions);
      cursor = response.nextCursor;
    } while (cursor);

    return sessions;
  }

  async resumeSession(sessionId: SessionId, cwd: string): Promise<InitializeResponse | void> {
    const conn = await this.ensureReady();

    if (this.agentCapabilities?.sessionCapabilities?.resume && conn.unstable_resumeSession) {
      await conn.unstable_resumeSession({ cwd, mcpServers: [], sessionId });
      return;
    }

    if (this.agentCapabilities?.loadSession && conn.loadSession) {
      return await conn.loadSession({ cwd, mcpServers: [], sessionId });
    }

    throw new Error("ACP agent does not support session resume.");
  }

  async setSessionMode(sessionId: SessionId, modeId: string): Promise<void> {
    const conn = await this.ensureReady();
    if (!conn.setSessionMode) {
      throw new Error("ACP agent does not support session modes.");
    }

    await conn.setSessionMode({ modeId, sessionId });
  }

  async approvePermission(sessionId: SessionId, optionIndex?: number): Promise<PermissionOption> {
    return this.resolvePermission(sessionId, "allow", optionIndex);
  }

  async rejectPermission(sessionId: SessionId, optionIndex?: number): Promise<PermissionOption> {
    return this.resolvePermission(sessionId, "reject", optionIndex);
  }

  private async resolvePermission(
    sessionId: SessionId,
    desiredKind: "allow" | "reject",
    optionIndex?: number,
  ): Promise<PermissionOption> {
    const pending = this.pendingPermissions.get(sessionId);
    if (!pending) {
      throw new Error("No pending permission request for this session.");
    }

    const selected = this.selectPendingPermissionOption(pending.params, desiredKind, optionIndex);
    pending.resolve({
      outcome: {
        outcome: "selected",
        optionId: selected.optionId,
      },
    });
    return selected;
  }

  private selectPendingPermissionOption(
    params: RequestPermissionRequest,
    desiredKind: "allow" | "reject",
    optionIndex?: number,
  ): PermissionOption {
    if (isPlanApprovalRequest(params)) {
      return this.selectPlanDecisionOption(params.options, desiredKind, optionIndex);
    }

    return this.selectPermissionOption(params.options, desiredKind, optionIndex);
  }

  private selectPermissionOption(
    options: PermissionOption[],
    desiredKind: "allow" | "reject",
    optionIndex?: number,
  ): PermissionOption {
    if (optionIndex != null) {
      const indexed = options[optionIndex - 1];
      if (!indexed) {
        throw new Error(`Permission option ${optionIndex} does not exist.`);
      }
      return indexed;
    }

    const match = options.find((option) =>
      desiredKind === "allow" ? option.kind.startsWith("allow") : option.kind.startsWith("reject"),
    );
    if (!match) {
      throw new Error(`No ${desiredKind} option is available for this permission request.`);
    }
    return match;
  }

  private selectPlanDecisionOption(
    options: PermissionOption[],
    desiredKind: "allow" | "reject",
    optionIndex?: number,
  ): PermissionOption {
    if (optionIndex != null) {
      return this.selectPermissionOption(options, desiredKind, optionIndex);
    }

    const preferredOptionId = desiredKind === "allow" ? "default" : "plan";
    const preferred = options.find((option) => option.optionId === preferredOptionId);
    if (preferred) {
      return preferred;
    }

    return this.selectPermissionOption(options, desiredKind, optionIndex);
  }

  private selectAutomaticPermissionOption(options: PermissionOption[]): PermissionOption {
    return (
      options.find((option) => option.kind === "allow_once") ??
      options.find((option) => option.optionId === "default") ??
      options.find((option) => option.kind.startsWith("allow")) ??
      options[0]!
    );
  }

  private async sendPlanApprovalPrompt(params: RequestPermissionRequest): Promise<boolean> {
    const context = this.permissionContexts.get(params.sessionId);
    if (!context?.contextToken) {
      log(`permission prompt skipped for session=${params.sessionId}: missing reply context`);
      return false;
    }

    const planText = extractPlanText(params.toolCall);
    const text = [
      "Plan ready",
      planText ?? "The agent is ready to leave plan mode and start executing.",
      "",
      "Reply:",
      "- /do",
      "- /undo",
    ].join("\n");

    try {
      await sendMessageWeixin({
        to: context.to,
        text,
        opts: {
          baseUrl: context.baseUrl,
          token: context.token,
          contextToken: context.contextToken,
        },
      });
      return true;
    } catch (error) {
      log(`failed to send plan approval prompt: ${String(error)}`);
      return false;
    }
  }

  private appendThought(sessionId: SessionId, chunk: string): void {
    const next = `${this.thoughtBuffers.get(sessionId) ?? ""}${chunk}`;
    this.thoughtBuffers.set(sessionId, next);
    this.flushThoughtBuffer(sessionId, false);
  }

  private flushThoughtBuffer(sessionId: SessionId, force: boolean): void {
    let remaining = this.thoughtBuffers.get(sessionId);
    if (!remaining) {
      return;
    }

    while (remaining) {
      const boundary = this.findThoughtFlushBoundary(remaining, force);
      if (boundary === -1) {
        break;
      }

      this.logThoughtChunk(remaining.slice(0, boundary));
      remaining = remaining.slice(boundary);

      if (force) {
        continue;
      }
    }

    if (force) {
      this.logThoughtChunk(remaining);
      this.thoughtBuffers.delete(sessionId);
      return;
    }

    if (remaining) {
      this.thoughtBuffers.set(sessionId, remaining);
    } else {
      this.thoughtBuffers.delete(sessionId);
    }
  }

  private flushAllThoughtBuffers(): void {
    for (const sessionId of this.thoughtBuffers.keys()) {
      this.flushThoughtBuffer(sessionId, true);
    }
    this.thoughtBuffers.clear();
  }

  private findThoughtFlushBoundary(text: string, force: boolean): number {
    if (force) {
      return text.length;
    }

    const normalized = text.replace(/\r\n/g, "\n");
    const newlineIndex = normalized.lastIndexOf("\n");
    if (newlineIndex !== -1) {
      return newlineIndex + 1;
    }

    if (normalized.length < THINKING_LOG_FLUSH_THRESHOLD) {
      return -1;
    }

    for (let i = normalized.length - 1; i >= 0; i -= 1) {
      if (THINKING_LOG_BOUNDARY_CHARS.includes(normalized[i]!)) {
        return i + 1;
      }
    }

    for (
      let i = normalized.length - 1;
      i >= Math.floor(THINKING_LOG_FLUSH_THRESHOLD / 2);
      i -= 1
    ) {
      if (/\s/.test(normalized[i]!)) {
        return i + 1;
      }
    }

    return THINKING_LOG_FLUSH_THRESHOLD;
  }

  private logThoughtChunk(text: string): void {
    for (const line of text.replace(/\r/g, "").split("\n")) {
      const trimmed = line.trim();
      if (trimmed) {
        log(`thinking: ${trimmed}`);
      }
    }
  }
}
