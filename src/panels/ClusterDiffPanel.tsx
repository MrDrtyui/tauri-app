import { AppIcon } from "../ui/AppIcon";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useIDEStore } from "../store/ideStore";

const AUTO_REFRESH_MS = 8000; // 8s for diff
const LOGS_REFRESH_MS = 3000; // 3s for logs

interface DiffRow {
  label: string;
  namespace: string;
  kind: string;
  desired: number;
  live: number;
  status: "ok" | "drift" | "missing" | "extra";
}

const STATUS_STYLES = {
  ok: {
    bg: "rgba(166,227,161,0.05)",
    text: "var(--ctp-green)",
    badge_bg: "rgba(166,227,161,0.10)",
    badge_border: "rgba(166,227,161,0.25)",
    label: "in sync",
  },
  drift: {
    bg: "rgba(249,226,175,0.05)",
    text: "var(--ctp-yellow)",
    badge_bg: "rgba(249,226,175,0.10)",
    badge_border: "rgba(249,226,175,0.25)",
    label: "drift",
  },
  missing: {
    bg: "rgba(243,139,168,0.06)",
    text: "var(--ctp-red)",
    badge_bg: "rgba(243,139,168,0.10)",
    badge_border: "rgba(243,139,168,0.25)",
    label: "missing",
  },
  extra: {
    bg: "rgba(250,179,135,0.05)",
    text: "var(--ctp-peach)",
    badge_bg: "rgba(250,179,135,0.10)",
    badge_border: "rgba(250,179,135,0.25)",
    label: "extra",
  },
};

