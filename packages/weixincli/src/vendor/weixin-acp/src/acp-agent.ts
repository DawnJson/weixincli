// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/weixin-acp/src/acp-agent.ts)
import type { Agent, ChatRequest, ChatResponse } from "../../weixin-agent-sdk/index.js";
import type {
  InitializeResponse,
  LoadSessionResponse,
  NewSessionResponse,
  ResumeSessionResponse,
  SessionId,
  SessionInfo,
  SessionModeState,
} from "@agentclientprotocol/sdk";

import { SessionStore } from "../../../session-store.js";
import type {
  PermissionDecisionResult,
  ResumeSessionOptions,
  ResumeSessionResult,
  SessionSummary,
  SetModeOptions,
  SetModeResult,
} from "../../../types.js";
import type { AcpAgentOptions } from "./types.js";
import { AcpConnection } from "./acp-connection.js";
import { convertRequestToContentBlocks } from "./content-converter.js";
import { ResponseCollector } from "./response-collector.js";

function log(msg: string) {
  console.log(`[acp] ${msg}`);
}

/**
 * Agent 适配器，用来把 ACP（Agent Client Protocol）agent
 * 桥接到当前内置的 weixin-agent-sdk Agent 接口。
 */
export class AcpAgent implements Agent {
  private connection: AcpConnection;
  private sessions = new Map<string, SessionId>();
  private sessionCwds = new Map<string, string>();
  private desiredModes = new Map<string, string>();
  private sessionModes = new Map<string, SessionModeState | null>();
  private pendingStartupResumeSessionId: string | null;
  private readonly sessionStore: SessionStore;
  private options: AcpAgentOptions;

  constructor(options: AcpAgentOptions) {
    this.options = options;
    this.pendingStartupResumeSessionId = options.startupResumeSessionId ?? null;
    const resumeStoreKey = options.resumeStoreKey ?? "codex";
    this.sessionStore = new SessionStore(resumeStoreKey);
    this.connection = new AcpConnection(options, () => {
      log("subprocess exited, clearing session cache");
      this.sessions.clear();
      this.sessionCwds.clear();
      this.sessionModes.clear();
    });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const conn = await this.connection.ensureReady();

    // 为当前会话获取或创建一个 ACP session。
    const cwd = request.cwd ?? this.options.cwd ?? process.cwd();
    const { sessionId } = await this.getOrCreateSession(request.conversationId, cwd, conn);
    if (request.permissionContext) {
      this.connection.setPermissionContext(sessionId, request.permissionContext);
    }

    // 把 ChatRequest 转成 ACP ContentBlock[]。
    const blocks = await convertRequestToContentBlocks(request);
    if (blocks.length === 0) {
      return { text: "" };
    }

    // 注册收集器、发送 prompt，再等待完整响应。
    const preview = request.text?.slice(0, 50) || (request.media ? `[${request.media.type}]` : "");
    log(`prompt: "${preview}" (session=${sessionId})`);

    const collector = new ResponseCollector();
    this.connection.registerCollector(sessionId, collector);
    try {
      await conn.prompt({ sessionId, prompt: blocks });
    } finally {
      this.connection.unregisterCollector(sessionId);
    }

    const response = await collector.toResponse();
    log(`response: ${response.text?.slice(0, 80) ?? "[no text]"}${response.media ? " +media" : ""}`);
    return response;
  }

