import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { RouterAgent } from "../dist/index.mjs";

class FakeAgent {
  constructor(name) {
    this.name = name;
    this.approvePendingPermissionCalls = [];
    this.calls = [];
    this.clearedConversationIds = [];
    this.listSessionsCalls = [];
    this.rejectPendingPermissionCalls = [];
    this.resumeCalls = [];
    this.setSessionModeCalls = [];
  }

  async chat(request) {
    this.calls.push(request);
    return { text: `${this.name}:${request.text}` };
  }

  clearSession(conversationId) {
    this.clearedConversationIds.push(conversationId);
  }

  async listSessions(options = {}) {
    this.listSessionsCalls.push(options);
    return [
      {
        cwd: `E:\\workspace\\${this.name}`,
        sessionId: `${this.name}-session-1`,
        title: `${this.name} title 1`,
        updatedAt: "2026-03-30T10:00:00.000Z",
      },
      {
        cwd: `E:\\workspace\\${this.name}`,
        sessionId: `${this.name}-session-2`,
        updatedAt: "2026-03-29T10:00:00.000Z",
      },
    ];
  }

  async approvePendingPermission(conversationId, optionIndex) {
    this.approvePendingPermissionCalls.push({ conversationId, optionIndex });
    return {
      name: "Execute Plan",
      optionId: "default",
    };
  }

  async rejectPendingPermission(conversationId, optionIndex) {
    this.rejectPendingPermissionCalls.push({ conversationId, optionIndex });
    return {
      name: "Keep Planning",
      optionId: "plan",
    };
  }

  async resumeSession(conversationId, options = {}) {
    this.resumeCalls.push({ conversationId, ...options });
    return {
      cwd: options.cwd ?? process.cwd(),
      sessionId: options.sessionId ?? `${this.name}-saved-session`,
      source: options.sessionId ? "explicit" : options.latest ? "latest" : "saved",
      title: options.latest ? `${this.name} latest` : undefined,
    };
  }

  async setSessionMode(conversationId, options) {
    this.setSessionModeCalls.push({ conversationId, ...options });
    if (this.name === "codex") {
      throw new Error("Current agent does not support session modes.");
    }

    return {
      modeId: options.modeId,
      name:
        options.modeId === "plan"
          ? "Plan Mode"
          : options.modeId === "default"
            ? "Default"
            : options.modeId,
      sessionId: `${this.name}-plan-session`,
    };
  }
}

function createRouter(defaultModel, options = {}) {
  const codex = new FakeAgent("codex");
  const claude = new FakeAgent("claude");
  const router = new RouterAgent({
    agents: {
      claude,
      codex,
    },
    defaultModel,
    ...options,
  });

  return { claude, codex, router };
}

function testBuiltinCommandsResolveFromInstalledPackages() {
  const router = new RouterAgent({
    codexStartupResumeSessionId: "startup-session-id",
    defaultModel: "codex",
  });

  const codexAgent = router.agents.codex;
  const claudeAgent = router.agents.claude;

  assert.equal(codexAgent.options.command, process.execPath);
  assert.match(codexAgent.options.args[0], /@zed-industries[\\/]codex-acp[\\/]bin[\\/]codex-acp\.js$/);
  assert.equal(codexAgent.options.startupResumeSessionId, "startup-session-id");
  assert.equal(claudeAgent.options.command, process.execPath);
  assert.match(
    claudeAgent.options.args[0],
    /@zed-industries[\\/]claude-agent-acp[\\/]dist[\\/]index\.js$/,
  );
}

async function testPwdAndCdCommandsTrackConversationWorkingDirectory() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-router-"));
  const nestedDir = path.join(tempRoot, "nested");
  fs.mkdirSync(nestedDir);

  const { codex, router } = createRouter("codex", { cwd: tempRoot });

  const pwdResponse = await router.chat({
    conversationId: "conv-1",
    text: "/pwd",
  });
  assert.equal(pwdResponse.text, `Current working directory:\n${tempRoot}`);

  const cdResponse = await router.chat({
    conversationId: "conv-1",
    text: "/cd nested",
  });
  assert.equal(cdResponse.text, `Working directory changed to:\n${nestedDir}`);

  await router.chat({
    conversationId: "conv-1",
    text: "run here",
  });
  assert.equal(codex.calls.at(-1)?.cwd, nestedDir);
}

async function testCdRejectsMissingDirectories() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-router-"));
  const { router } = createRouter("codex", { cwd: tempRoot });

  const response = await router.chat({
    conversationId: "conv-1",
    text: "/cd missing-dir",
  });

  assert.equal(response.text, `Directory not found:\n${path.join(tempRoot, "missing-dir")}`);
}