export function ClusterDiffPanel() {
  const [filter, setFilter] = useState<"all" | "drift" | "missing" | "extra">(
    "all",
  );
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const nodes = useIDEStore((s) => s.nodes);
  const clusterStatus = useIDEStore((s) => s.clusterStatus);
  const refreshClusterStatus = useIDEStore((s) => s.refreshClusterStatus);

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshClusterStatus().catch(() => {});
    setRefreshing(false);
    setLastUpdated(new Date());
  }, [refreshClusterStatus]);

  useEffect(() => {
    doRefresh();
    const id = setInterval(doRefresh, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [doRefresh]);

  const diffRows: DiffRow[] = nodes.map((node) => {
    const live = clusterStatus?.fields.find((f) => f.label === node.label);
    const desiredReplicas = node.replicas ?? 1;
    const liveReplicas = live ? live.ready : 0;
    let status: DiffRow["status"] = "ok";
    if (!live || live.status === "red") status = "missing";
    else if (liveReplicas < desiredReplicas) status = "drift";
    else if (live.status === "yellow") status = "drift";
    return {
      label: node.label,
      namespace: node.namespace,
      kind: node.kind,
      desired: desiredReplicas,
      live: liveReplicas,
      status,
    };
  });

  if (clusterStatus) {
    for (const f of clusterStatus.fields) {
      if (!nodes.find((n) => n.label === f.label)) {
        diffRows.push({
          label: f.label,
          namespace: f.namespace,
          kind: "Unknown",
          desired: 0,
          live: f.ready,
          status: "extra",
        });
      }
    }
  }

  const filtered =
    filter === "all" ? diffRows : diffRows.filter((r) => r.status === filter);
  const driftCount = diffRows.filter((r) => r.status !== "ok").length;

  const filterBtns = ["all", "drift", "missing", "extra"] as const;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg-primary)",
        fontFamily: "var(--font-ui)",
        color: "var(--text-secondary)",
        fontSize: "var(--font-size-sm)",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 14px",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            color: "var(--text-secondary)",
            fontWeight: 500,
            fontSize: "var(--font-size-md)",
          }}
        >
          Cluster Diff
        </span>
        {driftCount > 0 && (
          <span
            style={{
              background: "rgba(249,226,175,0.10)",
              border: "1px solid rgba(249,226,175,0.25)",
              color: "var(--ctp-yellow)",
              fontSize: "var(--font-size-xs)",
              padding: "1px 7px",
              borderRadius: "var(--radius-full)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {driftCount} {driftCount === 1 ? "issue" : "issues"}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {filterBtns.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              background:
                filter === f ? "var(--bg-sidebar-active)" : "transparent",
              border: `1px solid ${filter === f ? "var(--border-accent)" : "var(--border-subtle)"}`,
              borderRadius: "var(--radius-xs)",
              color: filter === f ? "var(--accent-alt)" : "var(--text-faint)",
              fontSize: "var(--font-size-xs)",
              padding: "2px 8px",
              cursor: "pointer",
              fontFamily: "var(--font-ui)",
              transition: "var(--ease-fast)",
            }}
          >
            {f}
          </button>
        ))}
        {lastUpdated && (
          <span
            style={{
              color: "var(--text-faint)",
              fontSize: "var(--font-size-xs)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {lastUpdated.toLocaleTimeString()}
          </span>
        )}
        <button
          onClick={doRefresh}
          disabled={refreshing}
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-xs)",
            color: refreshing ? "var(--text-faint)" : "var(--text-muted)",
            fontSize: "var(--font-size-xs)",
            padding: "2px 8px",
            cursor: refreshing ? "default" : "pointer",
            fontFamily: "var(--font-ui)",
            transition: "var(--ease-fast)",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
          onMouseEnter={(e) => {
            if (!refreshing)
              (e.currentTarget as HTMLElement).style.background =
                "var(--ctp-surface1)";
          }}
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLElement).style.background =
              "var(--bg-elevated)")
          }
        >
          {refreshing && (
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                border: "1.5px solid var(--text-faint)",
                borderTopColor: "var(--accent-alt)",
                animation: "ef-spin 0.7s linear infinite",
                flexShrink: 0,
              }}
            />
          )}
          Refresh
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1.5fr 1fr 80px 80px 110px",
          padding: "5px 14px",
          background: "var(--bg-surface)",
          borderBottom: "1px solid var(--border-subtle)",
          fontSize: "var(--font-size-xs)",
          color: "var(--text-subtle)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          fontWeight: 500,
          flexShrink: 0,
        }}
      >
        {["Name", "Namespace", "Kind", "Desired", "Live", "Status"].map((h) => (
          <div key={h}>{h}</div>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {filtered.length === 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--text-faint)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            No items
          </div>
        )}
        {filtered.map((row) => {
          const s = STATUS_STYLES[row.status];
          return (
            <div
              key={`${row.label}-${row.namespace}`}
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1.5fr 1fr 80px 80px 110px",
                padding: "6px 14px",
                borderBottom: "1px solid var(--border-subtle)",
                background: s.bg,
                alignItems: "center",
                transition: "var(--ease-fast)",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.filter =
                  "brightness(1.12)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.filter = "none")
              }
            >
              <span
                style={{
                  color: s.text,
                  fontWeight: 500,
                  fontSize: "var(--font-size-sm)",
                }}
              >
                {row.label}
              </span>
              <span
                style={{
                  color: "var(--text-faint)",
                  fontSize: "var(--font-size-xs)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {row.namespace}
              </span>
              <span
                style={{
                  color: "var(--text-muted)",
                  fontSize: "var(--font-size-xs)",
                }}
              >
                {row.kind}
              </span>
              <span
                style={{
                  color: "var(--accent-alt)",
                  fontSize: "var(--font-size-sm)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {row.desired}
              </span>
              <span
                style={{
                  color:
                    row.live !== row.desired
                      ? "var(--ctp-yellow)"
                      : "var(--text-muted)",
                  fontSize: "var(--font-size-sm)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {row.live}
              </span>
              <span
                style={{
                  background: s.badge_bg,
                  border: `1px solid ${s.badge_border}`,
                  color: s.text,
                  fontSize: "var(--font-size-xs)",
                  padding: "2px 7px",
                  borderRadius: "var(--radius-full)",
                  display: "inline-block",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface LogLine {
  time: string;
  pod: string;
  namespace: string;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  message: string;
}

function parseLogs(raw: string, pod: string, namespace: string): LogLine[] {
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const level: LogLine["level"] = /error|err|fatal/i.test(line)
        ? "ERROR"
        : /warn/i.test(line)
          ? "WARN"
          : /debug/i.test(line)
            ? "DEBUG"
            : "INFO";
      const timeMatch = line.match(/\d{2}:\d{2}:\d{2}(\.\d+)?/);
      return {
        time: timeMatch?.[0] ?? "--:--:--",
        pod,
        namespace,
        level,
        message: line,
      };
    });
}

const LEVEL_CFG = {
  INFO: { color: "var(--ctp-green)", bg: "transparent" },
  WARN: { color: "var(--ctp-yellow)", bg: "rgba(249,226,175,0.04)" },
  ERROR: { color: "var(--ctp-red)", bg: "rgba(243,139,168,0.05)" },
  DEBUG: { color: "var(--text-subtle)", bg: "transparent" },
};

export function ClusterLogsPanel() {
  const [filter, setFilter] = React.useState("");
  const [levelFilter, setLevelFilter] = React.useState<string>("all");
  const [logs, setLogs] = React.useState<LogLine[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [autoScroll, setAutoScroll] = React.useState(true);
  const [selectedPod, setSelectedPod] = React.useState<string>("");
  const logsEndRef = useRef<HTMLDivElement>(null);
  const selectedPodRef = useRef(selectedPod);
  selectedPodRef.current = selectedPod;

  const clusterStatus = useIDEStore((s) => s.clusterStatus);

  const allPods = React.useMemo(() => {
    if (!clusterStatus) return [];
    return clusterStatus.fields.flatMap((f) => f.pods.map((p) => ({ ...p })));
  }, [clusterStatus]);

  const fetchLogs = useCallback(
    async (podName: string, namespace: string, silent = false) => {
      if (!silent) setLoading(true);
      try {
        const { getPodLogs } = await import("../store/tauriStore");
        const raw = await getPodLogs(namespace, podName, 200);
        setLogs(parseLogs(raw, podName, namespace));
      } catch {
        if (!silent) setLogs([]);
      }
      if (!silent) setLoading(false);
    },
    [],
  );

  useEffect(() => {
    if (!selectedPod) return;
    const pod = allPods.find((p) => p.name === selectedPod);
    if (!pod) return;
    const id = setInterval(() => {
      if (selectedPodRef.current === selectedPod) {
        fetchLogs(pod.name, pod.namespace, true);
      }
    }, LOGS_REFRESH_MS);
    return () => clearInterval(id);
  }, [selectedPod, allPods, fetchLogs]);

  useEffect(() => {
    if (autoScroll) logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, autoScroll]);

  const filtered = logs.filter((l) => {
    const matchText =
      !filter ||
      l.pod.includes(filter) ||
      l.message.toLowerCase().includes(filter.toLowerCase());
    const matchLevel = levelFilter === "all" || l.level === levelFilter;
    return matchText && matchLevel;
  });

  const levelBtns = ["all", "INFO", "WARN", "ERROR", "DEBUG"] as const;
  const levelColors: Record<string, string> = {
    INFO: "var(--ctp-green)",
    WARN: "var(--ctp-yellow)",
    ERROR: "var(--ctp-red)",
    DEBUG: "var(--text-subtle)",
    all: "var(--text-muted)",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg-primary)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--font-size-sm)",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "5px 12px",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            color: "var(--text-secondary)",
            fontWeight: 500,
            fontSize: "var(--font-size-md)",
          }}
        >
          Logs
        </span>

        {allPods.length > 0 && (
          <select
            value={selectedPod}
            onChange={(e) => {
              setSelectedPod(e.target.value);
              const p = allPods.find((p) => p.name === e.target.value);
              if (p) fetchLogs(p.name, p.namespace);
            }}
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-muted)",
              fontSize: "var(--font-size-xs)",
              fontFamily: "var(--font-mono)",
              padding: "2px 7px",
              cursor: "pointer",
              outline: "none",
            }}
          >
            <option value="">— select pod —</option>
            {allPods.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        )}

        {/* Search */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            padding: "2px 7px",
            gap: 5,
            maxWidth: 220,
          }}
        >
          <span style={{ color: "var(--text-faint)", display: "flex" }}>
            <AppIcon name="search" size={11} strokeWidth={2} />
          </span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: "var(--text-secondary)",
              fontSize: "var(--font-size-xs)",
              fontFamily: "var(--font-mono)",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 3 }}>
          {levelBtns.map((lv) => (
            <button
              key={lv}
              onClick={() => setLevelFilter(lv)}
              style={{
                background:
                  levelFilter === lv
                    ? "var(--bg-sidebar-active)"
                    : "transparent",
                border: `1px solid ${levelFilter === lv ? "var(--border-accent)" : "var(--border-subtle)"}`,
                borderRadius: "var(--radius-xs)",
                color:
                  levelFilter === lv ? levelColors[lv] : "var(--text-faint)",
                fontSize: "var(--font-size-xs)",
                padding: "2px 6px",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                transition: "var(--ease-fast)",
              }}
            >
              {lv}
            </button>
          ))}
        </div>

        <span
          style={{
            marginLeft: "auto",
            color: "var(--text-faint)",
            fontSize: "var(--font-size-xs)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {loading ? "loading…" : `${filtered.length} lines`}
        </span>
        <button
          onClick={() => setAutoScroll((v) => !v)}
          title="Toggle auto-scroll"
          style={{
            background: autoScroll ? "rgba(180,190,254,0.10)" : "transparent",
            border: `1px solid ${autoScroll ? "var(--border-accent)" : "var(--border-subtle)"}`,
            borderRadius: "var(--radius-xs)",
            color: autoScroll ? "var(--accent-alt)" : "var(--text-faint)",
            fontSize: "var(--font-size-xs)",
            padding: "2px 7px",
            cursor: "pointer",
            fontFamily: "var(--font-mono)",
            transition: "var(--ease-fast)",
          }}
        >
          {autoScroll ? "↓ auto" : "auto"}
        </button>
      </div>

      {/* Log lines */}
      <div
        style={{ flex: 1, overflowY: "auto", padding: "2px 0" }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          setAutoScroll(atBottom);
        }}
      >
        {filtered.length === 0 && !loading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--text-faint)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            {selectedPod ? "No logs matched" : "Select a pod to view logs"}
          </div>
        )}
        {filtered.map((line, i) => {
          const lc = LEVEL_CFG[line.level];
          return (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 12,
                padding: "2px 14px",
                background: lc.bg,
                alignItems: "baseline",
                borderBottom: "1px solid var(--border-subtle)",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background =
                  "var(--bg-sidebar-hover)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = lc.bg)
              }
            >
              <span
                style={{
                  color: "var(--text-faint)",
                  fontSize: "var(--font-size-xs)",
                  fontFamily: "var(--font-mono)",
                  flexShrink: 0,
                  width: 72,
                }}
              >
                {line.time}
              </span>
              <span
                style={{
                  color: lc.color,
                  fontSize: "var(--font-size-xs)",
                  fontFamily: "var(--font-mono)",
                  flexShrink: 0,
                  width: 44,
                  fontWeight: 500,
                }}
              >
                {line.level}
              </span>
              <span
                style={{
                  color: "var(--accent-alt)",
                  fontSize: "var(--font-size-xs)",
                  fontFamily: "var(--font-mono)",
                  flexShrink: 0,
                  maxWidth: 180,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  opacity: 0.7,
                }}
              >
                {line.pod}
              </span>
              <span
                style={{
                  color: "var(--text-faint)",
                  fontSize: "var(--font-size-xs)",
                  fontFamily: "var(--font-mono)",
                  flexShrink: 0,
                }}
              >
                {line.namespace}
              </span>
              <span
                style={{
                  color: "var(--text-secondary)",
                  fontSize: "var(--font-size-sm)",
                  fontFamily: "var(--font-mono)",
                  flex: 1,
                }}
              >
                {line.message}
              </span>
            </div>
          );
        })}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
