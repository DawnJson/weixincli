import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import type { Agent, ChatRequest, ChatResponse } from "./vendor/weixin-agent-sdk/index.js";
import { AcpAgent } from "./vendor/weixin-acp/index.js";

import type {
  ResumeSessionResult,
  RoutedAgent,
  RouterAgentOptions,
  SessionSummary,
  SetModeResult,
  SupportedModel,
} from "./types.js";

type RouteCommand = {
  model: SupportedModel;
  prompt?: string;
};

type WorkingDirectoryCommand =
  | {
      kind: "show";
    }
  | {
      kind: "change";
      target?: string;
    };

type ResumeCommand = {
  missingTarget?: boolean;
  latest: boolean;
  model?: SupportedModel;
  sessionId?: string;
};

type SessionsCommand = {
  invalid?: boolean;
  model?: SupportedModel;
};

type PlanDecisionCommand = {
  action: "do" | "undo";
  invalid?: boolean;
};

type PlanCommand = {
  invalid?: boolean;
};

type UnplanCommand = {
  invalid?: boolean;
};

const MODEL_LABELS: Record<SupportedModel, string> = {
  claude: "Claude",
  codex: "Codex",
};

const DEFAULT_MODE_ID = "default";
const PLAN_MODE_ID = "plan";
const SOFT_PLAN_INSTRUCTION = [
  "Planning mode is enabled for this chat.",
  "Do not execute tools, edits, shell commands, or make any file changes.",
  "Respond only with a concrete step-by-step implementation plan.",
  "Do not start implementing until the user explicitly approves the plan.",
].join(" ");

type PendingPlan = {
  request: ChatRequest;
  text: string;
};

const require = createRequire(import.meta.url);

type BuiltinCommandOptions = {
  packageName: string;
  binName: string;
  command?: string;
  args?: string[];
};

function parseRouteCommand(text: string): RouteCommand | null {
  const trimmed = text.trim();
  const match = /^\/(codex|claude|claude-code)(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) {
    return null;
  }

  const rawModel = match[1].toLowerCase();
  const model: SupportedModel = rawModel === "codex" ? "codex" : "claude";
  const prompt = match[2]?.trim();

  return prompt ? { model, prompt } : { model };
}

function parseWorkingDirectoryCommand(text: string): WorkingDirectoryCommand | null {
  const trimmed = text.trim();

  if (/^\/pwd$/i.test(trimmed)) {
    return { kind: "show" };
  }

  const match = /^\/cd(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) {
    return null;
  }

  return {
    kind: "change",
    target: match[1]?.trim(),
  };
}

function parseResumeCommand(text: string): ResumeCommand | null {
  const trimmed = text.trim();
  const match = /^\/resume(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) {
    return null;
  }

  const arg = match[1]?.trim();
  if (!arg) {
    return { latest: false, missingTarget: true };
  }

  const parts = arg.split(/\s+/).filter(Boolean);
  const [first, ...rest] = parts;
  if (!first) {
    return { latest: false, missingTarget: true };
  }

  const normalizedFirst = first.toLowerCase();
  const model =
    normalizedFirst === "codex"
      ? "codex"
      : normalizedFirst === "claude" || normalizedFirst === "claude-code"
        ? "claude"
        : undefined;
  const remainder = model ? rest.join(" ").trim() : arg;

  if (!remainder) {
    return { latest: false, model };
  }

  if (remainder.toLowerCase() === "latest") {
    return { latest: true, model };
  }

  return {
    latest: false,
    model,
    sessionId: remainder,
  };
}

function parseSessionsCommand(text: string): SessionsCommand | null {
  const trimmed = text.trim();
  const match = /^\/sessions(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) {
    return null;
  }

  const arg = match[1]?.trim();
  if (!arg) {
    return {};
  }

  const normalized = arg.toLowerCase();
  if (normalized === "codex") {
    return { model: "codex" };
  }

  if (normalized === "claude" || normalized === "claude-code") {
    return { model: "claude" };
  }

  return { invalid: true };
}

