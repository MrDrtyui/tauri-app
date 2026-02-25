import { AppIcon } from "../ui/AppIcon";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useIDEStore } from "../store/ideStore";
import { YamlNode } from "../store/tauriStore";

const AUTO_REFRESH_MS = 5000;
const LOGS_REFRESH_MS = 3000;

// ─── Helm matching helper (same logic as InspectorPanel) ──────────

function matchHelmFields(
  releaseName: string,
  clusterFields: {
    label: string;
    namespace: string;
    desired: number;
    ready: number;
    available: number;
    status: string;
    pods: any[];
  }[],
) {
  const r = releaseName.toLowerCase();
  return clusterFields.filter((f) => {
    const n = f.label.toLowerCase();
    return (
      n === r ||
      n.startsWith(r + "-") ||
      n.startsWith(r + "_") ||
      r.startsWith(n + "-") ||
      r.startsWith(n + "_") ||
      n.includes(r) ||
      r.includes(n)
    );
  });
}

// ─── Types ────────────────────────────────────────────────────────

interface HelmWorkload {
  label: string;
  namespace: string;
  desired: number;
  live: number;
  status: "ok" | "drift" | "missing";
  pods: any[];
}

interface DiffRow {
  key: string;
  label: string;
  namespace: string;
  kind: string;
  source: "helm" | "raw" | "cluster-only";
  desired: number;
  live: number;
  status: "ok" | "drift" | "missing" | "extra";
  helmWorkloads?: HelmWorkload[];
}

const STATUS_STYLES = {
  ok: {
    bg: "rgba(166,227,161,0.04)",
    text: "var(--ctp-green)",
    badge_bg: "rgba(166,227,161,0.10)",
    badge_border: "rgba(166,227,161,0.25)",
    label: "in sync",
  },
  drift: {
    bg: "rgba(249,226,175,0.04)",
    text: "var(--ctp-yellow)",
    badge_bg: "rgba(249,226,175,0.10)",
    badge_border: "rgba(249,226,175,0.25)",
    label: "drift",
  },
  missing: {
    bg: "rgba(243,139,168,0.05)",
    text: "var(--ctp-red)",
    badge_bg: "rgba(243,139,168,0.10)",
    badge_border: "rgba(243,139,168,0.25)",
    label: "missing",
  },
  extra: {
    bg: "rgba(250,179,135,0.04)",
    text: "var(--ctp-peach)",
    badge_bg: "rgba(250,179,135,0.10)",
    badge_border: "rgba(250,179,135,0.25)",
    label: "extra",
  },
};

// ─── ClusterDiffPanel ─────────────────────────────────────────────

