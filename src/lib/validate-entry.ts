// src/lib/validate-entry.ts — KeyValuePair 值的前端格式校验
// HTTP 线上都是字符串，type 只用于前端校验（编辑器行内提示 + 发送前拦截），不传给后端。
import type { KeyValueType } from "@/types/collection";

/**
 * 校验 value 是否符合 type 的格式约定。
 * @returns 非法的 i18n key（如 "requestEditor.validation.integer"），合法/空值返回 null。
 */
export function validateEntryType(type: KeyValueType | undefined, value: string): string | null {
  const v = value.trim();
  // 空值跳过，避免空字段一直标红
  if (!v) return null;

  switch (type) {
    case "integer":
      return /^-?\d+$/.test(v) ? null : "requestEditor.validation.integer";
    case "bool":
      return /^(true|false|1|0)$/i.test(v) ? null : "requestEditor.validation.bool";
    case "array":
      return isJsonArray(v) ? null : "requestEditor.validation.array";
    case "object":
      return isJsonObject(v) ? null : "requestEditor.validation.object";
    default:
      // string / file / undefined 不校验
      return null;
  }
}

function isJsonArray(v: string): boolean {
  try {
    return Array.isArray(JSON.parse(v));
  } catch {
    return false;
  }
}

function isJsonObject(v: string): boolean {
  try {
    const parsed: unknown = JSON.parse(v);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}