function parsePlanDecisionCommand(text: string): PlanDecisionCommand | null {
  const trimmed = text.trim();
  const match = /^\/(do|undo)(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) {
    return null;
  }

  const action = match[1].toLowerCase() as PlanDecisionCommand["action"];
  return match[2]?.trim() ? { action, invalid: true } : { action };
}

function parsePlanCommand(text: string): PlanCommand | null {
  const trimmed = text.trim();
  const match = /^\/plan(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) {
    return null;
  }

  return match[1]?.trim() ? { invalid: true } : {};
}

function parseUnplanCommand(text: string): UnplanCommand | null {
  const trimmed = text.trim();
  const match = /^\/unplan(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) {
    return null;
  }

  return match[1]?.trim() ? { invalid: true } : {};
}

function expandHomePath(target: string): string {
  if (target === "~") {
    return os.homedir();
  }

  if (target.startsWith("~/") || target.startsWith("~\\")) {
    return path.join(os.homedir(), target.slice(2));
  }

  return target;
}

function resolvePackageBin(packageName: string, binName: string): string | null {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const relativeBinPath =
      typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.[binName];

    if (!relativeBinPath) {
      return null;
    }

    return path.resolve(path.dirname(packageJsonPath), relativeBinPath);
  } catch {
    return null;
  }
}

function resolveBuiltinCommand({
  packageName,
  binName,
  command,
  args,
}: BuiltinCommandOptions): { command: string; args?: string[] } {
  if (command && command !== binName) {
    return { command, args };
  }

  const resolvedBinPath = resolvePackageBin(packageName, binName);
  if (!resolvedBinPath) {
    return { command: command ?? binName, args };
  }

  return {
    command: process.execPath,
    args: [resolvedBinPath, ...(args ?? [])],
  };
}

function buildBuiltinAgents(options: RouterAgentOptions): Record<SupportedModel, RoutedAgent> {
  const codexLaunch = resolveBuiltinCommand({
    packageName: "@zed-industries/codex-acp",
    binName: "codex-acp",
    command: options.codexCommand,
    args: options.codexArgs,
  });
  const claudeLaunch = resolveBuiltinCommand({
    packageName: "@zed-industries/claude-agent-acp",
    binName: "claude-agent-acp",
    command: options.claudeCommand,
    args: options.claudeArgs,
  });

  return {
    codex:
      options.agents?.codex ??
      new AcpAgent({
        args: codexLaunch.args,
        command: codexLaunch.command,
        cwd: options.cwd,
        resumeStoreKey: "codex",
        startupResumeSessionId: options.codexStartupResumeSessionId,
      }),
    claude:
      options.agents?.claude ??
      new AcpAgent({
        args: claudeLaunch.args,
        command: claudeLaunch.command,
        cwd: options.cwd,
        resumeStoreKey: "claude",
        startupResumeSessionId: options.claudeStartupResumeSessionId,
      }),
  };
}

export class RouterAgent implements Agent {
  private readonly agents: Record<SupportedModel, RoutedAgent>;
  private readonly currentModelByConversation = new Map<string, SupportedModel>();
  private readonly cwdByConversation = new Map<string, string>();
  private readonly modeByConversationAndModel = new Map<string, string>();
  private readonly pendingPlanByConversationAndModel = new Map<string, PendingPlan>();
  private readonly softPlanByConversationAndModel = new Map<string, boolean>();
  private readonly baseCwd: string;

