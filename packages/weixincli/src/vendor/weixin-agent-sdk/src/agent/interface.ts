// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/agent/interface.ts)
/**
 * Agent 接口，表示任何能够处理聊天消息的 AI 后端。
 *
 * 实现这个接口后，就可以把微信桥接到你自己的 AI 服务。
 * 微信桥接层会为每条入站消息调用 `chat()`，并把返回结果再发回用户。
 */

export interface Agent {
  /** 处理一条消息并返回回复。 */
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** 清理或重置指定会话的上下文。 */
  clearSession?(conversationId: string): void;
}

export interface ChatRequest {
  /** 会话或用户标识，用来维护每个用户自己的上下文。 */
  conversationId: string;
  /** 消息文本内容。 */
  text: string;
  /** 支持按会话维护 cwd 的后端可使用该工作目录。 */
  cwd?: string;
  /** 交互式权限请求所需的回复上下文。 */
  permissionContext?: {
    baseUrl: string;
    contextToken?: string;
    token?: string;
    to: string;
  };
  /** 附带的媒体文件，可以是图片、音频、视频或普通文件。 */
  media?: {
    type: "image" | "audio" | "video" | "file";
    /** 本地文件路径，文件已下载并完成解密。 */
    filePath: string;
    /** MIME 类型，例如 `image/jpeg`、`audio/wav`。 */
    mimeType: string;
    /** 原始文件名，仅文件附件场景可用。 */
    fileName?: string;
  };
}

export interface ChatResponse {
  /** 回复文本，可以包含 markdown，发送前会被转成纯文本。 */
  text?: string;
  /** 回复媒体文件。 */
  media?: {
    type: "image" | "video" | "file";
    /** 本地文件路径或 HTTPS URL。 */
    url: string;
    /** 文件名提示，主要用于文件附件。 */
    fileName?: string;
  };
}
