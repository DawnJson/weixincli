// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/api/types.ts)
/**
 * 微信协议类型定义，对应 proto 中的 GetUpdatesReq/Resp、WeixinMessage、SendMessageReq 等结构。
 * API 通过 HTTP 传输 JSON，原本的 bytes 字段在 JSON 中以 base64 字符串表示。
 */

/** 每个 CGI 请求都会附带的公共元信息。 */
export interface BaseInfo {
  channel_version?: string;
}

/** proto 中的 `UploadMediaType`。 */
export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;

export interface GetUploadUrlReq {
  filekey?: string;
  /** proto 字段 2：`media_type`，取值见 `UploadMediaType`。 */
  media_type?: number;
  to_user_id?: string;
  /** 原文件明文大小。 */
  rawsize?: number;
  /** 原文件明文 MD5。 */
  rawfilemd5?: string;
  /** 原文件密文大小（AES-128-ECB 加密后）。 */
  filesize?: number;
  /** 缩略图明文大小（IMAGE/VIDEO 时必填）。 */
  thumb_rawsize?: number;
  /** 缩略图明文 MD5（IMAGE/VIDEO 时必填）。 */
  thumb_rawfilemd5?: string;
  /** 缩略图密文大小（IMAGE/VIDEO 时必填）。 */
  thumb_filesize?: number;
  /** 是否不需要缩略图上传 URL，默认 `false`。 */
  no_need_thumb?: boolean;
  /** 加密 key。 */
  aeskey?: string;
}

export interface GetUploadUrlResp {
  /** 原图上传加密参数。 */
  upload_param?: string;
  /** 缩略图上传加密参数；无缩略图时为空。 */
  thumb_upload_param?: string;
  /** 完整上传 URL，由服务端直接返回，无需客户端自行拼接。 */
  upload_full_url?: string;
}

export const MessageType = {
  NONE: 0,
  USER: 1,
  BOT: 2,
} as const;

export const MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;

export interface TextItem {
  text?: string;
}

/** CDN 媒体引用；JSON 中的 `aes_key` 以 base64 字符串表示。 */
export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  /** 加密类型：0=只加密 fileid，1=打包缩略图、中图等信息。 */
  encrypt_type?: number;
  /** 完整下载 URL，由服务端直接返回，无需客户端自行拼接。 */
  full_url?: string;
}

export interface ImageItem {
  /** 原图 CDN 引用。 */
  media?: CDNMedia;
  /** 缩略图 CDN 引用。 */
  thumb_media?: CDNMedia;
  /** 原始 AES-128 key 的十六进制字符串（16 字节），入站解密时优先于 `media.aes_key` 使用。 */
  aeskey?: string;
  url?: string;
  mid_size?: number;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
  hd_size?: number;
}

export interface VoiceItem {
  media?: CDNMedia;
  /** 语音编码类型：1=pcm 2=adpcm 3=feature 4=speex 5=amr 6=silk 7=mp3 8=ogg-speex。 */
  encode_type?: number;
  bits_per_sample?: number;
  /** 采样率（Hz）。 */
  sample_rate?: number;
  /** 语音时长（毫秒）。 */
  playtime?: number;
  /** 语音转文字结果。 */
  text?: string;
}

export interface FileItem {
  media?: CDNMedia;
  file_name?: string;
  md5?: string;
  len?: string;
}

export interface VideoItem {
  media?: CDNMedia;
  video_size?: number;
  play_length?: number;
  video_md5?: string;
  thumb_media?: CDNMedia;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
}

export interface RefMessage {
  message_item?: MessageItem;
  title?: string; // 摘要
}

export interface MessageItem {
  type?: number;
  create_time_ms?: number;
  update_time_ms?: number;
  is_completed?: boolean;
  msg_id?: string;
  ref_msg?: RefMessage;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
}

/** 统一消息结构（proto: `WeixinMessage`），取代旧版拆分的 Message + MessageContent + FullMessage。 */
export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  update_time_ms?: number;
  delete_time_ms?: number;
  session_id?: string;
  group_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
}

/** `GetUpdates` 请求；JSON 中的 bytes 字段用 base64 字符串表示。 */
export interface GetUpdatesReq {
  /** @deprecated 仅为兼容保留，后续会移除。 */
  sync_buf?: string;
  /** 本地缓存的完整 context buf；没有时传 `""`（首次请求或重置之后）。 */
  get_updates_buf?: string;
}

/** `GetUpdates` 响应；JSON 中的 bytes 字段用 base64 字符串表示。 */
export interface GetUpdatesResp {
  ret?: number;
  /** 服务端返回的错误码，例如 `-14` 表示 session 超时；请求失败时会出现。 */
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  /** @deprecated 仅为兼容保留。 */
  sync_buf?: string;
  /** 需要本地缓存并在下次请求时带上的完整 context buf。 */
  get_updates_buf?: string;
  /** 服务端建议的下一次 `getUpdates` 长轮询超时时间（毫秒）。 */
  longpolling_timeout_ms?: number;
}

/** `SendMessage` 请求，内部包裹一条 `WeixinMessage`。 */
export interface SendMessageReq {
  msg?: WeixinMessage;
}

export interface SendMessageResp {
  // 空结构。
}

/** “正在输入”状态：1=typing（默认），2=cancel typing。 */
export const TypingStatus = {
  TYPING: 1,
  CANCEL: 2,
} as const;

/** `SendTyping` 请求，用于向用户发送“正在输入”状态。 */
export interface SendTypingReq {
  ilink_user_id?: string;
  typing_ticket?: string;
  /** 1=typing（默认），2=cancel typing。 */
  status?: number;
}

export interface SendTypingResp {
  ret?: number;
  errmsg?: string;
}

/** `GetConfig` 响应，包含 bot 配置及 `typing_ticket`。 */
export interface GetConfigResp {
  ret?: number;
  errmsg?: string;
  /** 供 `sendTyping` 使用的 base64 编码 `typing_ticket`。 */
  typing_ticket?: string;
}