  constructor(private readonly options: RouterAgentOptions) {
    this.baseCwd = options.cwd ?? process.cwd();
    this.agents = buildBuiltinAgents(options);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const routeCommand = parseRouteCommand(request.text);
    if (routeCommand) {
      this.currentModelByConversation.set(request.conversationId, routeCommand.model);
      if (!routeCommand.prompt) {
        return {
          text: `Switched this chat to ${MODEL_LABELS[routeCommand.model]}.`,
        };
      }

      return this.forward(routeCommand.model, {
        ...request,
        text: routeCommand.prompt,
      });
    }

    const workingDirectoryCommand = parseWorkingDirectoryCommand(request.text);
    if (workingDirectoryCommand) {
      return this.handleWorkingDirectoryCommand(request.conversationId, workingDirectoryCommand);
    }

    const resumeCommand = parseResumeCommand(request.text);
    if (resumeCommand) {
      return await this.handleResumeCommand(request.conversationId, resumeCommand);
    }

    const sessionsCommand = parseSessionsCommand(request.text);
    if (sessionsCommand) {
      return await this.handleSessionsCommand(request.conversationId, sessionsCommand);
    }

    const planDecisionCommand = parsePlanDecisionCommand(request.text);
    if (planDecisionCommand) {
      return await this.handlePlanDecisionCommand(request, planDecisionCommand);
    }

    const planCommand = parsePlanCommand(request.text);
    if (planCommand) {
      return await this.handlePlanCommand(request.conversationId, planCommand);
    }

    const unplanCommand = parseUnplanCommand(request.text);
    if (unplanCommand) {
      return await this.handleUnplanCommand(request.conversationId, unplanCommand);
    }

    const currentModel = this.getCurrentModel(request.conversationId);
    if (currentModel === "codex" && this.isSoftPlanEnabled(request.conversationId, currentModel)) {
      return await this.handleSoftPlanRequest(request, currentModel);
    }

    return this.forward(currentModel, request);
  }

  clearSession(conversationId: string): void {
    const model = this.getCurrentModel(conversationId);
    this.clearPendingPlan(conversationId, model);
    this.agents[model].clearSession?.(conversationId);
  }

  dispose(): void {
    for (const agent of Object.values(this.agents)) {
      agent.dispose?.();
    }
  }

  private getCurrentModel(conversationId: string): SupportedModel {
    return this.currentModelByConversation.get(conversationId) ?? this.options.defaultModel;
  }

  private forward(model: SupportedModel, request: ChatRequest): Promise<ChatResponse> {
    const text =
      model === "codex" && this.isSoftPlanEnabled(request.conversationId, model)
        ? this.buildSoftPlanPrompt(request.text)
        : request.text;

    return this.agents[model].chat({
      ...request,
      cwd: this.getCurrentCwd(request.conversationId),
      permissionContext: request.permissionContext,
      text,
    });
  }

  private getCurrentCwd(conversationId: string): string {
    return this.cwdByConversation.get(conversationId) ?? this.baseCwd;
  }

  private handleWorkingDirectoryCommand(
    conversationId: string,
    command: WorkingDirectoryCommand,
  ): ChatResponse {
    if (command.kind === "show") {
      return { text: `Current working directory:\n${this.getCurrentCwd(conversationId)}` };
    }

    if (!command.target) {
      return {
        text: `Usage: /cd <path>\nCurrent working directory:\n${this.getCurrentCwd(conversationId)}`,
      };
    }

    const resolvedPath = path.resolve(
      this.getCurrentCwd(conversationId),
      expandHomePath(command.target),
    );

    let stats: fs.Stats;
    try {
      stats = fs.statSync(resolvedPath);
    } catch {
      return { text: `Directory not found:\n${resolvedPath}` };
    }

    if (!stats.isDirectory()) {
      return { text: `Not a directory:\n${resolvedPath}` };
    }

    this.cwdByConversation.set(conversationId, resolvedPath);
    return { text: `Working directory changed to:\n${resolvedPath}` };
  }

