import { Channel, invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProxyEvent, TrafficEntry } from "@/types/proxy";
import { publishAiEvent } from "./aiEventBus";

const MAX_CHUNKS = 2000;
const MAX_BODY_ACCUMULATE = 2 * 1024 * 1024;
/** entries 窗口上限：超出后 FIFO 删除最旧条目 */
const MAX_ENTRIES = 5000;
/** 到达此阈值时对最早一批条目做瘦身（清 body 降水印，保留元信息在列表可见） */
const SLIM_AT = 4000;
/** 每次瘦身处理的条目数 */
const SLIM_BATCH = 2000;

export function useProxyEvents() {
  const counterRef = useRef(0);
  const entriesRef = useRef<Map<number, TrafficEntry>>(new Map());
  /** FIFO 淘汰：记录插入顺序，用于定位最旧条目 */
  const insertionOrderRef = useRef<number[]>([]);
  const forceUpdateRef = useRef(0);
  const [, setTick] = useState(0);

  /** rAF 合批：同帧内多个事件只触发一次渲染 */
  const rafRef = useRef<number | null>(null);
  const scheduleUpdate = useCallback(() => {
    if (rafRef.current !== null) return; // 已有待刷新帧
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      forceUpdateRef.current += 1;
      setTick(forceUpdateRef.current);
    });
  }, []);

  /** 立即触发（clear 等用户操作需要即时反馈） */
  const triggerUpdate = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    forceUpdateRef.current += 1;
    setTick(forceUpdateRef.current);
  }, []);

  /**
   * 增量 chunk 字节计数：requestId → 已累积字节数。
   * 用于 MAX_BODY_ACCUMULATE 上限检查。
   */
  const chunkBytesRef = useRef<Map<number, number>>(new Map());

  /** 瘦身最早 SLIM_BATCH 条条目：清空 body/chunks/requestBody 释放内存，元信息保留。 */
  const slimOldest = useCallback(() => {
    const toSlim = insertionOrderRef.current.slice(0, SLIM_BATCH);
    for (const id of toSlim) {
      const entry = entriesRef.current.get(id);
      if (entry) {
        entry.responseChunks = [];
        entry.requestBody = null;
        chunkBytesRef.current.delete(id);
      }
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: subscribe once, uses refs
  useEffect(() => {
    const channel = new Channel<ProxyEvent>();
    channel.onmessage = (event: ProxyEvent) => {
      switch (event.type) {
        case "request": {
          const { id, method, uri, timestamp, headers, decrypted } = event;
          const query_params = "query_params" in event ? (event as any).query_params : undefined;
          counterRef.current += 1;

          // FIFO 淘汰：超出上限时删最旧条目
          if (entriesRef.current.size >= MAX_ENTRIES) {
            const oldest = insertionOrderRef.current.shift();
            if (oldest !== undefined) {
              chunkBytesRef.current.delete(oldest);
              entriesRef.current.delete(oldest);
            }
          }
          // 瘦身：达到 SLIM_AT 时清空最早一批的 body 释放内存
          if (entriesRef.current.size >= SLIM_AT) {
            slimOldest();
          }
          insertionOrderRef.current.push(id);

          entriesRef.current.set(id, {
            id,
            method,
            uri,
            requestNumber: counterRef.current,
            requestTimestamp: timestamp,
            requestHeaders: headers,
            requestBody: null,
            requestQuery: query_params,
            decrypted,
            requestContentType: event.content_type,
            status: null,
            responseTimestamp: null,
            durationMs: null,
            responseHeaders: null,
            responseChunks: [],
            responseContentType: undefined,
            error: null,
            terminated: null,
          });
          scheduleUpdate();
          break;
        }
        case "request_chunk": {
          const { id, chunk } = event;
          const entry = entriesRef.current.get(id);
          if (entry) {
            if (entry.requestBody === null) entry.requestBody = "";
            if (entry.requestBody.length < MAX_BODY_ACCUMULATE) {
              entry.requestBody += chunk;
            }
          }
          scheduleUpdate();
          break;
        }
        case "response": {
          const { id, status, timestamp, duration_ms, headers } = event;
          const entry = entriesRef.current.get(id);
          if (entry) {
            entry.status = status;
            entry.responseTimestamp = timestamp;
            entry.durationMs = duration_ms;
            entry.responseHeaders = headers;
            entry.responseContentType = event.content_type;
          }
          scheduleUpdate();
          break;
        }
        case "response_chunk": {
          const { id, chunk } = event;
          const entry = entriesRef.current.get(id);
          if (entry) {
            const totalBytes = chunkBytesRef.current.get(id) ?? 0;
            // 上限检查：总字节 ≤ MAX_BODY_ACCUMULATE，条数 ≤ MAX_CHUNKS
            if (totalBytes < MAX_BODY_ACCUMULATE && entry.responseChunks.length < MAX_CHUNKS) {
              entry.responseChunks.push(chunk);
              chunkBytesRef.current.set(id, totalBytes + chunk.length);
            }
          }
          scheduleUpdate();
          break;
        }
        case "response_end": {
          const { id, terminated } = event;
          const entry = entriesRef.current.get(id);
          // 正常 EOS 不写标记，避免每条请求都触发一次即时刷新
          if (entry && terminated) {
            entry.terminated = terminated;
            triggerUpdate();
          }
          break;
        }
        case "error": {
          const { id, error } = event;
          const entry = entriesRef.current.get(id);
          if (entry) {
            entry.error = error;
          }
          triggerUpdate();
          break;
        }
        case "denied": {
          const { id, method, uri, timestamp, headers, query_params, decrypted, status, reason } = event;
          counterRef.current += 1;

          // FIFO 淘汰：超出上限时删最旧条目（与 request 分支同构）
          if (entriesRef.current.size >= MAX_ENTRIES) {
            const oldest = insertionOrderRef.current.shift();
            if (oldest !== undefined) {
              chunkBytesRef.current.delete(oldest);
              entriesRef.current.delete(oldest);
            }
          }
          if (entriesRef.current.size >= SLIM_AT) {
            slimOldest();
          }
          insertionOrderRef.current.push(id);

          // 被拒请求无对应 Request 事件，据此合成一条完整条目（不落库，仅实时可见）。
          entriesRef.current.set(id, {
            id,
            method,
            uri,
            requestNumber: counterRef.current,
            requestTimestamp: timestamp,
            requestHeaders: headers,
            requestBody: null,
            requestQuery: query_params,
            decrypted,
            requestContentType: undefined,
            status,
            responseTimestamp: null,
            durationMs: null,
            responseHeaders: null,
            responseChunks: [],
            responseContentType: undefined,
            error: null,
            terminated: null,
            denied: true,
            deniedReason: reason,
          });
          triggerUpdate();
          break;
        }
        case "ai_timeline":
        case "ai_session": {
          // AI 事件转发到独立总线，由 useAiSessions 消费；不污染 entries。
          publishAiEvent(event);
          break;
        }
      }
    };

    invoke("subscribe_proxy_events", { channel });
    return () => {
      // 卸载时取消挂起的 rAF，避免回调在卸载后触发 setState
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scheduleUpdate, slimOldest]);

  const entries = Array.from(entriesRef.current.values());

  const clear = useCallback(() => {
    entriesRef.current.clear();
    insertionOrderRef.current = [];
    counterRef.current = 0;
    chunkBytesRef.current.clear();
    triggerUpdate();
  }, [triggerUpdate]);

  return { entries, clear };
}
