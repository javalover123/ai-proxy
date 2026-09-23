import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AiRequestMeta,
  AiSessionState,
  AiSessionSummary,
  AiTimelineTurnDto,
  AiUsage,
  TimelineItem,
} from "@/types/ai";
import { type AiEvent, subscribeAiEvents } from "./aiEventBus";

/** 空 usage */
const EMPTY_USAGE: AiUsage = {};

/** 单会话时间线条目数上限（与后端 SessionStore 的 500 条对齐） */
const MAX_TIMELINE = 500;

/** 缓存的 timeline 数上限：超出后 LRU 淘汰最久未用的（可从 DB 重新拉取） */
const MAX_CACHED_TIMELINES = 30;

/**
 * 消费后端 `ai_timeline` / `ai_session` 事件 + DB 查询，维护 AI 会话。
 * 半拉取模型：
 * - 历史会话元信息：启动时 `list_ai_sessions` 一次拉取（不含 turns，轻量）。
 * - 历史 timeline：选中会话时按需 `get_ai_session` 拉取（DB 已去重、已剥 thinking）。
 * - 实时：`ai_timeline` delta（增量）机械 apply + snapshot（finalize 整条替换），
 *   前端不做 LCP 去重。
 */
export function useAiSessions() {
  const sessionsRef = useRef<Map<string, AiSessionState>>(new Map());
  /** sessionId → 已合并的 timeline（历史会话选中时拉取；live 会话实时累积） */
  const timelinesRef = useRef<Map<string, TimelineItem[]>>(new Map());
  /** requestId → sessionId，便于 requestMetaOf 快速定位 */
  const reqToSessionRef = useRef<Map<number, string>>(new Map());
  /** timeline LRU：越靠后越新，用于淘汰 */
  const timelineOrderRef = useRef<string[]>([]);
  /** 正在加载 timeline 的 session（避免重复请求） */
  const loadingRef = useRef<Set<string>>(new Set());
  const [, setTick] = useState(0);

  // rAF 合批：流式高频 ai_timeline 落同一帧刷新
  const rafRef = useRef<number | null>(null);
  const scheduleUpdate = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setTick((t) => t + 1);
    });
  }, []);

  const touchTimelineLru = useCallback((sid: string) => {
    const idx = timelineOrderRef.current.indexOf(sid);
    if (idx !== -1) timelineOrderRef.current.splice(idx, 1);
    timelineOrderRef.current.push(sid);
  }, []);

  const evictTimelineIfNeeded = useCallback(() => {
    while (timelinesRef.current.size > MAX_CACHED_TIMELINES) {
      const victim = timelineOrderRef.current.shift();
      if (!victim) break;
      timelinesRef.current.delete(victim);
    }
  }, []);

  /** 拉取某会话的历史 timeline（DB 已去重）。live 已建立则以 live 为准，不覆盖。 */
  const loadTimeline = useCallback(
    (sessionId: string) => {
      if (timelinesRef.current.has(sessionId) || loadingRef.current.has(sessionId)) return;
      loadingRef.current.add(sessionId);
      invoke<AiTimelineTurnDto[]>("get_ai_session", { sessionId })
        .then((turns) => {
          if (!timelinesRef.current.has(sessionId)) {
            const tl: TimelineItem[] = turns.map((t) => ({
              requestId: t.requestId,
              turn: { role: t.role, content: t.content },
              fingerprint: t.fingerprint,
            }));
            timelinesRef.current.set(sessionId, tl);
            timelineOrderRef.current.push(sessionId);
            evictTimelineIfNeeded();
          }
          scheduleUpdate();
        })
        .catch(() => {})
        .finally(() => {
          loadingRef.current.delete(sessionId);
        });
    },
    [evictTimelineIfNeeded, scheduleUpdate],
  );

  // 启动：从 DB 拉取历史会话列表（元信息，不含 turns）。
  useEffect(() => {
    let cancelled = false;
    invoke<AiSessionSummary[]>("list_ai_sessions")
      .then((summaries) => {
        if (cancelled) return;
        const map = sessionsRef.current;
        for (const s of summaries) {
          const prev = map.get(s.sessionId);
          // live 先于 list 返回时：DB 只回填缺失项，不覆盖更新的 live 状态
          const requests: Record<number, AiRequestMeta> = prev ? { ...prev.requests } : {};
          for (const r of s.requests) {
            if (!requests[r.id]) requests[r.id] = r;
          }
          const requestIds = prev ? [...prev.requestIds] : [];
          for (const rid of s.requestIds) {
            if (!requestIds.includes(rid)) requestIds.push(rid);
            reqToSessionRef.current.set(rid, s.sessionId);
          }
          map.set(s.sessionId, {
            sessionId: s.sessionId,
            scopeHost: prev?.scopeHost || s.scopeHost,
            title: prev?.title ?? s.title,
            requestIds,
            usageTotal:
              prev && Object.keys(prev.usageTotal).length > 0 ? prev.usageTotal : (s.usageTotal ?? EMPTY_USAGE),
            matchReason: prev?.matchReason || s.matchReason,
            source: prev?.source ?? s.source,
            requests,
          });
        }
        scheduleUpdate();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [scheduleUpdate]);

  useEffect(() => {
    const handle = (event: AiEvent) => {
      const map = sessionsRef.current;

      if (event.type === "ai_session") {
        const prev = map.get(event.session_id);
        map.set(event.session_id, {
          sessionId: event.session_id,
          scopeHost: event.scope_host,
          // 后端某次事件缺 title 字段时不闪回旧值
          title: event.title ?? prev?.title,
          requestIds: event.request_ids,
          usageTotal: event.usage_total ?? EMPTY_USAGE,
          matchReason: event.match_reason,
          source: event.source ?? prev?.source,
          requests: prev?.requests ?? {},
        });
        for (const rid of event.request_ids) {
          reqToSessionRef.current.set(rid, event.session_id);
        }
        scheduleUpdate();
        return;
      }

      // ai_timeline：delta（流式/请求侧增量）或 snapshot（finalize 整条快照）
      const sid = event.session_id;
      const rid = event.request_id;
      reqToSessionRef.current.set(rid, sid);
      let sess = map.get(sid);
      if (!sess) {
        // ai_timeline 先于 ai_session 到达时的占位
        sess = {
          sessionId: sid,
          scopeHost: "",
          requestIds: [rid],
          usageTotal: EMPTY_USAGE,
          matchReason: "",
          requests: {},
        };
        map.set(sid, sess);
      }
      if (!sess.requestIds.includes(rid)) {
        sess.requestIds = [...sess.requestIds, rid];
      }
      sess.requests = {
        ...sess.requests,
        [rid]: {
          id: rid,
          streaming: event.streaming,
          model: event.model,
          finishReason: event.finish_reason,
          terminated: event.terminated,
          firstChunkMs: event.first_chunk_ms,
          durationMs: event.duration_ms,
          startMs: event.start_ms,
          usage: event.usage,
        },
      };

      let tl = timelinesRef.current.get(sid);
      if (!tl) {
        tl = [];
        timelinesRef.current.set(sid, tl);
        timelineOrderRef.current.push(sid);
      } else {
        touchTimelineLru(sid);
      }

      if (event.snapshot) {
        // 全量快照：整体替换（自愈，覆盖任何漏掉的流式增量）
        tl.length = 0;
        for (const t of event.turns) {
          tl.push({ requestId: t.requestId, turn: { role: t.role, content: t.content }, fingerprint: t.fingerprint });
        }
      } else {
        // 增量：移除本次 request_id 的旧条目，再追加（请求侧 user turns / 流式 assistant turns）
        for (let i = tl.length - 1; i >= 0; i--) {
          if (tl[i].requestId === rid) tl.splice(i, 1);
        }
        for (const t of event.turns) {
          tl.push({ requestId: t.requestId, turn: { role: t.role, content: t.content }, fingerprint: t.fingerprint });
        }
        if (tl.length > MAX_TIMELINE) {
          tl.splice(0, tl.length - MAX_TIMELINE);
        }
      }
      evictTimelineIfNeeded();
      scheduleUpdate();
    };
    return subscribeAiEvents(handle);
  }, [scheduleUpdate, touchTimelineLru, evictTimelineIfNeeded]);

  const sessions = Array.from(sessionsRef.current.values());

  /**
   * 读取某会话的合并时间线。未加载时触发 DB 拉取并返回空（加载完成后重渲染）。
   * 刻意不用 useCallback：读的是 timelinesRef（非响应式），让身份每帧变化，
   * 使 AiView 的 rendered useMemo 在时间线变化后能重算。
   */
  const mergedTimeline = (sessionId: string): TimelineItem[] => {
    const tl = timelinesRef.current.get(sessionId);
    if (tl) return tl;
    loadTimeline(sessionId);
    return [];
  };

  /** 某请求的归一化元信息 */
  const requestMetaOf = useCallback((requestId: number): AiRequestMeta | undefined => {
    const sid = reqToSessionRef.current.get(requestId);
    if (!sid) return undefined;
    return sessionsRef.current.get(sid)?.requests[requestId];
  }, []);

  /** 前端移除整个会话（不通知后端；同会话后续新流量会让其重新出现） */
  const removeSession = useCallback(
    (sessionId: string) => {
      const sess = sessionsRef.current.get(sessionId);
      if (!sess) return;
      for (const rid of sess.requestIds) {
        reqToSessionRef.current.delete(rid);
      }
      sessionsRef.current.delete(sessionId);
      timelinesRef.current.delete(sessionId);
      const lruIdx = timelineOrderRef.current.indexOf(sessionId);
      if (lruIdx !== -1) timelineOrderRef.current.splice(lruIdx, 1);
      scheduleUpdate();
    },
    [scheduleUpdate],
  );

  /** 前端移除会话内单次请求；删空后连同会话一起移除 */
  const removeRequest = useCallback(
    (sessionId: string, requestId: number) => {
      const sess = sessionsRef.current.get(sessionId);
      if (!sess) return;
      reqToSessionRef.current.delete(requestId);
      const rest = sess.requestIds.filter((rid) => rid !== requestId);
      if (rest.length === 0) {
        sessionsRef.current.delete(sessionId);
        timelinesRef.current.delete(sessionId);
        const lruIdx = timelineOrderRef.current.indexOf(sessionId);
        if (lruIdx !== -1) timelineOrderRef.current.splice(lruIdx, 1);
      } else {
        sess.requestIds = rest;
        const requests = { ...sess.requests };
        delete requests[requestId];
        sess.requests = requests;
      }
      scheduleUpdate();
    },
    [scheduleUpdate],
  );

  /** 清空所有 AI 会话（前端状态；不通知后端，同 clear 流量一致） */
  const clearAll = useCallback(() => {
    sessionsRef.current.clear();
    timelinesRef.current.clear();
    reqToSessionRef.current.clear();
    timelineOrderRef.current = [];
    scheduleUpdate();
  }, [scheduleUpdate]);

  return { sessions, mergedTimeline, requestMetaOf, removeSession, removeRequest, clearAll };
}
