import React from "react";
import { useIDEStore } from "../store/ideStore";

const STATUS_COLORS = {
  green:  { dot: "#22c55e", bg: "rgba(34,197,94,0.12)",  text: "#6ee7b7" },
  yellow: { dot: "#eab308", bg: "rgba(234,179,8,0.12)",  text: "#fef08a" },
  red:    { dot: "#ef4444", bg: "rgba(239,68,68,0.12)",  text: "#fca5a5" },
  gray:   { dot: "#475569", bg: "rgba(71,85,105,0.12)",  text: "#94a3b8" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? STATUS_COLORS.gray;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 7px",
        borderRadius: 4,
        background: s.bg,
        color: s.text,
        fontSize: 10,
        fontFamily: "monospace",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: s.dot,
          boxShadow: status !== "gray" ? `0 0 5px ${s.dot}` : "none",
          display: "inline-block",
        }}
      />
      {status}
    </span>
  );
}

function PropRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
      <span
        style={{
          color: "rgba(255,255,255,0.28)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          flexShrink: 0,
          paddingTop: 1,
          width: 80,
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: "rgba(255,255,255,0.7)",
          fontSize: 11,
          fontFamily: mono ? "monospace" : "inherit",
          wordBreak: "break-all",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function InspectorPanel() {
  const selectedEntity = useIDEStore((s) => s.selectedEntity);
  const openTab = useIDEStore((s) => s.openTab);
  const nodes = useIDEStore((s) => s.nodes);
  const clusterStatus = useIDEStore((s) => s.clusterStatus);

  if (!selectedEntity || selectedEntity.type === "none") {
    return <EmptyInspector />;
  }

  const { type, id, label, filePath, meta } = selectedEntity;

  // Resolve node from real store
  const node = type === "field"
    ? nodes.find((n) => n.id === id)
    : type === "graphNode"
      ? nodes.find((n) => n.file_path === filePath || n.id === id)
      : null;

  const clusterInfo = node
    ? clusterStatus?.fields.find((f) => f.label === node.label)
    : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#070f1e",
        fontFamily: "'JetBrains Mono', monospace",
        color: "#94a3b8",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "10px 12px 8px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 14 }}>
            {type === "file" ? "📄" : type === "graphNode" ? "⬡" : "◈"}
          </span>
          <div>
            <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
              {label}
            </div>
            <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 9, marginTop: 2 }}>
              {type === "file" ? "File" : type === "graphNode" ? "Graph Node" : "Field"}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>

        {/* File info */}
        {filePath && (
          <Section title="Location">
            <PropRow label="Path" value={filePath.split("/").slice(-3).join("/")} mono />
            <div>
              <button
                onClick={() =>
                  filePath &&
                  openTab({
                    id: `file-${filePath}`,
                    title: filePath.split("/").pop() ?? label,
                    contentType: "file",
                    filePath,
                    icon: filePath.includes("Chart.yaml") ? "⛵" : "📄",
                  }, "center")
                }
                style={{
                  background: "rgba(59,130,246,0.12)",
                  border: "1px solid rgba(96,165,250,0.25)",
                  borderRadius: 4,
                  color: "#93c5fd",
                  fontSize: 10,
                  padding: "3px 8px",
                  cursor: "pointer",
                  fontFamily: "monospace",
                }}
              >
                ↗ Open in Editor
              </button>
            </div>
          </Section>
        )}

        {/* Field metadata */}
        {node && (
          <>
            <Section title="Field">
              <PropRow label="Kind"      value={node.kind} />
              <PropRow label="Type"      value={node.type_id} />
              <PropRow label="Namespace" value={node.namespace} mono />
              <PropRow label="Source"    value={node.source} />
              {node.replicas != null && (
                <PropRow label="Replicas" value={
                  <span style={{ color: "#60a5fa", fontWeight: 600 }}>{node.replicas}</span>
                } />
              )}
              {node.image && <PropRow label="Image" value={node.image} mono />}
            </Section>

            {clusterInfo && (
              <Section title="Cluster Status">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <StatusBadge status={clusterInfo.status} />
                  <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>
                    {clusterInfo.ready}/{clusterInfo.desired} ready
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {[
                    { l: "Desired",   v: clusterInfo.desired },
                    { l: "Ready",     v: clusterInfo.ready },
                    { l: "Available", v: clusterInfo.available },
                  ].map(({ l, v }) => (
                    <div key={l} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 5, padding: "6px 8px", textAlign: "center" }}>
                      <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{l}</div>
                      <div style={{ color: "#60a5fa", fontSize: 16, fontWeight: 700 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}

        {/* Generic meta */}
        {meta && Object.keys(meta).length > 0 && !node && (
          <Section title="Metadata">
            {Object.entries(meta).map(([k, v]) => (
              <PropRow key={k} label={k} value={String(v)} mono />
            ))}
          </Section>
        )}

        {/* Actions */}
        {node && (
          <Section title="Actions">
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <ActionButton label="↻ Sync with cluster" color="rgba(34,197,94,0.2)" border="rgba(74,222,128,0.3)" text="#6ee7b7" />
              <ActionButton label="⊞ Apply YAML" color="rgba(59,130,246,0.2)" border="rgba(96,165,250,0.3)" text="#93c5fd" />
              <ActionButton label="⌫ Delete field" color="rgba(239,68,68,0.12)" border="rgba(239,68,68,0.25)" text="#fca5a5" />
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          color: "rgba(255,255,255,0.22)",
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          marginBottom: 8,
          paddingBottom: 4,
          borderBottom: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function ActionButton({
  label,
  color,
  border,
  text,
}: {
  label: string;
  color: string;
  border: string;
  text: string;
}) {
  return (
    <button
      style={{
        width: "100%",
        background: color,
        border: `1px solid ${border}`,
        borderRadius: 4,
        color: text,
        fontSize: 10,
        padding: "5px 8px",
        cursor: "pointer",
        fontFamily: "monospace",
        textAlign: "left",
        transition: "filter 0.1s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.25)")}
      onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
    >
      {label}
    </button>
  );
}

function EmptyInspector() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: 8,
        padding: 20,
        fontFamily: "monospace",
      }}
    >
      <span style={{ fontSize: 28, opacity: 0.15 }}>◈</span>
      <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 11, textAlign: "center" }}>
        Select a file, field, or graph node to inspect it here
      </span>
    </div>
  );
}