  private async handleResumeCommand(
    conversationId: string,
    command: ResumeCommand,
  ): Promise<ChatResponse> {
  const model = command.model ?? this.getCurrentModel(conversationId);
    if (command.missingTarget) {
      return {
        text: [
          "Usage:",
          "/resume latest",
          "/resume <sessionId>",
          "/resume codex latest",
          "/resume claude latest",
          "/resume codex <sessionId>",
          "/resume claude <sessionId>",
        ].join("\n"),
      };
    }

    const agent = this.agents[model];
    if (!agent.resumeSession) {
      return { text: `Resume is not supported for ${MODEL_LABELS[model]}.` };
    }

    const cwd = this.getCurrentCwd(conversationId);

    try {
      const result = await agent.resumeSession(conversationId, {
        cwd,
        latest: command.latest,
        sessionId: command.sessionId,
      });
      this.clearPendingPlan(conversationId, model);
      this.currentModelByConversation.set(conversationId, model);
      return { text: this.formatResumeResult(model, result) };
    } catch (error) {
      return {
        text: `Failed to resume ${MODEL_LABELS[model]} session:\n${String(error)}`,
      };
    }
  }

  private formatResumeResult(model: SupportedModel, result: ResumeSessionResult): string {
    const sourceLine =
      result.source === "explicit"
        ? "Source: explicit session id"
        : result.source === "latest"
          ? "Source: latest session in current working directory"
          : "Source: saved session for this chat";
    const titleLine = result.title ? `Title: ${result.title}` : undefined;

    return [
      `Resumed ${MODEL_LABELS[model]} session.`,
      `Session ID: ${result.sessionId}`,
      sourceLine,
      `Working directory: ${result.cwd}`,
      titleLine,
    ]
      .filter(Boolean)
      .join("\n");
  }

  private async handleSessionsCommand(
    conversationId: string,
    command: SessionsCommand,
  ): Promise<ChatResponse> {
    if (command.invalid) {
      return {
        text: ["Usage:", "/sessions", "/sessions codex", "/sessions claude"].join("\n"),
      };
    }

    const model = command.model ?? this.getCurrentModel(conversationId);
    const agent = this.agents[model];
    if (!agent.listSessions) {
      return { text: `Session listing is not supported for ${MODEL_LABELS[model]}.` };
    }

    try {
      const sessions = await agent.listSessions({ limit: 5 });
      return { text: this.formatSessionsResult(model, sessions) };
    } catch (error) {
      return {
        text: `Failed to list ${MODEL_LABELS[model]} sessions:\n${String(error)}`,
      };
    }
  }

  private formatSessionsResult(model: SupportedModel, sessions: SessionSummary[]): string {
    if (sessions.length === 0) {
      return `No recent ${MODEL_LABELS[model]} sessions found.`;
    }

    return [
      `Recent ${MODEL_LABELS[model]} sessions (latest 5):`,
      ...sessions.flatMap((session, index) => {
        const lines = [
          `${index + 1}. ${session.sessionId}`,
          `Updated: ${session.updatedAt ?? "unknown"}`,
          `CWD: ${session.cwd}`,
        ];

        if (session.title) {
          lines.splice(2, 0, `Title: ${session.title}`);
        }

        return lines;
      }),
    ].join("\n");
  }

  private async handlePlanDecisionCommand(
    request: ChatRequest,
    command: PlanDecisionCommand,
  ): Promise<ChatResponse> {
    if (command.invalid) {
      return { text: "Usage:\n/do\n/undo" };
    }

    const conversationId = request.conversationId;
    const model = this.getCurrentModel(conversationId);
    if (model === "codex") {
      return await this.handleSoftPlanDecision(request, model, command);
    }

    const agent = this.agents[model];
    const actionMethod =
      command.action === "do" ? agent.approvePendingPermission : agent.rejectPendingPermission;
    if (!actionMethod) {
      return { text: `Plan approvals are not supported for ${MODEL_LABELS[model]}.` };
    }

    try {
      const result = await actionMethod.call(agent, conversationId);
      this.syncTrackedModeFromPermissionResult(conversationId, model, result.optionId);
      return {
        text:
          command.action === "do"
            ? this.formatPlanExecutionApprovedResult(model)
            : this.formatPlanExecutionRejectedResult(model, result.optionId),
      };
    } catch (error) {
      return {
        text: `Failed to ${command.action} the pending ${MODEL_LABELS[model]} plan:\n${String(error)}`,
      };
    }
  }