async function testEmptyResumeCommandShowsUsage() {
  const { codex, claude, router } = createRouter("codex");

  const response = await router.chat({
    conversationId: "conv-1",
    text: "/resume",
  });

  assert.equal(response.text, [
    "Usage:",
    "/resume latest",
    "/resume <sessionId>",
    "/resume codex latest",
    "/resume claude latest",
    "/resume codex <sessionId>",
    "/resume claude <sessionId>",
  ].join("\n"));
  assert.equal(codex.resumeCalls.length, 0);
  assert.equal(claude.resumeCalls.length, 0);
}

async function testResumeCommandSupportsExplicitSessionId() {
  const { claude, router } = createRouter("codex");

  await router.chat({
    conversationId: "conv-1",
    text: "/claude",
  });

  const response = await router.chat({
    conversationId: "conv-1",
    text: "/resume session-123",
  });

  assert.equal(response.text, [
    "Resumed Claude session.",
    "Session ID: session-123",
    "Source: explicit session id",
    `Working directory: ${process.cwd()}`,
  ].join("\n"));
  assert.equal(claude.resumeCalls.length, 1);
  assert.equal(claude.resumeCalls[0]?.sessionId, "session-123");
}

async function testSessionsCommandUsesCurrentModel() {
  const { codex, claude, router } = createRouter("codex");

  const response = await router.chat({
    conversationId: "conv-1",
    text: "/sessions",
  });

  assert.equal(response.text, [
    "Recent Codex sessions (latest 5):",
    "1. codex-session-1",
    "Updated: 2026-03-30T10:00:00.000Z",
    "Title: codex title 1",
    "CWD: E:\\workspace\\codex",
    "2. codex-session-2",
    "Updated: 2026-03-29T10:00:00.000Z",
    "CWD: E:\\workspace\\codex",
  ].join("\n"));
  assert.deepEqual(codex.listSessionsCalls, [{ limit: 5 }]);
  assert.equal(claude.listSessionsCalls.length, 0);
}

async function testSessionsCommandSupportsExplicitModelWithoutSwitchingRoute() {
  const { codex, claude, router } = createRouter("claude");

  const response = await router.chat({
    conversationId: "conv-1",
    text: "/sessions codex",
  });

  assert.equal(response.text.split("\n")[0], "Recent Codex sessions (latest 5):");
  assert.deepEqual(codex.listSessionsCalls, [{ limit: 5 }]);
  assert.equal(claude.listSessionsCalls.length, 0);

  const followUp = await router.chat({
    conversationId: "conv-1",
    text: "still claude",
  });

  assert.equal(followUp.text, "claude:still claude");
}

async function testDoCommandUsesCurrentModel() {
  const { claude, router } = createRouter("claude");

  const response = await router.chat({
    conversationId: "conv-1",
    text: "/do",
  });

  assert.equal(response.text, "Claude plan approved. Continuing execution.");
  assert.deepEqual(claude.approvePendingPermissionCalls, [
    { conversationId: "conv-1", optionIndex: undefined },
  ]);
}

async function testUndoCommandUsesCurrentModel() {
  const { claude, router } = createRouter("claude");

  const response = await router.chat({
    conversationId: "conv-1",
    text: "/undo",
  });

  assert.equal(response.text, "Claude plan rejected. Staying in plan mode.");
  assert.deepEqual(claude.rejectPendingPermissionCalls, [
    { conversationId: "conv-1", optionIndex: undefined },
  ]);
}

async function testResumeCommandCanTargetAnotherModelAndSwitchRoute() {
  const { codex, claude, router } = createRouter("claude");

  const response = await router.chat({
    conversationId: "conv-1",
    text: "/resume codex codex-session-456",
  });

  assert.equal(response.text, [
    "Resumed Codex session.",
    "Session ID: codex-session-456",
    "Source: explicit session id",
    `Working directory: ${process.cwd()}`,
  ].join("\n"));
  assert.equal(codex.resumeCalls.length, 1);
  assert.equal(codex.resumeCalls[0]?.sessionId, "codex-session-456");
  assert.equal(claude.resumeCalls.length, 0);

  const followUp = await router.chat({
    conversationId: "conv-1",
    text: "continue here",
  });

  assert.equal(followUp.text, "codex:continue here");
}