  private async getOrCreateSession(
    conversationId: string,
    cwd: string,
    conn: Awaited<ReturnType<AcpConnection["ensureReady"]>>,
  ): Promise<{ sessionId: SessionId; modes: SessionModeState | null }> {
    const existing = this.sessions.get(conversationId);
    const existingCwd = this.sessionCwds.get(conversationId);
    if (existing && existingCwd === cwd) {
      return {
        sessionId: existing,
        modes: this.sessionModes.get(conversationId) ?? null,
      };
    }

    if (existing && existingCwd && existingCwd !== cwd) {
      log(
        `cwd changed for conversation=${conversationId}: ${existingCwd} -> ${cwd}, resetting session`,
      );
      this.clearSession(conversationId);
    }

    if (this.pendingStartupResumeSessionId) {
      const startupSessionId = this.pendingStartupResumeSessionId;
      const result = await this.resumeSession(conversationId, {
        cwd,
        sessionId: startupSessionId,
      });
      this.pendingStartupResumeSessionId = null;
      return {
        sessionId: result.sessionId,
        modes: this.sessionModes.get(conversationId) ?? null,
      };
    }

    log(`creating new session for conversation=${conversationId}`);
    const res = await conn.newSession({
      cwd,
      mcpServers: [],
    });
    log(`session created: ${res.sessionId}`);
    this.rememberSession(conversationId, cwd, res.sessionId, res.modes ?? null);
    await this.applyDesiredMode(conversationId);
    return {
      sessionId: res.sessionId,
      modes: this.sessionModes.get(conversationId) ?? null,
    };
  }

  async resumeSession(
    conversationId: string,
    options: ResumeSessionOptions = {},
  ): Promise<ResumeSessionResult> {
    const cwd = options.cwd ?? this.sessionCwds.get(conversationId) ?? this.options.cwd ?? process.cwd();

    let targetSessionId = options.sessionId;
    let source: ResumeSessionResult["source"] = options.sessionId ? "explicit" : "saved";
    let title: string | null | undefined;

    if (!targetSessionId && !options.latest) {
      targetSessionId = this.sessionStore.get(conversationId, cwd)?.sessionId;
    }

    if (!targetSessionId) {
      const latest = await this.findLatestSession(cwd);
      if (!latest) {
        throw new Error(`No resumable session found for ${cwd}.`);
      }
      targetSessionId = latest.sessionId;
      title = latest.title;
      source = "latest";
    }

    log(`resuming session for conversation=${conversationId}: ${targetSessionId}`);
    const response = await this.connection.resumeSession(targetSessionId, cwd);
    this.rememberSession(conversationId, cwd, targetSessionId, this.extractModeState(response));
    await this.applyDesiredMode(conversationId);

    return {
      cwd,
      sessionId: targetSessionId,
      source,
      title,
    };
  }

  async setSessionMode(
    conversationId: string,
    options: SetModeOptions,
  ): Promise<SetModeResult> {
    const cwd = options.cwd ?? this.sessionCwds.get(conversationId) ?? this.options.cwd ?? process.cwd();
    const conn = await this.connection.ensureReady();
    const { sessionId, modes } = await this.getOrCreateSession(conversationId, cwd, conn);

    const state = modes ?? this.sessionModes.get(conversationId) ?? null;
    if (!state) {
      throw new Error("Current agent does not support session modes.");
    }

    const selectedMode = state.availableModes.find((mode) => mode.id === options.modeId);
    if (!selectedMode) {
      throw new Error(`Mode \"${options.modeId}\" is not supported by the current agent.`);
    }

    await this.connection.setSessionMode(sessionId, options.modeId);
    this.desiredModes.set(conversationId, options.modeId);
    this.sessionModes.set(conversationId, {
      ...state,
      currentModeId: options.modeId,
    });

    return {
      description: selectedMode.description,
      modeId: options.modeId,
      name: selectedMode.name,
      sessionId,
    };
  }

  async listSessions(options: { limit?: number } = {}): Promise<SessionSummary[]> {
    const sessions = await this.connection.listSessions();
    const limit = options.limit ?? 5;

    return this.sortSessionsByUpdatedAt(sessions).slice(0, limit).map((session) => ({
      cwd: session.cwd,
      sessionId: session.sessionId,
      title: session.title,
      updatedAt: session.updatedAt,
    }));
  }

