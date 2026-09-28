import type { AiTimelineTurnDto, AiUsage, TerminationReason } from "@/types/ai";

export type { TerminationReason };

export interface RequestEvent {
  id: number;
  method: string;
  uri: string;
  timestamp: number;
  headers: Record<string, string>;
  query_params?: Record<string, string>;
  decrypted: boolean;
  content_type?: string;
}

export interface ResponseEvent {
  id: number;
  status: number;
  timestamp: number;
  duration_ms: number;
  headers: Record<string, string>;
  content_type?: string;
}

export interface ResponseChunkEvent {
  id: number;
  chunk: string;
}

export interface ErrorEvent {
  id: number;
  error: string;
}

export interface RequestBodyChunkEvent {
  id: number;
  chunk: string;
}

export type ProxyEvent =
  | {
      type: "request";
      id: number;
      method: string;
      uri: string;
      timestamp: number;
      headers: Record<string, string>;
      decrypted: boolean;
      content_type?: string;
    }
  | { type: "request_chunk"; id: number; chunk: string }
  | {
      type: "response";
      id: number;
      status: number;
      timestamp: number;
      duration_ms: number;
      headers: Record<string, string>;
      content_type?: string;
    }
  | { type: "response_chunk"; id: number; chunk: string }
  | {
      type: "response_end";
      id: number;
      /** 缺省 = 正常 EOS；'error' = 上游流中途出错（body 残缺）；'aborted' = 下游未读完 */
      terminated?: TerminationReason;
    }
  | { type: "error"; id: number; error: string }
  | {
      type: "denied";
      id: number;
      method: string;
      uri: string;
      timestamp: number;
      headers: Record<string, string>;
      query_params: Record<string, string>;
      decrypted: boolean;
      status: number;
      reason: string;
    }
  | {
      type: "ai_timeline";
      session_id: string;
      request_id: number;
      /** true = 整条去重 timeline 快照（finalize）；false = 本次请求增量 turns */
      snapshot: boolean;
      turns: AiTimelineTurnDto[];
      streaming: boolean;
      model?: string;
      finish_reason?: string;
      /** 代理侧观测到的异常终止；与 finish_reason 分开，后者只装上游说的话 */
      terminated?: TerminationReason;
      first_chunk_ms?: number;
      duration_ms?: number;
      start_ms?: number;
      usage?: AiUsage;
    }
  | {
      type: "ai_session";
      session_id: string;
      scope_host: string;
      request_ids: number[];
      usage_total: AiUsage;
      match_reason: string;
      /** 会话标题：来自首请求响应的 {"title": "..."}，无则缺省 */
      title?: string;
      /** 来源归属：规则内 (来源, 合并头) 对的头命中时为对应来源名，无则缺省 */
      source?: string;
    };

/** 从 AI 视图跳转到代理视图时下发的指令。nonce 自增确保重复跳同一 id 也能重触发。 */
export interface ProxyJumpTarget {
  id: number;
  nonce: number;
}

export interface TrafficEntry {
  id: number;
  method: string;
  uri: string;
  requestNumber: number;
  requestTimestamp: number;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  requestQuery?: Record<string, string>;
  requestContentType?: string;
  status: number | null;
  responseTimestamp: number | null;
  durationMs: number | null;
  responseHeaders: Record<string, string> | null;
  /** 响应体 chunks（字符串数组）。非流式为单元素数组。body = chunks.join('') */
  responseChunks: string[];
  responseContentType?: string;
  error: string | null;
  /** 响应流异常终止原因；null = 正常 EOS。error 表示整个请求失败，本字段表示 body 没走完 */
  terminated: TerminationReason | null;
  decrypted?: boolean;
  /** extAuthz 授权拒绝（不落库，仅实时列表可见） */
  denied?: boolean;
  deniedReason?: string;
}