  private async handleSoftPlanDecision(
    request: ChatRequest,
    model: SupportedModel,
    command: PlanDecisionCommand,
  ): Promise<ChatResponse> {
    const pendingPlan = this.getPendingPlan(request.conversationId, model);
    if (!pendingPlan) {
      return { text: `No pending ${MODEL_LABELS[model]} plan for this chat.` };
    }

    if (command.action === "undo") {
      this.clearPendingPlan(request.conversationId, model);
      return {
        text: `${MODEL_LABELS[model]} plan discarded. ${MODEL_LABELS[model]} stays in plan mode.`,
      };
    }

    this.clearPendingPlan(request.conversationId, model);
    this.disableSoftPlan(request.conversationId, model);

    return this.forward(model, {
      ...pendingPlan.request,
      cwd: this.getCurrentCwd(request.conversationId),
      permissionContext: request.permissionContext,
    });
  }

  private formatPlanExecutionApprovedResult(model: SupportedModel): string {
    return `${MODEL_LABELS[model]} plan approved. Continuing execution.`;
  }

  private formatPlanExecutionRejectedResult(
    model: SupportedModel,
    optionId: string,
  ): string {
    const suffix = optionId === PLAN_MODE_ID ? " Staying in plan mode." : "";
    return `${MODEL_LABELS[model]} plan rejected.${suffix}`;
  }

  private async handlePlanCommand(
    conversationId: string,
    command: PlanCommand,
  ): Promise<ChatResponse> {
    if (command.invalid) {
      return { text: "Usage:\n/plan" };
    }

    const model = this.getCurrentModel(conversationId);
    if (model === "codex") {
      this.clearPendingPlan(conversationId, model);
      this.enableSoftPlan(conversationId, model);
      return {
        text: [
          "Codex planning mode enabled for this chat.",
          "Your next request will return a plan only.",
          "Reply `/do` to execute that plan or `/undo` to discard it.",
        ].join("\n"),
      };
    }

    const result = await this.switchMode(conversationId, model, PLAN_MODE_ID, true);
    return {
      text: result.ok ? this.formatPlanResult(model, result.result) : result.message,
    };
  }

