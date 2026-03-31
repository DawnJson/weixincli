#!/usr/bin/env node

import { isLoggedIn, login, logout, start } from "./src/vendor/weixin-agent-sdk/index.js";

import { RouterAgent, type SupportedModel } from "./index.js";

const MODEL_ALIASES: Record<string, SupportedModel> = {
  claude: "claude",
  "claude-code": "claude",
  codex: "codex",
};

const [command, ...commandArgs] = process.argv.slice(2);

async function ensureLoggedIn() {
  if (!isLoggedIn()) {
    console.log("No WeChat login found. Scan the QR code to continue.\n");
    await login();
  }
}

function printUsage() {
  console.log(`weixin-acp-router - WeChat router for Codex and Claude

Usage:
  npx weixin-acp-router login
  npx weixin-acp-router logout
  npx weixin-acp-router codex
  npx weixin-acp-router codex resume <sessionId>
  npx weixin-acp-router claude
  npx weixin-acp-router claude resume <sessionId>

WeChat commands:
  /help
  /codex
  /codex <message>
  /claude
  /claude <message>
  /cd <path>
  /pwd
  /sessions
  /sessions codex
  /sessions claude
  /plan
  /do
  /undo
  /unplan
  /resume latest
  /resume <sessionId>
  /resume codex <sessionId>
  /resume claude <sessionId>`);
}

async function startRouter(defaultModel: SupportedModel, startupResumeSessionId?: string) {
  await ensureLoggedIn();

  const agent = new RouterAgent({
    claudeStartupResumeSessionId:
      defaultModel === "claude" ? startupResumeSessionId : undefined,
    codexStartupResumeSessionId:
      defaultModel === "codex" ? startupResumeSessionId : undefined,
    cwd: process.cwd(),
    defaultModel,
  });

  const ac = new AbortController();
  process.on("SIGINT", () => {
    console.log("\nStopping...");
    agent.dispose();
    ac.abort();
  });
  process.on("SIGTERM", () => {
    agent.dispose();
    ac.abort();
  });

  await start(agent, { abortSignal: ac.signal });
}

async function main() {
  if (command === "login") {
    await login();
    return;
  }

  if (command === "logout") {
    logout();
    return;
  }

  const defaultModel = command ? MODEL_ALIASES[command] : undefined;
  if (defaultModel) {
    const wantsResume = commandArgs[0]?.toLowerCase() === "resume";
    if (wantsResume && !commandArgs[1]) {
      throw new Error(
        `Startup resume requires an explicit session id.\nUsage: npx weixin-acp-router ${defaultModel} resume <sessionId>`,
      );
    }
    await startRouter(defaultModel, wantsResume ? commandArgs[1] : undefined);
    return;
  }

  printUsage();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
