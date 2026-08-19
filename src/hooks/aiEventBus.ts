/** 轻量模块级事件总线：`useProxyEvents` 收到 AI 事件后 publish，
 *  `useAiSessions` subscribe。避免对同一 Tauri Channel 双重订阅。 */
import type { ProxyEvent } from '@/types/proxy'

/** 仅 AI 相关事件在总线上流转 */
export type AiEvent = Extract<ProxyEvent, { type: 'ai_timeline' | 'ai_session' }>

type Listener = (event: AiEvent) => void

const listeners = new Set<Listener>()

/** 发布一个 AI 事件到所有订阅者（由 useProxyEvents 调用） */
export function publishAiEvent(event: AiEvent): void {
  for (const l of listeners) l(event)
}

/** 订阅 AI 事件，返回取消订阅函数（由 useAiSessions 调用） */
export function subscribeAiEvents(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