export function ClusterDiffPanel() {
  const [filter, setFilter] = useState<"all" | "drift" | "missing" | "extra">(
    "all",
  );
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // ── Build diff rows ──────────────────────────────────────────────

  const clusterFields = clusterStatus?.fields ?? [];
  const claimedLabels = new Set<string>();

  const diffRows: DiffRow[] = nodes.map((node) => {
    if (node.source === "helm") {
      const releaseName = node.helm?.release_name ?? node.label;
      const workloads = matchHelmFields(releaseName, clusterFields);
      workloads.forEach((w) => claimedLabels.add(w.label));

      const helmReady = workloads.reduce((s, w) => s + w.ready, 0);
      const helmDesired = workloads.reduce((s, w) => s + w.desired, 0);

      const helmWorkloads: HelmWorkload[] = workloads.map((w) => ({
        label: w.label,
        namespace: w.namespace,
        desired: w.desired,
        live: w.ready,
        status:
          w.ready === 0 ? "missing" : w.ready < w.desired ? "drift" : "ok",
        pods: w.pods,
      }));

      const overallStatus: DiffRow["status"] =
        workloads.length === 0
          ? "missing"
          : helmReady < helmDesired
            ? "drift"
            : "ok";

      return {
        key: node.id,
        label: node.label,
        namespace: node.namespace,
        kind: "HelmRelease",
        source: "helm",
        desired: helmDesired,
        live: helmReady,
        status: overallStatus,
        helmWorkloads,
      };
    } else {
      const live = clusterFields.find((f) => f.label === node.label);
      if (live) claimedLabels.add(live.label);
      const desiredReplicas = node.replicas ?? 1;
      const liveReplicas = live ? live.ready : 0;
      const status: DiffRow["status"] =
        !live || live.status === "red"
          ? "missing"
          : liveReplicas < desiredReplicas || live.status === "yellow"
            ? "drift"
            : "ok";
      return {
        key: node.id,
        label: node.label,
        namespace: node.namespace,
        kind: node.kind,
        source: "raw",
        desired: desiredReplicas,
        live: liveReplicas,
        status,
      };
    }
  });

  // Extra cluster resources not owned by any project node
  clusterFields.forEach((f) => {
    if (!claimedLabels.has(f.label)) {
      diffRows.push({
        key: `extra-${f.label}-${f.namespace}`,
        label: f.label,
        namespace: f.namespace,
        kind: "Unknown",
        source: "cluster-only",
        desired: 0,
        live: f.ready,
        status: "extra",
      });
    }
  });

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

      {/* Column headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "18px 2fr 1.4fr 1fr 70px 70px 110px",
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
        <div />
        {["Name", "Namespace", "Kind", "Desired", "Live", "Status"].map((h) => (
          <div key={h}>{h}</div>
        ))}
      </div>

      {/* Rows */}
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
            {!clusterStatus ? "Connecting to cluster…" : "No items"}
          </div>
        )}

        {filtered.map((row) => {
          const s = STATUS_STYLES[row.status];
          const isHelm = row.source === "helm";
          const isExpanded = expanded.has(row.key);
          const hasWl = (row.helmWorkloads?.length ?? 0) > 0;

          return (
            <React.Fragment key={row.key}>
              {/* Main row */}
              <div
                onClick={() => isHelm && toggleExpand(row.key)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "18px 2fr 1.4fr 1fr 70px 70px 110px",
                  padding: "6px 14px",
                  borderBottom: "1px solid var(--border-subtle)",
                  background: s.bg,
                  alignItems: "center",
                  cursor: isHelm ? "pointer" : "default",
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
                {/* Chevron */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {isHelm && (
                    <span
                      style={{
                        color: "var(--text-faint)",
                        fontSize: 8,
                        transition: "transform 0.15s ease",
                        transform: isExpanded
                          ? "rotate(90deg)"
                          : "rotate(0deg)",
                        display: "inline-block",
                      }}
                    >
                      ▶
                    </span>
                  )}
                </div>

                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    color: s.text,
                    fontWeight: 500,
                    fontSize: "var(--font-size-sm)",
                  }}
                >
                  {isHelm && (
                    <AppIcon
                      name="helmRelease"
                      size={11}
                      strokeWidth={1.5}
                      style={{ color: "var(--text-faint)", flexShrink: 0 }}
                    />
                  )}
                  {row.label}
                  {isHelm && !clusterStatus && (
                    <span
                      style={{
                        color: "var(--text-faint)",
                        fontSize: 9,
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      …
                    </span>
                  )}
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
                  {isHelm && row.desired === 0 ? "—" : row.desired}
                </span>
                <span
                  style={{
                    color:
                      row.live < row.desired
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

              {/* Helm workloads (expanded) */}
              {isHelm &&
                isExpanded &&
                row.helmWorkloads?.map((w, wi) => {
                  const ws = STATUS_STYLES[w.status];
                  return (
                    <div
                      key={`${row.key}-wl-${wi}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "18px 2fr 1.4fr 1fr 70px 70px 110px",
                        padding: "4px 14px",
                        paddingLeft: 32,
                        borderBottom: "1px solid var(--border-subtle)",
                        background: ws.bg,
                        alignItems: "center",
                        opacity: 0.88,
                      }}
                    >
                      <div />
                      <span
                        style={{
                          color: "var(--text-faint)",
                          fontSize: "var(--font-size-xs)",
                          fontFamily: "var(--font-mono)",
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <span
                          style={{
                            color: "var(--border-default)",
                            flexShrink: 0,
                          }}
                        >
                          └
                        </span>
                        {w.label}
                      </span>
                      <span
                        style={{
                          color: "var(--text-faint)",
                          fontSize: "var(--font-size-xs)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {w.namespace}
                      </span>
                      <span
                        style={{
                          color: "var(--text-muted)",
                          fontSize: "var(--font-size-xs)",
                        }}
                      >
                        Deployment
                      </span>
                      <span
                        style={{
                          color: "var(--accent-alt)",
                          fontSize: "var(--font-size-xs)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {w.desired}
                      </span>
                      <span
                        style={{
                          color:
                            w.live < w.desired
                              ? "var(--ctp-yellow)"
                              : "var(--text-muted)",
                          fontSize: "var(--font-size-xs)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {w.live}
                      </span>
                      <span
                        style={{
                          background: ws.badge_bg,
                          border: `1px solid ${ws.badge_border}`,
                          color: ws.text,
                          fontSize: 9,
                          padding: "1px 6px",
                          borderRadius: "var(--radius-full)",
                          display: "inline-block",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {ws.label}
                      </span>
                    </div>
                  );
                })}

              {/* Helm expanded but no workloads found */}
              {isHelm && isExpanded && !hasWl && (
                <div
                  style={{
                    padding: "5px 14px 5px 42px",
                    fontSize: "var(--font-size-xs)",
                    color: "var(--text-faint)",
                    fontFamily: "var(--font-mono)",
                    borderBottom: "1px solid var(--border-subtle)",
                    background: "rgba(243,139,168,0.03)",
                  }}
                >
                  no running workloads found in cluster
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ─── Log helpers ──────────────────────────────────────────────────

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
      // Detect level
      const level: LogLine["level"] = /error|err|fatal/i.test(line)
        ? "ERROR"
        : /warn/i.test(line)
          ? "WARN"
          : /debug/i.test(line)
            ? "DEBUG"
            : "INFO";

      // Extract timestamp: support ISO (2026-02-25T17:14:59.054Z),
      // postgres-style (2026-02-25 17:14:59.054 UTC), or bare HH:MM:SS
      const isoMatch = line.match(
        /\d{4}-\d{2}-\d{2}[T ]?(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/,
      );
      const timeMatch = line.match(/\d{2}:\d{2}:\d{2}(?:\.\d+)?/);
      const time = isoMatch?.[1] ?? timeMatch?.[0] ?? "--:--:--";

      // Strip leading timestamp + PID/level prefix from message for cleaner display
      // Patterns: "2026-02-25 17:14:59.054 UTC [41] LOG: ..."
      //           "2026-02-25T17:14:59Z INFO ..."
      //           "17:14:59.054 [main] INFO  ..."
      let message = line
        .replace(
          /^\d{4}-\d{2}-\d{2}[T ]?\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:\s+UTC)?(?:\s+\[\d+\])?(?:\s+\w+:)?\s*/,
          "",
        )
        .replace(
          /^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:\s+\[[^\]]+\])?(?:\s+\w+\s+)?/,
          "",
        )
        .trim();

      // Fallback: if stripping removed everything, use original
      if (!message) message = line;

      return { time, pod, namespace, level, message };
    });
}

const LEVEL_CFG = {
  INFO: {
    color: "var(--ctp-green)",
    bg: "transparent",
    bar: "var(--ctp-green)",
  },
  WARN: {
    color: "var(--ctp-yellow)",
    bg: "rgba(249,226,175,0.03)",
    bar: "var(--ctp-yellow)",
  },
  ERROR: {
    color: "var(--ctp-red)",
    bg: "rgba(243,139,168,0.05)",
    bar: "var(--ctp-red)",
  },
  DEBUG: {
    color: "var(--text-subtle)",
    bg: "transparent",
    bar: "var(--border-subtle)",
  },
};

// ─── ClusterLogsPanel ─────────────────────────────────────────────

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

  const nodes = useIDEStore((s) => s.nodes);
  const clusterStatus = useIDEStore((s) => s.clusterStatus);
  const selectedLogPod = useIDEStore((s) => s.selectedLogPod);
  const setSelectedLogPod = useIDEStore((s) => s.setSelectedLogPod);

  // All pods flat list
  const allPods = React.useMemo(() => {
    if (!clusterStatus) return [];
    return clusterStatus.fields.flatMap((f) => f.pods.map((p) => ({ ...p })));
  }, [clusterStatus]);

  // Grouped pods: each project node gets its own optgroup
  const podGroups = React.useMemo(() => {
    if (!clusterStatus) return [];
    const clusterFields = clusterStatus.fields;
    const usedPods = new Set<string>();
    const groups: { groupLabel: string; pods: typeof allPods }[] = [];

    nodes.forEach((node) => {
      const fields =
        node.source === "helm"
          ? matchHelmFields(
              node.helm?.release_name ?? node.label,
              clusterFields,
            )
          : clusterFields.filter((f) => f.label === node.label);
      const pods = fields
        .flatMap((f) => f.pods)
        .filter((p) => {
          if (usedPods.has(p.name)) return false;
          usedPods.add(p.name);
          return true;
        });
      if (pods.length > 0) groups.push({ groupLabel: node.label, pods });
    });

    // Remaining unclaimed pods
    const remaining = allPods.filter((p) => !usedPods.has(p.name));
    if (remaining.length > 0)
      groups.push({ groupLabel: "other", pods: remaining });
    return groups;
  }, [clusterStatus, nodes, allPods]);

  // Auto-select pod when triggered from context menu (field.logs command)
  useEffect(() => {
    if (!selectedLogPod) return;
    setSelectedPod(selectedLogPod.name);
    fetchLogs(selectedLogPod.name, selectedLogPod.namespace);
    // Clear so re-clicking same node still triggers
    setSelectedLogPod(null);
  }, [selectedLogPod]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (selectedPodRef.current === selectedPod)
        fetchLogs(pod.name, pod.namespace, true);
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
          gap: 6,
          padding: "5px 10px",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
          background: "var(--bg-sidebar)",
        }}
      >
        {/* Pod selector */}
        {podGroups.length > 0 ? (
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
              color: selectedPod
                ? "var(--text-secondary)"
                : "var(--text-faint)",
              fontSize: "var(--font-size-xs)",
              fontFamily: "var(--font-mono)",
              padding: "3px 8px",
              cursor: "pointer",
              outline: "none",
              maxWidth: 260,
            }}
          >
            <option value="">select pod…</option>
            {podGroups.map((g) => (
              <optgroup key={g.groupLabel} label={g.groupLabel}>
                {g.pods.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : (
          <span
            style={{
              color: "var(--text-faint)",
              fontSize: "var(--font-size-xs)",
              fontFamily: "var(--font-mono)",
            }}
          >
            no pods
          </span>
        )}

        {/* Divider */}
        <div
          style={{
            width: 1,
            height: 16,
            background: "var(--border-subtle)",
            flexShrink: 0,
          }}
        />

        {/* Level filter pills */}
        <div style={{ display: "flex", gap: 2 }}>
          {levelBtns.map((lv) => {
            const active = levelFilter === lv;
            const col = levelColors[lv];
            return (
              <button
                key={lv}
                onClick={() => setLevelFilter(lv)}
                style={{
                  background: active ? `${col}18` : "transparent",
                  border: `1px solid ${active ? `${col}40` : "transparent"}`,
                  borderRadius: "var(--radius-xs)",
                  color: active ? col : "var(--text-faint)",
                  fontSize: 9,
                  padding: "2px 6px",
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                  fontWeight: active ? 600 : 400,
                  letterSpacing: "0.04em",
                  transition: "var(--ease-fast)",
                }}
              >
                {lv}
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div
          style={{
            width: 1,
            height: 16,
            background: "var(--border-subtle)",
            flexShrink: 0,
          }}
        />

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
            flex: 1,
            maxWidth: 200,
          }}
        >
          <span
            style={{
              color: "var(--text-faint)",
              display: "flex",
              flexShrink: 0,
            }}
          >
            <AppIcon name="search" size={10} strokeWidth={2} />
          </span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter logs…"
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: "var(--text-secondary)",
              fontSize: "var(--font-size-xs)",
              fontFamily: "var(--font-mono)",
              minWidth: 0,
            }}
          />
          {filter && (
            <button
              onClick={() => setFilter("")}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-faint)",
                cursor: "pointer",
                padding: 0,
                display: "flex",
                fontSize: 10,
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Right side */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginLeft: "auto",
          }}
        >
          <span
            style={{
              color: "var(--text-faint)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              opacity: 0.7,
            }}
          >
            {loading ? "loading…" : `${filtered.length} lines`}
          </span>
          <button
            onClick={() => setAutoScroll((v) => !v)}
            title="Toggle auto-scroll"
            style={{
              background: autoScroll ? "rgba(180,190,254,0.10)" : "transparent",
              border: `1px solid ${autoScroll ? "rgba(180,190,254,0.25)" : "var(--border-subtle)"}`,
              borderRadius: "var(--radius-xs)",
              color: autoScroll ? "var(--accent-alt)" : "var(--text-faint)",
              fontSize: 9,
              padding: "2px 7px",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              transition: "var(--ease-fast)",
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <span style={{ fontSize: 8 }}>↓</span>
            {autoScroll ? "live" : "scroll"}
          </button>
        </div>
      </div>

      {/* Log lines */}
      <div
        style={{ flex: 1, overflowY: "auto" }}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
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
              fontFamily: "var(--font-ui)",
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
                alignItems: "baseline",
                gap: 0,
                background: lc.bg,
                borderBottom: "1px solid rgba(88,91,112,0.12)",
                transition: "background 0.08s",
                position: "relative",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background =
                  "rgba(88,91,112,0.08)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = lc.bg)
              }
            >
              {/* Level accent bar */}
              <div
                style={{
                  width: 2,
                  alignSelf: "stretch",
                  flexShrink: 0,
                  background: lc.bar,
                  opacity: line.level === "INFO" ? 0.25 : 0.7,
                }}
              />

              {/* Time */}
              <span
                style={{
                  color: "var(--text-faint)",
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  flexShrink: 0,
                  width: 68,
                  padding: "3px 0 3px 8px",
                  letterSpacing: "-0.02em",
                  opacity: 0.65,
                }}
              >
                {line.time}
              </span>

              {/* Level badge */}
              <span
                style={{
                  fontSize: 9,
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                  flexShrink: 0,
                  width: 36,
                  padding: "3px 0",
                  color: lc.color,
                  letterSpacing: "0.04em",
                  textAlign: "center" as const,
                }}
              >
                {line.level}
              </span>

              {/* Message */}
              <span
                style={{
                  color:
                    line.level === "ERROR"
                      ? "rgba(243,139,168,0.9)"
                      : line.level === "WARN"
                        ? "rgba(249,226,175,0.85)"
                        : line.level === "DEBUG"
                          ? "var(--text-faint)"
                          : "var(--text-secondary)",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  flex: 1,
                  padding: "3px 14px 3px 8px",
                  lineHeight: 1.55,
                  wordBreak: "break-all" as const,
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
