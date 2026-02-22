import React, { useState } from "react";
import { useIDEStore } from "../store/ideStore";

// ─── Cluster Diff ─────────────────────────────────────────────────────────────

interface DiffRow {
  label: string;
  namespace: string;
  kind: string;
  desired: number;
  live: number;
  status: "ok" | "drift" | "missing" | "extra";
}

const STATUS_STYLES = {
  ok:      { bg: "rgba(34,197,94,0.06)",  text: "#6ee7b7",  badge: "rgba(34,197,94,0.2)",  label: "✓ in sync"  },
  drift:   { bg: "rgba(234,179,8,0.08)",  text: "#fef08a",  badge: "rgba(234,179,8,0.2)",  label: "⚠ drift"    },
  missing: { bg: "rgba(239,68,68,0.08)",  text: "#fca5a5",  badge: "rgba(239,68,68,0.2)",  label: "✗ missing"  },
  extra:   { bg: "rgba(251,146,60,0.08)", text: "#fed7aa",  badge: "rgba(251,146,60,0.2)", label: "⊛ extra"    },
};

export function ClusterDiffPanel() {
  const [filter, setFilter] = useState<"all" | "drift" | "missing" | "extra">("all");
  const nodes = useIDEStore((s) => s.nodes);
  const clusterStatus = useIDEStore((s) => s.clusterStatus);

  // Build diff rows from real data
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

  // Add "extra" items from cluster that aren't in scanned nodes
  if (clusterStatus) {
    for (const f of clusterStatus.fields) {
      if (!nodes.find((n) => n.label === f.label)) {
        diffRows.push({ label: f.label, namespace: f.namespace, kind: "Unknown", desired: 0, live: f.ready, status: "extra" });
      }
    }
  }

  const filtered = filter === "all" ? diffRows : diffRows.filter((r) => r.status === filter);
  const driftCount = diffRows.filter((r) => r.status !== "ok").length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#07101f",
        fontFamily: "'JetBrains Mono', monospace",
        color: "#94a3b8",
        fontSize: 11,
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>Cluster Diff</span>
        {driftCount > 0 && (
          <span
            style={{
              background: "rgba(234,179,8,0.2)",
              color: "#fef08a",
              fontSize: 9,
              padding: "1px 6px",
              borderRadius: 3,
            }}
          >
            {driftCount} issues
          </span>
        )}
        <div style={{ flex: 1 }} />
        {/* Filter tabs */}
        {(["all", "drift", "missing", "extra"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              background: filter === f ? "rgba(59,130,246,0.15)" : "none",
              border: `1px solid ${filter === f ? "rgba(96,165,250,0.35)" : "rgba(255,255,255,0.06)"}`,
              borderRadius: 3,
              color: filter === f ? "#93c5fd" : "rgba(255,255,255,0.3)",
              fontSize: 9,
              padding: "2px 7px",
              cursor: "pointer",
              fontFamily: "monospace",
            }}
          >
            {f}
          </button>
        ))}
        <button
          style={{
            background: "rgba(59,130,246,0.15)",
            border: "1px solid rgba(96,165,250,0.3)",
            borderRadius: 3,
            color: "#93c5fd",
            fontSize: 9,
            padding: "2px 8px",
            cursor: "pointer",
            fontFamily: "monospace",
          }}
        >
          ↻ Refresh (mock)
        </button>
      </div>

      {/* Table header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1.5fr 1fr 80px 80px 100px",
          gap: 0,
          padding: "4px 12px",
          background: "rgba(255,255,255,0.02)",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          fontSize: 9,
          color: "rgba(255,255,255,0.22)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          flexShrink: 0,
        }}
      >
        {["Name", "Namespace", "Kind", "Desired", "Live", "Status"].map((h) => (
          <div key={h}>{h}</div>
        ))}
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {filtered.map((row) => {
          const s = STATUS_STYLES[row.status];
          return (
            <div
              key={`${row.label}-${row.namespace}`}
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1.5fr 1fr 80px 80px 100px",
                padding: "5px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.03)",
                background: s.bg,
                alignItems: "center",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.15)")}
              onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
            >
              <span style={{ color: s.text, fontWeight: 500 }}>{row.label}</span>
              <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>{row.namespace}</span>
              <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>{row.kind}</span>
              <span style={{ color: "#60a5fa" }}>{row.desired}</span>
              <span style={{ color: row.live !== row.desired ? "#f59e0b" : "rgba(255,255,255,0.5)" }}>
                {row.live}
              </span>
              <span
                style={{
                  background: s.badge,
                  color: s.text,
                  fontSize: 9,
                  padding: "1px 6px",
                  borderRadius: 3,
                  display: "inline-block",
                }}
              >
                {STATUS_STYLES[row.status].label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Cluster Logs ─────────────────────────────────────────────────────────────

interface LogLine {
  time: string;
  pod: string;
  namespace: string;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  message: string;
}

function parseLogs(raw: string, pod: string, namespace: string): LogLine[] {
  return raw.split("\n").filter(Boolean).map((line) => {
    const level: LogLine["level"] =
      /error|err|fatal/i.test(line) ? "ERROR" :
      /warn/i.test(line) ? "WARN" :
      /debug/i.test(line) ? "DEBUG" : "INFO";
    const timeMatch = line.match(/\d{2}:\d{2}:\d{2}(\.\d+)?/);
    return { time: timeMatch?.[0] ?? "--:--:--", pod, namespace, level, message: line };
  });
}

const LEVEL_COLORS = {
  INFO:  { text: "#6ee7b7", bg: "transparent" },
  WARN:  { text: "#fef08a", bg: "rgba(234,179,8,0.06)" },
  ERROR: { text: "#fca5a5", bg: "rgba(239,68,68,0.08)" },
  DEBUG: { text: "#94a3b8", bg: "transparent" },
};

export function ClusterLogsPanel() {
  const [filter, setFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [logs, setLogs] = React.useState<LogLine[]>([]);
  const [loading, setLoading] = React.useState(false);
  const nodes = useIDEStore((s) => s.nodes);
  const clusterStatus = useIDEStore((s) => s.clusterStatus);
  const [selectedPod, setSelectedPod] = React.useState<string>("");

  // Build pod list from cluster status
  const allPods = React.useMemo(() => {
    if (!clusterStatus) return [];
    return clusterStatus.fields.flatMap((f) => f.pods.map((p) => ({ ...p })));
  }, [clusterStatus]);

  const fetchLogs = async (podName: string, namespace: string) => {
    setLoading(true);
    try {
      const { getPodLogs } = await import("../store/tauriStore");
      const raw = await getPodLogs(namespace, podName, 200);
      setLogs(parseLogs(raw, podName, namespace));
    } catch { setLogs([]); }
    setLoading(false);
  };

  const filtered = logs.filter((l) => {
    const matchText = !filter || l.pod.includes(filter) || l.message.toLowerCase().includes(filter.toLowerCase());
    const matchLevel = levelFilter === "all" || l.level === levelFilter;
    return matchText && matchLevel;
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#060e1c",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 600, fontSize: 11 }}>Logs</span>
        {allPods.length > 0 && (
          <select value={selectedPod} onChange={(e) => { setSelectedPod(e.target.value); const p = allPods.find(p=>p.name===e.target.value); if(p) fetchLogs(p.name, p.namespace); }}
            style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:3, color:"rgba(255,255,255,0.5)", fontSize:10, fontFamily:"monospace", padding:"2px 6px", cursor:"pointer" }}>
            <option value="">— select pod —</option>
            {allPods.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        )}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 3,
            padding: "2px 6px",
            gap: 4,
            maxWidth: 220,
          }}
        >
          <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 10 }}>⌕</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by pod or message..."
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: "rgba(255,255,255,0.55)",
              fontSize: 10,
              fontFamily: "monospace",
            }}
          />
        </div>
        {(["all", "INFO", "WARN", "ERROR", "DEBUG"] as const).map((lv) => (
          <button
            key={lv}
            onClick={() => setLevelFilter(lv)}
            style={{
              background: levelFilter === lv ? "rgba(59,130,246,0.15)" : "none",
              border: `1px solid ${levelFilter === lv ? "rgba(96,165,250,0.35)" : "rgba(255,255,255,0.06)"}`,
              borderRadius: 3,
              color:
                lv === "all" ? (levelFilter === lv ? "#93c5fd" : "rgba(255,255,255,0.3)") :
                lv === "ERROR" ? "#fca5a5" :
                lv === "WARN" ? "#fef08a" :
                lv === "DEBUG" ? "#94a3b8" : "#6ee7b7",
              fontSize: 9,
              padding: "2px 6px",
              cursor: "pointer",
              fontFamily: "monospace",
            }}
          >
            {lv}
          </button>
        ))}
        <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 9, marginLeft: "auto" }}>
          {loading ? "loading…" : `${filtered.length} lines`}
        </span>
      </div>

      {/* Log lines */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {filtered.length === 0 && !loading && (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", color:"rgba(255,255,255,0.15)", fontFamily:"monospace", fontSize:11 }}>
            {selectedPod ? "No logs matched" : "Select a pod to view logs"}
          </div>
        )}
        {filtered.map((line, i) => {
          const lc = LEVEL_COLORS[line.level];
          return (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 10,
                padding: "2px 12px",
                background: lc.bg,
                alignItems: "baseline",
                borderBottom: "1px solid rgba(255,255,255,0.02)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = lc.bg)}
            >
              <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 10, flexShrink: 0, width: 80 }}>
                {line.time}
              </span>
              <span style={{ color: lc.text, fontSize: 9, flexShrink: 0, width: 46, fontWeight: 600 }}>
                {line.level}
              </span>
              <span style={{ color: "rgba(96,165,250,0.6)", fontSize: 10, flexShrink: 0, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {line.pod}
              </span>
              <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 9, flexShrink: 0 }}>
                {line.namespace}
              </span>
              <span style={{ color: "rgba(255,255,255,0.65)", fontSize: 11, flex: 1 }}>
                {line.message}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
