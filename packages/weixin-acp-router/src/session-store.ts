import fs from "node:fs";
import path from "node:path";

import { resolveStateDir } from "./vendor/weixin-agent-sdk/src/storage/state-dir.js";

type StoredSessionEntry = {
  conversationId: string;
  cwd: string;
  sessionId: string;
  updatedAt: string;
};

type SessionStoreData = {
  models: Partial<Record<"claude" | "codex", StoredSessionEntry[]>>;
  version: 1;
};

const STORE_FILE_PATH = path.join(resolveStateDir(), "weixin-acp-router", "session-store.json");

function createEmptyStore(): SessionStoreData {
  return {
    models: {},
    version: 1,
  };
}

function loadStore(): SessionStoreData {
  try {
    const raw = fs.readFileSync(STORE_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as SessionStoreData;
    if (parsed?.version === 1 && parsed.models) {
      return parsed;
    }
  } catch {
    // 文件不存在或格式非法时忽略，并按空存储重新开始。
  }

  return createEmptyStore();
}

function saveStore(data: SessionStoreData): void {
  fs.mkdirSync(path.dirname(STORE_FILE_PATH), { recursive: true });
  fs.writeFileSync(STORE_FILE_PATH, JSON.stringify(data, null, 2), "utf8");
}

export class SessionStore {
  constructor(private readonly model: "claude" | "codex") {}

  get(conversationId: string, cwd: string): StoredSessionEntry | undefined {
    return this.getEntries().find((entry) => entry.conversationId === conversationId && entry.cwd === cwd);
  }

  set(conversationId: string, cwd: string, sessionId: string): void {
    const data = loadStore();
    const entries = data.models[this.model] ?? [];
    const nextEntry: StoredSessionEntry = {
      conversationId,
      cwd,
      sessionId,
      updatedAt: new Date().toISOString(),
    };

    data.models[this.model] = [
      nextEntry,
      ...entries.filter((entry) => !(entry.conversationId === conversationId && entry.cwd === cwd)),
    ];

    saveStore(data);
  }

  private getEntries(): StoredSessionEntry[] {
    return loadStore().models[this.model] ?? [];
  }
}