  private formatPlanResult(model: SupportedModel, result: SetModeResult): string {
    return [
      `${MODEL_LABELS[model]} switched to plan mode for this chat.`,
      `Mode ID: ${result.modeId}`,
      `Session ID: ${result.sessionId}`,
      result.name ? `Mode: ${result.name}` : undefined,
      "When the plan is ready, reply `/do` to execute or `/undo` to keep planning.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private async handleUnplanCommand(
    conversationId: string,
    command: UnplanCommand,
  ): Promise<ChatResponse> {
    if (command.invalid) {
      return { text: "Usage:\n/unplan" };
    }

    const model = this.getCurrentModel(conversationId);
    const result =
      model === "codex"
        ? (() => {
            this.clearPendingPlan(conversationId, model);
            return this.disableSoftPlan(conversationId, model);
          })()
        : await this.switchMode(conversationId, model, DEFAULT_MODE_ID, false);
    if (!result.ok) {
      return { text: result.message };
    }

    return {
      text: [
        `${MODEL_LABELS[model]} switched back to default mode for this chat.`,
        `Mode ID: ${result.result.modeId}`,
        `Session ID: ${result.result.sessionId}`,
        result.result.name ? `Mode: ${result.result.name}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  private async switchMode(
    conversationId: string,
    model: SupportedModel,
    modeId: string,
    reportUnsupportedAsPlan: boolean,
  ): Promise<
    | { ok: true; result: SetModeResult }
    | { message: string; ok: false }
  > {
    const agent = this.agents[model];
    if (!agent.setSessionMode) {
      return {
        ok: false,
        message: reportUnsupportedAsPlan
          ? `Plan mode is not supported for ${MODEL_LABELS[model]}.`
          : `Mode switching is not supported for ${MODEL_LABELS[model]}.`,
      };
    }

    try {
      const result = await agent.setSessionMode(conversationId, {
        cwd: this.getCurrentCwd(conversationId),
        modeId,
      });
      this.setTrackedMode(conversationId, model, modeId);
      return { ok: true, result };
    } catch (error) {
      const message = String(error);
      if (message.includes("does not support") || message.includes("not supported")) {
        return {
          ok: false,
          message: reportUnsupportedAsPlan
            ? `Plan mode is not supported for ${MODEL_LABELS[model]}.`
            : `Mode switching is not supported for ${MODEL_LABELS[model]}.`,
        };
      }
      return {
        ok: false,
        message: `Failed to switch ${MODEL_LABELS[model]} to ${modeId} mode:\n${message}`,
      };
    }
  }

  private getTrackedMode(conversationId: string, model: SupportedModel): string {
    return this.modeByConversationAndModel.get(`${conversationId}:${model}`) ?? DEFAULT_MODE_ID;
  }

  private setTrackedMode(conversationId: string, model: SupportedModel, modeId: string): void {
    this.modeByConversationAndModel.set(`${conversationId}:${model}`, modeId);
  }

  private buildSoftPlanPrompt(text: string): string {
    return `${SOFT_PLAN_INSTRUCTION}\n\nUser request:\n${text}`;
  }

  private async handleSoftPlanRequest(
    request: ChatRequest,
    model: SupportedModel,
  ): Promise<ChatResponse> {
    const response = await this.forward(model, request);
    const planText = response.text?.trim();
    if (!planText) {
      this.clearPendingPlan(request.conversationId, model);
      return response.text || response.media
        ? response
        : { text: `${MODEL_LABELS[model]} did not return a plan. Send another request or /unplan.` };
    }

    this.pendingPlanByConversationAndModel.set(this.getPlanKey(request.conversationId, model), {
      request,
      text: planText,
    });

    return {
      ...response,
      text: [
        `${MODEL_LABELS[model]} plan:`,
        planText,
        "Reply `/do` to execute this plan or `/undo` to discard it.",
      ].join("\n\n"),
    };
  }

  private enableSoftPlan(conversationId: string, model: SupportedModel): void {
    this.softPlanByConversationAndModel.set(`${conversationId}:${model}`, true);
    this.setTrackedMode(conversationId, model, PLAN_MODE_ID);
  }

  private disableSoftPlan(
    conversationId: string,
    model: SupportedModel,
  ): { ok: true; result: SetModeResult } {
    this.softPlanByConversationAndModel.delete(`${conversationId}:${model}`);
    this.setTrackedMode(conversationId, model, DEFAULT_MODE_ID);
    return {
      ok: true,
      result: {
        modeId: DEFAULT_MODE_ID,
        name: "Default",
        sessionId: "soft-plan",
      },
    };
  }

  private isSoftPlanEnabled(conversationId: string, model: SupportedModel): boolean {
    return this.softPlanByConversationAndModel.get(`${conversationId}:${model}`) === true;
  }

  private syncTrackedModeFromPermissionResult(
    conversationId: string,
    model: SupportedModel,
    optionId: string,
  ): void {
    if (optionId === DEFAULT_MODE_ID || optionId === PLAN_MODE_ID) {
      this.setTrackedMode(conversationId, model, optionId);
      return;
    }

    if (optionId === "acceptEdits" || optionId === "dontAsk" || optionId === "bypassPermissions") {
      this.setTrackedMode(conversationId, model, optionId);
    }
  }

  private getPendingPlan(conversationId: string, model: SupportedModel): PendingPlan | undefined {
    return this.pendingPlanByConversationAndModel.get(this.getPlanKey(conversationId, model));
  }

  private clearPendingPlan(conversationId: string, model: SupportedModel): void {
    this.pendingPlanByConversationAndModel.delete(this.getPlanKey(conversationId, model));
  }

  private getPlanKey(conversationId: string, model: SupportedModel): string {
    return `${conversationId}:${model}`;
  }
}
