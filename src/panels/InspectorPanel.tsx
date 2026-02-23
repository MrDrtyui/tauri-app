import {
  AppIcon,
  resolveNodeIconName,
  resolveNodeColor,
  contentTypeIcon,
} from "../ui/AppIcon";
import React from "react";
import { useIDEStore } from "../store/ideStore";

// ─── Status badge ─────────────────────────────────────────────────

const STATUS_CFG = {
  green: {
    color: "var(--status-ok)",
    bg: "rgba(166, 227, 161, 0.08)",
    label: "healthy",
  },
  yellow: {
    color: "var(--status-warn)",
    bg: "rgba(249, 226, 175, 0.08)",
    label: "degraded",
  },
  red: {
    color: "var(--status-error)",
    bg: "rgba(243, 139, 168, 0.08)",
    label: "error",
  },
  gray: {
    color: "var(--status-unknown)",
    bg: "rgba(127, 132, 156, 0.08)",
    label: "unknown",
  },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_CFG[status as keyof typeof STATUS_CFG] ?? STATUS_CFG.gray;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        borderRadius: "var(--radius-full)",
        background: s.bg,
        color: s.color,
        fontSize: "var(--font-size-xs)",
        fontFamily: "var(--font-mono)",
        border: `1px solid ${s.color}28`,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: s.color,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      {status}
    </span>
  );
}

// ─── PropRow ──────────────────────────────────────────────────────

function PropRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        marginBottom: 10,
      }}
    >
      <span
        style={{
          color: "var(--text-subtle)",
          fontSize: "var(--font-size-xs)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          flexShrink: 0,
          paddingTop: 1,
          width: 76,
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: "var(--text-secondary)",
          fontSize: "var(--font-size-sm)",
          fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
          wordBreak: "break-all",
          lineHeight: 1.5,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          color: "var(--text-subtle)",
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontWeight: 500,
          marginBottom: 10,
          paddingBottom: 6,
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

// ─── InspectorPanel ───────────────────────────────────────────────

export function InspectorPanel() {
  const selectedEntity = useIDEStore((s) => s.selectedEntity);
  const openTab = useIDEStore((s) => s.openTab);
  const nodes = useIDEStore((s) => s.nodes);
  const clusterStatus = useIDEStore((s) => s.clusterStatus);

  if (!selectedEntity || selectedEntity.type === "none") {
    return <EmptyInspector />;
  }

  const { type, id, label, filePath } = selectedEntity;

  const node =
    type === "field"
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
        background: "var(--bg-sidebar)",
        fontFamily: "var(--font-ui)",
        color: "var(--text-secondary)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 14px 10px",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>
            <AppIcon
              name={
                type === "file"
                  ? "fileYaml"
                  : type === "graphNode"
                    ? "graph"
                    : "inspector"
              }
              size={15}
              strokeWidth={1.75}
            />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                color: "var(--text-primary)",
                fontWeight: 500,
                fontSize: "var(--font-size-md)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </div>
            <div
              style={{
                color: "var(--text-subtle)",
                fontSize: "var(--font-size-xs)",
                marginTop: 2,
                textTransform: "capitalize",
              }}
            >
              {type === "file"
                ? "File"
                : type === "graphNode"
                  ? "Graph Node"
                  : "Field"}
            </div>
          </div>
          {clusterInfo && <StatusBadge status={clusterInfo.status} />}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px" }}>
        {/* Location */}
        {filePath && (
          <Section title="Location">
            <PropRow
              label="Path"
              value={filePath.split("/").slice(-3).join("/")}
              mono
            />
            <button
              onClick={() =>
                filePath &&
                openTab(
                  {
                    id: `file-${filePath}`,
                    title: filePath.split("/").pop() ?? label,
                    contentType: "file",
                    filePath,
                    icon: filePath.includes("Chart.yaml")
                      ? "helmRelease"
                      : "fileYaml",
                  },
                  "center",
                )
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 10px",
                background: "rgba(180, 190, 254, 0.08)",
                border: "1px solid var(--border-accent)",
                borderRadius: "var(--radius-sm)",
                color: "var(--accent-alt)",
                fontSize: "var(--font-size-xs)",
                fontFamily: "var(--font-ui)",
                cursor: "pointer",
                transition: "var(--ease-fast)",
                marginTop: 4,
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background =
                  "rgba(180, 190, 254, 0.15)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background =
                  "rgba(180, 190, 254, 0.08)")
              }
            >
              Open File
            </button>
          </Section>
        )}

        {/* Field details */}
        {node && (
          <Section title="Field">
            <PropRow label="Kind" value={node.kind} mono />
            <PropRow label="Namespace" value={node.namespace} mono />
            {node.image && <PropRow label="Image" value={node.image} mono />}
            {node.replicas != null && (
              <PropRow label="Replicas" value={node.replicas} />
            )}
            <PropRow
              label="Source"
              value={node.source === "helm" ? "Helm" : "Raw YAML"}
            />
          </Section>
        )}

        {/* Cluster status */}
        {clusterInfo && (
          <Section title="Cluster">
            <PropRow
              label="Status"
              value={<StatusBadge status={clusterInfo.status} />}
            />
            {clusterInfo.message && (
              <PropRow label="Message" value={clusterInfo.message} mono />
            )}
          </Section>
        )}

        {/* File-only info */}
        {type === "file" && !node && (
          <Section title="File">
            <PropRow label="Name" value={label} />
          </Section>
        )}
      </div>
    </div>
  );
}

// ─── EmptyInspector ──────────────────────────────────────────────

function EmptyInspector() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg-sidebar)",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-faint)",
        fontFamily: "var(--font-ui)",
        gap: 10,
      }}
    >
      <span style={{ opacity: 0.25, display: "flex" }}>
        <AppIcon name="inspector" size={22} strokeWidth={1.25} />
      </span>
      <div style={{ fontSize: "var(--font-size-xs)", opacity: 0.5 }}>
        Select a field to inspect
      </div>
    </div>
  );
}
