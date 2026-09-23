export type ViewId = "proxy" | "new-request" | "ai";

/** 脚本编辑器 tab 运行时信息 */
export interface ScriptTab {
  /** 唯一 key，对应 ScriptItem.file_name 或在 pre-save 时自动生成 */
  fileKey: string;
  /** tab 显示标签：有名称时显示脚本名；否则 "script-1"、"script-2"... */
  label: string;
  /** 脚本内容（本地草稿） */
  content: string;
  /** HTTP 方法（大写），空串 = any */
  method: string;
  /** 匹配域名 */
  domain: string;
  /** 是否有未保存修改 */
  dirty: boolean;
  /** 是否已持久化（有 file_name 且已保存过配置）。未持久化时保存需要先写配置 */
  saved: boolean;
}
