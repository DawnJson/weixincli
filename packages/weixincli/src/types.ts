import type { Agent } from "./vendor/weixin-agent-sdk/index.js";

export type SupportedModel = "codex" | "claude";

export type ResumeSessionOptions = {
  cwd?: string;
  latest?: boolean;
  sessionId?: string;
};

export type ResumeSessionResult = {
  cwd: string;
  sessionId: string;
  source: "explicit" | "latest" | "saved";
  title?: string | null;
};

export type SessionSummary = {
  cwd: string;
  sessionId: string;
  title?: string | null;
  updatedAt?: string | null;
};

export type PermissionDecisionResult = {
  name: string;
  optionId: string;
};

export type SetModeOptions = {
  cwd?: string;
  modeId: string;
};

export type SetModeResult = {
  description?: string | null;
  modeId: string;
  name?: string | null;
  sessionId: string;
};

export type RoutedAgent = Agent & {
  approvePendingPermission?: (
    conversationId: string,
    optionIndex?: number,
  ) => Promise<PermissionDecisionResult>;
  rejectPendingPermission?: (
    conversationId: string,
    optionIndex?: number,
  ) => Promise<PermissionDecisionResult>;
  dispose?: () => void;
  listSessions?: (options?: { limit?: number }) => Promise<SessionSummary[]>;
  setSessionMode?: (
    conversationId: string,
    options: SetModeOptions,
  ) => Promise<SetModeResult>;
  resumeSession?: (
    conversationId: string,
    options?: ResumeSessionOptions,
  ) => Promise<ResumeSessionResult>;
};

export type RouterAgentOptions = {
  defaultModel: SupportedModel;
  cwd?: string;
  agents?: Partial<Record<SupportedModel, RoutedAgent>>;
  codexStartupResumeSessionId?: string;
  codexCommand?: string;
  codexArgs?: string[];
  claudeStartupResumeSessionId?: string;
  claudeCommand?: string;
  claudeArgs?: string[];
};
