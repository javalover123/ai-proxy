// src/types/collection.ts

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type BodyType = "none" | "auto" | "json" | "xml" | "text" | "urlencoded" | "multipart";

// ── IPC body：发送给后端的结构化请求体 ─────────────────────────────────────

/**
 * 发送请求时的 body 参数（tagged union）。
 * 用 `mode` 做 discriminator，不同类型携带不同的字段，
 * 消除旧设计中游离的 `bodyType: string` 参数。
 */
export type RequestBody =
  | { mode: "raw"; content: string; language?: "json" | "xml" | "text" | "urlencoded" }
  | { mode: "formData"; parts: FormDataPart[] }
  | null;

// FormDataPart 仅用于 IPC 的 multipart/form-data 传参
export interface FormDataPart {
  key: string;
  value: string;
  partType: "text" | "file";
}

export type KeyValueType = "string" | "integer" | "bool" | "array" | "object" | "file";

export interface KeyValuePair {
  key: string;
  value: string;
  /** Whether this entry is enabled for transmission (default true). Disabled entries are kept in
   *  the editor but excluded from send/save/curl export. */
  enabled?: boolean;
  /** Value type hint (editor metadata only). Defaults to "string" when absent. */
  type?: KeyValueType;
  /** Free-form note/remark (editor metadata only). */
  description?: string;
}

export interface ApiCollection {
  id: number;
  name: string;
  children: ApiTreeNode[];
  createdAt: number;
  updatedAt: number;
}

export interface ApiFolderNode {
  id: number;
  type: "folder";
  name: string;
  children: ApiTreeNode[];
}

export interface ApiRequestNode {
  id: number;
  type: "request";
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValuePair[];
  headers: KeyValuePair[];
  cookies: KeyValuePair[];
  bodyType: BodyType;
  body: string;
  authType?: string;
  authData?: string;
  requestId?: number;
}

export type ApiTreeNode = ApiFolderNode | ApiRequestNode;

/** Subset of RequestTab fields that constitute saved request data */
export interface RequestTabSavedData {
  method: HttpMethod;
  url: string;
  params: KeyValuePair[];
  headers: KeyValuePair[];
  cookies: KeyValuePair[];
  bodyType: BodyType;
  body: string;
  authType: string;
  authData: string;
}

export interface RequestTab {
  id: string;
  name: string;
  linkedNodeId: number | null;
  dirty: boolean;
  /** Last saved data snapshot — dirty=false when current fields match this; null for unlinked tabs */
  savedData: RequestTabSavedData | null;
  method: HttpMethod;
  url: string;
  params: KeyValuePair[];
  headers: KeyValuePair[];
  cookies: KeyValuePair[];
  bodyType: BodyType;
  body: string;
  authType: string;
  authData: string;
  responseEntryId: number | null;
  sending: boolean;
  error: string;
}
