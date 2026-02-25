import { AppIcon } from "../ui/AppIcon";
import React, { useEffect, useRef, useState } from "react";
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
  highlight = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        marginBottom: 10,
        borderRadius: "var(--radius-xs)",
        padding: highlight ? "2px 5px" : "2px 5px",
        background: highlight ? "rgba(166,227,161,0.08)" : "transparent",
        transition: "background 0.6s ease",
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

// ─── SyncDot — pulses green on change, fades to neutral ───────────

function SyncDot({
  pulsing,
  lastSynced,
}: {
  pulsing: boolean;
  lastSynced: Date | null;
}) {
  if (!lastSynced) return null;
  return (
    <span
      title={`Last synced ${lastSynced.toLocaleTimeString()}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: "var(--font-size-xs)",
        color: pulsing ? "var(--ctp-green)" : "var(--text-faint)",
        fontFamily: "var(--font-mono)",
        transition: "color 0.6s ease",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          display: "inline-block",
          background: pulsing ? "var(--ctp-green)" : "var(--border-default)",
          boxShadow: pulsing ? "0 0 8px var(--ctp-green)" : "none",
          transition: "background 0.6s ease, box-shadow 0.6s ease",
        }}
      />
      synced
    </span>
  );
}

// ─── PodRow ───────────────────────────────────────────────────────

function PodRow({
  pod,
  index,
}: {
  pod: {
    name: string;
    namespace: string;
    phase: string;
    ready: number;
    total: number;
    restarts: number;
  };
  index: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 8px",
        borderTop: index === 0 ? "none" : "1px solid var(--border-subtle)",
        background: "var(--bg-surface)",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          flexShrink: 0,
          background:
            pod.phase === "Running"
              ? "var(--status-ok)"
              : pod.phase === "Pending"
                ? "var(--status-warn)"
                : "var(--status-error)",
        }}
      />
      <span
        style={{
          flex: 1,
          fontSize: "var(--font-size-xs)",
          fontFamily: "var(--font-mono)",
          color: "var(--text-faint)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {pod.name}
      </span>
      <span
        style={{
          fontSize: "var(--font-size-xs)",
          fontFamily: "var(--font-mono)",
          color: "var(--text-subtle)",
          flexShrink: 0,
        }}
      >
        {pod.ready}/{pod.total}
      </span>
      {pod.restarts > 0 && (
        <span
          style={{
            fontSize: "var(--font-size-xs)",
            fontFamily: "var(--font-mono)",
            color: "var(--ctp-yellow)",
            flexShrink: 0,
          }}
          title="Restart count"
        >
          ↺{pod.restarts}
        </span>
      )}
    </div>
  );
}

// ─── InspectorPanel ───────────────────────────────────────────────

export function InspectorPanel() {
  const selectedEntity = useIDEStore((s) => s.selectedEntity);
  const openTab = useIDEStore((s) => s.openTab);
  const nodes = useIDEStore((s) => s.nodes);
  const clusterStatus = useIDEStore((s) => s.clusterStatus);

  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [pulsing, setPulsing] = useState(false);

  const { type, id, label, filePath } = selectedEntity ?? {};

  const node =
    selectedEntity && type === "field"
      ? nodes.find((n) => n.id === id)
      : selectedEntity && (type === "graphNode" || type === "file")
        ? nodes.find((n) => n.file_path === filePath || n.id === id)
        : null;

  const clusterInfo = node
    ? clusterStatus?.fields.find((f) => f.label === node.label)
    : null;

  // Snapshot of previous values — used for diff highlighting
  const prevRef = useRef({
    image: "",
    replicas: null as number | null,
    namespace: "",
    kind: "",
  });

  // Detect changes pushed by updateNodeFromFile (from watcher or editor save)
  useEffect(() => {
    if (!node) return;
    const p = prevRef.current;
    const changed =
      p.image !== node.image ||
      p.replicas !== node.replicas ||
      p.namespace !== node.namespace ||
      p.kind !== node.kind;

    if (changed) {
      setLastSynced(new Date());
      setPulsing(true);
      const t = setTimeout(() => setPulsing(false), 1500);
      // Update snapshot AFTER reading diff so highlight logic can compare
      prevRef.current = {
        image: node.image,
        replicas: node.replicas ?? null,
        namespace: node.namespace,
        kind: node.kind,
      };
      return () => clearTimeout(t);
    }
  }, [node?.image, node?.replicas, node?.namespace, node?.kind]);

  // Reset sync state when selection changes
  useEffect(() => {
    setLastSynced(null);
    setPulsing(false);
    prevRef.current = {
      image: node?.image ?? "",
      replicas: node?.replicas ?? null,
      namespace: node?.namespace ?? "",
      kind: node?.kind ?? "",
    };
  }, [id, filePath]);

  if (!selectedEntity || selectedEntity.type === "none") {
    return <EmptyInspector />;
  }

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
      {/* ── Header ── */}
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
            }}
          >
            <SyncDot pulsing={pulsing} lastSynced={lastSynced} />
            {clusterInfo && <StatusBadge status={clusterInfo.status} />}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
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
                    title: filePath.split("/").pop() ?? label ?? "",
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

        {/* Properties — live-synced from YAML via file watcher */}
        {node && (
          <Section title="Properties">
            <PropRow
              label="Kind"
              value={node.kind}
              mono
              highlight={pulsing && prevRef.current.kind !== node.kind}
            />
            <PropRow
              label="Namespace"
              value={node.namespace}
              mono
              highlight={
                pulsing && prevRef.current.namespace !== node.namespace
              }
            />
            {node.image && (
              <PropRow
                label="Image"
                value={node.image}
                mono
                highlight={pulsing && prevRef.current.image !== node.image}
              />
            )}
            {node.replicas != null && (
              <PropRow
                label="Replicas"
                value={String(node.replicas)}
                highlight={
                  pulsing && prevRef.current.replicas !== node.replicas
                }
              />
            )}
            <PropRow
              label="Source"
              value={node.source === "helm" ? "Helm" : "Raw YAML"}
            />
            {node.type_id && <PropRow label="Type" value={node.type_id} mono />}
          </Section>
        )}

        {/* Cluster status */}
        {clusterInfo && (
          <Section title="Cluster">
            <PropRow
              label="Status"
              value={<StatusBadge status={clusterInfo.status} />}
            />
            <PropRow
              label="Ready"
              value={`${clusterInfo.ready} / ${clusterInfo.desired}`}
            />
            {clusterInfo.pods.length > 0 && (
              <div
                style={{
                  marginTop: 6,
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-sm)",
                  overflow: "hidden",
                }}
              >
                {clusterInfo.pods.map((pod, i) => (
                  <PodRow key={pod.name} pod={pod} index={i} />
                ))}
              </div>
            )}
          </Section>
        )}

        {/* Helm pods — all deployments/pods that belong to this helm release */}
        {node?.source === "helm" &&
          node.helm &&
          (() => {
            const releaseName = node.helm.release_name;
            const releaseNs = node.helm.namespace || node.namespace;
            // Collect all FieldStatus entries whose label starts with the release name
            // (helm typically names resources as "<release>-<chart>" or just "<release>")
            const helmFields =
              clusterStatus?.fields.filter((f) => {
                const nsMatch = !releaseNs || f.namespace === releaseNs;
                return (
                  nsMatch &&
                  (f.label === releaseName ||
                    f.label.startsWith(releaseName + "-") ||
                    f.label.startsWith(releaseName + "_"))
                );
              }) ?? [];

            // Collect all pods from those fields (dedup by pod name)
            const seenPods = new Set<string>();
            const allPods = helmFields
              .flatMap((f) => f.pods)
              .filter((p) => {
                if (seenPods.has(p.name)) return false;
                seenPods.add(p.name);
                return true;
              });

            if (allPods.length === 0 && helmFields.length === 0) return null;

            const totalReady = helmFields.reduce((s, f) => s + f.ready, 0);
            const totalDesired = helmFields.reduce((s, f) => s + f.desired, 0);
            const overallStatus =
              totalDesired === 0
                ? "gray"
                : totalReady === totalDesired
                  ? "green"
                  : totalReady === 0
                    ? "red"
                    : "yellow";

            return (
              <Section title="Helm Release">
                <PropRow label="Release" value={releaseName} mono />
                <PropRow
                  label="Status"
                  value={<StatusBadge status={overallStatus} />}
                />
                <PropRow
                  label="Ready"
                  value={`${totalReady} / ${totalDesired}`}
                />
                {helmFields.length > 1 && (
                  <PropRow
                    label="Workloads"
                    value={helmFields.map((f) => f.label).join(", ")}
                    mono
                  />
                )}
                {allPods.length > 0 && (
                  <div
                    style={{
                      marginTop: 6,
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--radius-sm)",
                      overflow: "hidden",
                    }}
                  >
                    {allPods.map((pod, i) => (
                      <PodRow key={pod.name} pod={pod} index={i} />
                    ))}
                  </div>
                )}
              </Section>
            );
          })()}

        {/* File-only info */}
        {type === "file" && !node && (
          <Section title="File">
            <PropRow label="Name" value={label ?? ""} />
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