  async approvePendingPermission(
    conversationId: string,
    optionIndex?: number,
  ): Promise<PermissionDecisionResult> {
    const sessionId = this.sessions.get(conversationId);
    if (!sessionId) {
      throw new Error("No active session for this chat.");
    }

    const selected = await this.connection.approvePermission(sessionId, optionIndex);
    this.syncModeFromPermissionSelection(conversationId, selected.optionId);
    return {
      name: selected.name,
      optionId: selected.optionId,
    };
  }

  async rejectPendingPermission(
    conversationId: string,
    optionIndex?: number,
  ): Promise<PermissionDecisionResult> {
    const sessionId = this.sessions.get(conversationId);
    if (!sessionId) {
      throw new Error("No active session for this chat.");
    }

    const selected = await this.connection.rejectPermission(sessionId, optionIndex);
    this.syncModeFromPermissionSelection(conversationId, selected.optionId);
    return {
      name: selected.name,
      optionId: selected.optionId,
    };
  }

  private async findLatestSession(cwd: string): Promise<SessionInfo | undefined> {
    const sessions = await this.connection.listSessions(cwd);
    return this.sortSessionsByUpdatedAt(sessions)[0];
  }

  private sortSessionsByUpdatedAt(sessions: SessionInfo[]): SessionInfo[] {
    return sessions.slice().sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt ?? "");
      const rightTime = Date.parse(right.updatedAt ?? "");
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
    });
  }

  private rememberSession(
    conversationId: string,
    cwd: string,
    sessionId: SessionId,
    modes: SessionModeState | null,
  ): void {
    this.sessions.set(conversationId, sessionId);
    this.sessionCwds.set(conversationId, cwd);
    this.sessionModes.set(conversationId, modes);
    this.sessionStore.set(conversationId, cwd, sessionId);
  }

  private syncModeFromPermissionSelection(conversationId: string, optionId: string): void {
    const state = this.sessionModes.get(conversationId);
    if (!state || !state.availableModes.some((mode) => mode.id === optionId)) {
      return;
    }

    this.desiredModes.set(conversationId, optionId);
    this.sessionModes.set(conversationId, {
      ...state,
      currentModeId: optionId,
    });
  }

  private extractModeState(
    response: LoadSessionResponse | NewSessionResponse | ResumeSessionResponse | InitializeResponse | void,
  ): SessionModeState | null {
    if (!response || typeof response !== "object" || !("modes" in response)) {
      return null;
    }

    return response.modes ?? null;
  }

  private async applyDesiredMode(conversationId: string): Promise<void> {
    const desiredMode = this.desiredModes.get(conversationId);
    if (!desiredMode) {
      return;
    }

    const sessionId = this.sessions.get(conversationId);
    const state = this.sessionModes.get(conversationId);
    if (!sessionId || !state) {
      return;
    }

    if (state.currentModeId === desiredMode) {
      return;
    }

    const hasDesiredMode = state.availableModes.some((mode) => mode.id === desiredMode);
    if (!hasDesiredMode) {
      this.desiredModes.delete(conversationId);
      return;
    }

    await this.connection.setSessionMode(sessionId, desiredMode);
    this.sessionModes.set(conversationId, {
      ...state,
      currentModeId: desiredMode,
    });
  }

  /**
   * 清理或重置指定会话的 session。
   * 下一条消息会自动创建一个新的 session。
   */
  clearSession(conversationId: string): void {
    const sessionId = this.sessions.get(conversationId);
    if (sessionId) {
      log(`clearing session for conversation=${conversationId} (session=${sessionId})`);
      this.connection.unregisterCollector(sessionId);
      this.sessions.delete(conversationId);
    }
    this.sessionCwds.delete(conversationId);
    this.sessionModes.delete(conversationId);
  }

  /**
   * 结束 ACP 子进程，并清理所有 session。
   */
  dispose(): void {
    this.sessions.clear();
    this.sessionCwds.clear();
    this.sessionModes.clear();
    this.connection.dispose();
  }
}