async function testResumeCommandSupportsExplicitModelLatest() {
  const { claude, router } = createRouter("codex");

  const response = await router.chat({
    conversationId: "conv-1",
    text: "/resume claude latest",
  });

  assert.equal(response.text, [
    "Resumed Claude session.",
    "Session ID: claude-saved-session",
    "Source: latest session in current working directory",
    `Working directory: ${process.cwd()}`,
    "Title: claude latest",
  ].join("\n"));
  assert.equal(claude.resumeCalls.length, 1);
  assert.equal(claude.resumeCalls[0]?.latest, true);
}

async function testPlanCommandSwitchesClaudeToPlanMode() {
  const { claude, router } = createRouter("claude");

  const response = await router.chat({
    conversationId: "conv-1",
    text: "/plan",
  });

  assert.equal(response.text, [
    "Claude switched to plan mode for this chat.",
    "Mode ID: plan",
    "Session ID: claude-plan-session",
    "Mode: Plan Mode",
    "When the plan is ready, reply `/do` to execute or `/undo` to keep planning.",
  ].join("\n"));
  assert.deepEqual(claude.setSessionModeCalls, [
    {
      conversationId: "conv-1",
      cwd: process.cwd(),
      modeId: "plan",
    },
  ]);
}

async function testPlanCommandEnablesSoftPlanningForCodex() {
  const { codex, router } = createRouter("codex");

  const response = await router.chat({
    conversationId: "conv-1",
    text: "/plan",
  });

  assert.equal(response.text, [
    "Codex planning mode enabled for this chat.",
    "Your next request will return a plan only.",
    "Reply `/do` to execute that plan or `/undo` to discard it.",
  ].join("\n"));
  assert.equal(codex.setSessionModeCalls.length, 0);

  const planResponse = await router.chat({
    conversationId: "conv-1",
    text: "implement login",
  });
  assert.match(planResponse.text ?? "", /^Codex plan:/);
  assert.match(planResponse.text ?? "", /Reply `\/do` to execute this plan or `\/undo` to discard it\./);
  assert.match(codex.calls.at(-1)?.text ?? "", /Planning mode is enabled for this chat\./);
}

async function testUnplanCommandDisablesSoftPlanningForCodex() {
  const { codex, router } = createRouter("codex");

  await router.chat({
    conversationId: "conv-1",
    text: "/plan",
  });

  const response = await router.chat({
    conversationId: "conv-1",
    text: "/unplan",
  });

  assert.equal(response.text, [
    "Codex switched back to default mode for this chat.",
    "Mode ID: default",
    "Session ID: soft-plan",
    "Mode: Default",
  ].join("\n"));

  await router.chat({
    conversationId: "conv-1",
    text: "继续执行",
  });
  assert.equal(codex.calls.at(-1)?.text, "继续执行");
}

async function testUnplanCommandSwitchesClaudeBackToDefaultMode() {
  const { claude, router } = createRouter("claude");

  await router.chat({
    conversationId: "conv-1",
    text: "/plan",
  });

  const response = await router.chat({
    conversationId: "conv-1",
    text: "/unplan",
  });

  assert.equal(response.text, [
    "Claude switched back to default mode for this chat.",
    "Mode ID: default",
    "Session ID: claude-plan-session",
    "Mode: Default",
  ].join("\n"));
  assert.deepEqual(claude.setSessionModeCalls, [
    {
      conversationId: "conv-1",
      cwd: process.cwd(),
      modeId: "plan",
    },
    {
      conversationId: "conv-1",
      cwd: process.cwd(),
      modeId: "default",
    },
  ]);
}

async function testDoCommandResumesClaudePlanExecution() {
  const { claude, router } = createRouter("claude");

  await router.chat({
    conversationId: "conv-1",
    text: "/plan",
  });

  const response = await router.chat({
    conversationId: "conv-1",
    text: "/do",
  });

  assert.equal(response.text, "Claude plan approved. Continuing execution.");
  assert.deepEqual(claude.approvePendingPermissionCalls, [
    { conversationId: "conv-1", optionIndex: undefined },
  ]);
}

async function testDoCommandExecutesPendingCodexPlan() {
  const { codex, router } = createRouter("codex");

  await router.chat({
    conversationId: "conv-1",
    text: "/plan",
  });
  await router.chat({
    conversationId: "conv-1",
    text: "show me a plan",
  });

  const response = await router.chat({
    conversationId: "conv-1",
    text: "/do",
  });

  assert.equal(response.text, "codex:show me a plan");
  assert.equal(codex.calls.at(-1)?.text, "show me a plan");
}

async function testPlainMessagesUseStartupDefaultModel() {
  const { codex, claude, router } = createRouter("codex");

  const response = await router.chat({
    conversationId: "conv-1",
    text: "hello",
  });

  assert.equal(response.text, "codex:hello");
  assert.equal(codex.calls.length, 1);
  assert.equal(claude.calls.length, 0);
}

async function testSlashCommandsSwitchTheActiveModel() {
  const { codex, claude, router } = createRouter("codex");

  const switchResponse = await router.chat({
    conversationId: "conv-1",
    text: "/claude",
  });
  const regularResponse = await router.chat({
    conversationId: "conv-1",
    text: "follow up",
  });

  assert.equal(switchResponse.text, "Switched this chat to Claude.");
  assert.equal(regularResponse.text, "claude:follow up");
  assert.equal(codex.calls.length, 0);
  assert.equal(claude.calls.length, 1);
}

async function testInlineSlashCommandsSwitchAndForward() {
  const { codex, claude, router } = createRouter("claude");

  const response = await router.chat({
    conversationId: "conv-1",
    text: "/codex   fix the bug   ",
  });

  assert.equal(response.text, "codex:fix the bug");
  assert.equal(codex.calls.length, 1);
  assert.equal(codex.calls[0]?.text, "fix the bug");
  assert.equal(claude.calls.length, 0);
}

async function testDifferentConversationsKeepIndependentRouting() {
  const { codex, claude, router } = createRouter("codex");

  await router.chat({
    conversationId: "conv-1",
    text: "/claude",
  });
  await router.chat({
    conversationId: "conv-1",
    text: "for claude",
  });
  await router.chat({
    conversationId: "conv-2",
    text: "for codex",
  });

  assert.equal(claude.calls.length, 1);
  assert.equal(claude.calls[0]?.conversationId, "conv-1");
  assert.equal(codex.calls.length, 1);
  assert.equal(codex.calls[0]?.conversationId, "conv-2");
}

async function testClearSessionOnlyClearsCurrentModel() {
  const { codex, claude, router } = createRouter("codex");

  await router.chat({
    conversationId: "conv-1",
    text: "/claude",
  });

  router.clearSession("conv-1");

  const response = await router.chat({
    conversationId: "conv-1",
    text: "after clear",
  });

  assert.deepEqual(codex.clearedConversationIds, []);
  assert.deepEqual(claude.clearedConversationIds, ["conv-1"]);
  assert.equal(response.text, "claude:after clear");
}

const tests = [
  ["builtin commands resolve from installed packages", testBuiltinCommandsResolveFromInstalledPackages],
  ["pwd and cd commands track conversation working directory", testPwdAndCdCommandsTrackConversationWorkingDirectory],
  ["cd rejects missing directories", testCdRejectsMissingDirectories],
  ["sessions command uses current model", testSessionsCommandUsesCurrentModel],
  ["sessions command supports explicit model without switching route", testSessionsCommandSupportsExplicitModelWithoutSwitchingRoute],
  ["do command uses current model", testDoCommandUsesCurrentModel],
  ["undo command uses current model", testUndoCommandUsesCurrentModel],
  ["empty resume command shows usage", testEmptyResumeCommandShowsUsage],
  ["resume command supports explicit session id", testResumeCommandSupportsExplicitSessionId],
  ["resume command can target another model and switch route", testResumeCommandCanTargetAnotherModelAndSwitchRoute],
  ["resume command supports explicit model latest", testResumeCommandSupportsExplicitModelLatest],
  ["plan command switches Claude to plan mode", testPlanCommandSwitchesClaudeToPlanMode],
  ["plan command enables soft planning for Codex", testPlanCommandEnablesSoftPlanningForCodex],
  ["unplan command disables soft planning for Codex", testUnplanCommandDisablesSoftPlanningForCodex],
  ["unplan command switches Claude back to default mode", testUnplanCommandSwitchesClaudeBackToDefaultMode],
  ["do command resumes Claude plan execution", testDoCommandResumesClaudePlanExecution],
  ["do command executes pending Codex plan", testDoCommandExecutesPendingCodexPlan],
  ["plain messages use the startup default model", testPlainMessagesUseStartupDefaultModel],
  ["slash commands switch the active model", testSlashCommandsSwitchTheActiveModel],
  ["inline slash commands switch and forward", testInlineSlashCommandsSwitchAndForward],
  ["different conversations keep independent routing", testDifferentConversationsKeepIndependentRouting],
  ["clearSession only clears the current model", testClearSessionOnlyClearsCurrentModel],
];

for (const [name, run] of tests) {
  await run();
  console.log(`ok - ${name}`);
}
