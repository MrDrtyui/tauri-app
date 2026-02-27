import React, { useCallback, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useIDEStore } from "../store/ideStore";
import { YamlNode, saveYamlFile, deleteFieldFiles } from "../store/tauriStore";
import { ContextMenu, ContextMenuState } from "../components/ContextMenu";
import { DeleteConfirmDialog } from "../components/DeleteConfirmDialog";
import { EditFieldModal } from "../components/EditFieldModal";
import { AddFieldModal } from "../components/AddFieldModal";
import { executeCommand } from "../commands/commands";
import { AppIcon, resolveNodeIconName, resolveNodeColor } from "../ui/AppIcon";
import {
  IngressRoute,
  discoverIngressRoutes,
  deleteIngressRoute,
  getIngressRouteYaml,
  routeEdgeLabel,
  discoveredToRoute,
} from "./ingressStore";
import { loadRoutesFromFiles } from "./ingressRouteLoader";
import { IngressRouteModal } from "./IngressRouteModal";
import {
  IngressEdgeContextMenu,
  EdgeContextMenuState,
} from "./IngressEdgeContextMenu";

import {
  PostgresConfig,
  DeploymentEnvSpec,
  PostgresConnection,
  inferPostgresConnections,
  postgresServiceName,
  postgresServiceDns,
} from "../store/postgresStore";
import { PostgresConnectionModal } from "./PostgresConnectionModal";

// ─── Node type system — Catppuccin Mocha × macOS Tahoe ───────────
//
// Each node type maps to a Catppuccin accent color.
// Surfaces use very subtle alpha fills to avoid the heavy gradient look.
// Borders are thin (1px) with accent-tinted color at low opacity.
// No Windows-style gradients; backgrounds are near-flat with slight depth.

const NODE_TYPES: Record<
  string,
  {
    bg: string;
    border: string;
    color: string;
    shadow: string;
    accent: string;
    icon: string;
  }
> = {
  gateway: {
    bg: "rgba(137, 180, 250, 0.07)", // ctp-blue tinted surface
    border: "rgba(137, 180, 250, 0.30)",
    color: "#89b4fa", // ctp-blue
    shadow: "rgba(137, 180, 250, 0.12)",
    accent: "#89b4fa",
    icon: "gateway",
  },
  service: {
    bg: "rgba(166, 227, 161, 0.07)", // ctp-green
    border: "rgba(166, 227, 161, 0.28)",
    color: "#a6e3a1",
    shadow: "rgba(166, 227, 161, 0.10)",
    accent: "#a6e3a1",
    icon: "service",
  },
  database: {
    bg: "rgba(116, 199, 236, 0.07)", // ctp-sapphire
    border: "rgba(116, 199, 236, 0.28)",
    color: "#74c7ec",
    shadow: "rgba(116, 199, 236, 0.10)",
    accent: "#74c7ec",
    icon: "database",
  },
  cache: {
    bg: "rgba(250, 179, 135, 0.07)", // ctp-peach
    border: "rgba(250, 179, 135, 0.28)",
    color: "#fab387",
    shadow: "rgba(250, 179, 135, 0.10)",
    accent: "#fab387",
    icon: "cache",
  },
  queue: {
    bg: "rgba(235, 160, 172, 0.07)", // ctp-maroon
    border: "rgba(235, 160, 172, 0.28)",
    color: "#eba0ac",
    shadow: "rgba(235, 160, 172, 0.10)",
    accent: "#eba0ac",
    icon: "queue",
  },
  monitoring: {
    bg: "rgba(203, 166, 247, 0.07)", // ctp-mauve
    border: "rgba(203, 166, 247, 0.28)",
    color: "#cba6f7",
    shadow: "rgba(203, 166, 247, 0.10)",
    accent: "#cba6f7",
    icon: "monitoring",
  },
  infra: {
    bg: "rgba(148, 226, 213, 0.07)", // ctp-teal
    border: "rgba(148, 226, 213, 0.28)",
    color: "#94e2d5",
    shadow: "rgba(148, 226, 213, 0.10)",
    accent: "#94e2d5",
    icon: "helmRelease",
  },
  custom: {
    bg: "rgba(147, 153, 178, 0.07)", // ctp-overlay2
    border: "rgba(147, 153, 178, 0.22)",
    color: "#9399b2",
    shadow: "rgba(147, 153, 178, 0.08)",
    accent: "#9399b2",
    icon: "default",
  },
};

function getType(typeId: string) {
  return NODE_TYPES[typeId] ?? NODE_TYPES.custom;
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    green: "var(--status-ok)",
    yellow: "var(--status-warn)",
    red: "var(--status-error)",
    gray: "var(--status-unknown)",
  };
  const c = colors[status] ?? colors.gray;
  return (
    <span
      style={{
        display: "inline-block",
        width: 5,
        height: 5,
        borderRadius: "50%",
        background: c,
        flexShrink: 0,
      }}
    />
  );
}

// ─── GraphNode ────────────────────────────────────────────────────

function GraphNode({
  node,
  selected,
  renaming,
  renameValue,
  status,
  onMouseDown,
  onClick,
  onContextMenu,
  onRenameChange,
  onRenameCommit,
  renameRef,
  dbConnected,
}: {
  node: YamlNode;
  selected: boolean;
  renaming: boolean;
  renameValue: string;
  status: { status: string; message?: string } | null;
  onMouseDown: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  renameRef: React.RefObject<HTMLInputElement>;
  dbConnected?: boolean;
}) {
  const [hov, setHov] = useState(false);
  const t = getType(node.type_id);

  const borderColor = selected
    ? t.accent
    : hov
      ? t.border.replace("0.28", "0.50")
      : t.border;

  const bgColor = selected
    ? t.bg.replace("0.07", "0.14")
    : hov
      ? t.bg.replace("0.07", "0.11")
      : t.bg;

  const boxShadow = selected
    ? `0 0 0 1.5px ${t.accent}, 0 8px 24px ${t.shadow}, 0 2px 6px rgba(0,0,0,0.4)`
    : hov
      ? `0 4px 16px ${t.shadow}, 0 2px 6px rgba(0,0,0,0.3)`
      : `0 2px 8px rgba(0,0,0,0.25)`;

  return (
    <div
      onMouseDown={onMouseDown}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 158,
        background: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: "var(--radius-lg)",
        padding: "10px 12px",
        cursor: "pointer",
        userSelect: "none",
        boxShadow,
        transition:
          "background 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
        fontFamily: "var(--font-ui)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
    >
      {/* Top row: icon + status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 16,
            color: t.color,
            lineHeight: 1,
            filter: selected ? `drop-shadow(0 0 4px ${t.accent}60)` : "none",
          }}
        >
          <AppIcon
            name={resolveNodeIconName(node.type_id, node.label, node.source)}
            size={16}
            strokeWidth={1.5}
            style={{
              color: t.color,
              filter: selected ? `drop-shadow(0 0 4px ${t.accent}60)` : "none",
            }}
          />
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {/* DB connected badge */}
          {dbConnected && (
            <span
              style={{
                fontSize: 8,
                color: "#74c7ec",
                padding: "1px 4px",
                borderRadius: "var(--radius-xs)",
                background: "rgba(116,199,236,0.12)",
                border: "1px solid rgba(116,199,236,0.25)",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.02em",
              }}
            >
              DB
            </span>
          )}
          {status && <StatusDot status={status.status} />}
        </div>
      </div>

      {/* Name */}
      {renaming ? (
        <input
          ref={renameRef}
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onRenameCommit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onRenameCommit();
            }
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "var(--bg-elevated)",
            border: `1px solid ${t.accent}60`,
            borderRadius: "var(--radius-xs)",
            color: "var(--text-primary)",
            fontSize: "var(--font-size-sm)",
            fontFamily: "var(--font-mono)",
            width: "100%",
            outline: "none",
            padding: "1px 5px",
            marginBottom: 4,
          }}
        />
      ) : (
        <div
          style={{
            color: selected ? "var(--text-primary)" : "var(--text-secondary)",
            fontSize: "var(--font-size-sm)",
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginBottom: 4,
            letterSpacing: "-0.01em",
          }}
        >
          {node.label}
        </div>
      )}

      {/* Metadata row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            color: t.color,
            fontSize: 9,
            opacity: 0.7,
            fontFamily: "var(--font-mono)",
            padding: "1px 5px",
            background: `${t.accent}14`,
            borderRadius: "var(--radius-xs)",
            border: `1px solid ${t.accent}20`,
          }}
        >
          {node.kind}
        </span>
        {node.replicas != null && (
          <span
            style={{
              color: "var(--text-faint)",
              fontSize: 9,
              fontFamily: "var(--font-mono)",
            }}
          >
            ×{node.replicas}
          </span>
        )}
        {node.source === "helm" && (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              color: "var(--text-faint)",
            }}
          >
            <AppIcon name="helmRelease" size={9} strokeWidth={1.5} />
          </span>
        )}
      </div>

      {/* Namespace */}
      <div
        style={{
          color: "var(--text-faint)",
          fontSize: 9,
          fontFamily: "var(--font-mono)",
          marginTop: 5,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {node.namespace}
      </div>
    </div>
  );
}

// ─── GraphPanel ───────────────────────────────────────────────────

export function GraphPanel() {
  const storeNodes = useIDEStore((s) => s.nodes);
  const clusterStatus = useIDEStore((s) => s.clusterStatus);
  const projectPath = useIDEStore((s) => s.projectPath);
  const updateNodePosition = useIDEStore((s) => s.updateNodePosition);
  const setSelectedEntity = useIDEStore((s) => s.setSelectedEntity);
  const renameNode = useIDEStore((s) => s.renameNode);
  const addNode = useIDEStore((s) => s.addNode);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [localPos, setLocalPos] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<YamlNode | null>(null);
  const [editTarget, setEditTarget] = useState<YamlNode | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showAddField, setShowAddField] = useState(false);

  // ── Ingress Route state ───────────────────────────────────────
  const [routes, setRoutes] = useState<IngressRoute[]>([]);
  const [routeModal, setRouteModal] = useState<{
    fieldId: string;
    ingressClassName: string;
    existing?: IngressRoute;
  } | null>(null);
  const [edgeCtxMenu, setEdgeCtxMenu] = useState<EdgeContextMenuState | null>(
    null,
  );
  const [yamlView, setYamlView] = useState<string | null>(null);
  const [deleteRouteTarget, setDeleteRouteTarget] =
    useState<IngressRoute | null>(null);

  // ── PostgreSQL state ──────────────────────────────────────────
  const [postgresFields, setPostgresFields] = useState<PostgresConfig[]>([]);
  const [dbConnections, setDbConnections] = useState<
    Map<string, { fieldId: string; conn: PostgresConnection }>
  >(new Map());
  const [dbConnectModal, setDbConnectModal] = useState<{
    postgresNodeId: string;
  } | null>(null);
  const [dbEdgeCtxMenu, setDbEdgeCtxMenu] =
    useState<DbEdgeContextMenuState | null>(null);

  // Load ingress routes from disk files — source of truth, no cluster needed.
  // Falls back to kubectl discover only when no project is open or files are empty.
  useEffect(() => {
    if (!projectPath) {
      discoverIngressRoutes()
        .then((discovered) => setRoutes(discovered.map(discoveredToRoute)))
        .catch(() => {});
      return;
    }
    loadRoutesFromFiles(projectPath)
      .then((fileRoutes) => {
        if (fileRoutes.length > 0) {
          setRoutes(fileRoutes);
        } else {
          // No route files yet — try kubectl as fallback
          return discoverIngressRoutes()
            .then((discovered) => setRoutes(discovered.map(discoveredToRoute)))
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [projectPath]);

  // Re-run Postgres connection inference whenever nodes change
  // Reads each service's actual YAML file to detect DATABASE_URL/PGHOST/secretRef
  useEffect(() => {
    const pgFields: PostgresConfig[] = storeNodes
      .filter((n) => n.type_id === "database" && n.label)
      .map((n) => ({
        fieldId: n.id,
        name: n.label,
        namespace: n.namespace,
        postgresVersion: "16-alpine",
        databaseName: "appdb",
        username: "postgres",
        password: "",
        port: 5432,
        storageSize: "10Gi",
        storageClass: "",
        deployMode: "raw" as const,
        chartVersion: "",
        enableMetrics: false,
      }));

    setPostgresFields(pgFields);

    if (pgFields.length === 0) {
      setDbConnections(new Map());
      return;
    }

    const serviceNodesList = storeNodes.filter(
      (n) =>
        n.type_id === "service" ||
        n.type_id === "custom" ||
        n.kind === "Deployment",
    );

    const newConnections = new Map<
      string,
      { fieldId: string; conn: PostgresConnection }
    >();

    // Read YAML files in parallel, infer connections from env var patterns
    Promise.all(
      serviceNodesList.map(async (svcNode) => {
        const envVars: DeploymentEnvSpec["envVars"] = [];

        if (svcNode.file_path) {
          try {
            const { readYamlFile: readYaml } =
              await import("../store/tauriStore");
            const yaml = await readYaml(svcNode.file_path);

            const dbUrlMatch = yaml.match(
              /DATABASE_URL[^:]*:\s*["']?([^\n"']+)/,
            );
            if (dbUrlMatch)
              envVars.push({
                key: "DATABASE_URL",
                value: dbUrlMatch[1].trim(),
              });

            const pgHostMatch = yaml.match(/PGHOST[^:]*:\s*["']?([^\n"']+)/);
            if (pgHostMatch)
              envVars.push({ key: "PGHOST", value: pgHostMatch[1].trim() });

            // secretKeyRef blocks
            for (const m of yaml.matchAll(/name:\s+([^\s\n]+)-credentials/g)) {
              envVars.push({
                key: "_secretRef",
                value: "",
                secretRef: { secretName: m[1] + "-credentials" },
              });
            }
            for (const m of yaml.matchAll(/name:\s+([^\s\n]+)-secret\b/g)) {
              envVars.push({
                key: "_secretRef",
                value: "",
                secretRef: { secretName: m[1] + "-secret" },
              });
            }
          } catch {
            /* file unreadable */
          }
        }

        const spec: DeploymentEnvSpec = {
          nodeId: svcNode.id,
          nodeLabel: svcNode.label,
          nodeNamespace: svcNode.namespace,
          envVars,
        };

        const conns = inferPostgresConnections(spec, pgFields);
        conns.forEach((c) => {
          const pgField =
            pgFields.find((f) => {
              const svcName = postgresServiceName(f.name);
              const dns = postgresServiceDns(f.name, f.namespace);
              return (
                c.envVars.some((v) => v.includes(svcName) || v.includes(dns)) ||
                envVars.some((e) =>
                  e.secretRef?.secretName?.startsWith(svcName),
                )
              );
            }) ?? pgFields[0];
          if (pgField) {
            newConnections.set(svcNode.id, {
              fieldId: pgField.fieldId,
              conn: c,
            });
          }
        });
      }),
    ).then(() => {
      setDbConnections(new Map(newConnections));
    });
  }, [storeNodes]);

  const namespace = storeNodes[0]?.namespace ?? "default";
  const canvasRef = useRef<HTMLDivElement>(null);
  const fittedRef = useRef(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const draggingNode = useRef<{
    id: string;
    offX: number;
    offY: number;
  } | null>(null);

  const getNodePos = (n: YamlNode) => localPos[n.id] ?? { x: n.x, y: n.y };

  // ── Node drag ─────────────────────────────────────────────────
  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (renamingId === nodeId) return;
      const r = canvasRef.current!.getBoundingClientRect();
      const node = storeNodes.find((n) => n.id === nodeId);
      if (!node) return;
      const pos = localPos[nodeId] ?? { x: node.x, y: node.y };
      draggingNode.current = {
        id: nodeId,
        offX: (e.clientX - r.left - pan.x) / zoom - pos.x,
        offY: (e.clientY - r.top - pan.y) / zoom - pos.y,
      };
      let lastPos = pos;
      const onMove = (me: MouseEvent) => {
        if (!draggingNode.current) return;
        const nx =
          (me.clientX - r.left - pan.x - draggingNode.current.offX) / zoom;
        const ny =
          (me.clientY - r.top - pan.y - draggingNode.current.offY) / zoom;
        lastPos = { x: nx, y: ny };
        setLocalPos((prev) => ({ ...prev, [nodeId]: lastPos }));
      };
      const onUp = () => {
        updateNodePosition(nodeId, lastPos.x, lastPos.y);
        draggingNode.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [storeNodes, pan, zoom, localPos, updateNodePosition, renamingId],
  );

  const handleNodeClick = useCallback((e: React.MouseEvent, node: YamlNode) => {
    e.stopPropagation();
    setSelectedId(node.id);
    executeCommand("field.properties", { node });
  }, []);

  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: YamlNode) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ node, x: e.clientX, y: e.clientY });
      setSelectedId(node.id);
    },
    [],
  );

  // ── IngressNginx node helpers ─────────────────────────────────
  const isIngressNode = (node: YamlNode) =>
    node.type_id === "gateway" &&
    (node.kind === "HelmRelease" ||
      node.label.toLowerCase().includes("ingress") ||
      node.label.toLowerCase().includes("nginx"));

  const getIngressClassName = (node: YamlNode): string => {
    if (node.helm?.chart_name?.includes("ingress-nginx")) return "nginx";
    return "nginx";
  };

  const handleCreateRoute = useCallback((node: YamlNode) => {
    setRouteModal({
      fieldId: node.id,
      ingressClassName: getIngressClassName(node),
    });
  }, []);

  // ── Is a service node (can connect to DB) ─────────────────────
  const isServiceNode = (node: YamlNode) =>
    node.type_id === "service" ||
    node.type_id === "custom" ||
    node.kind === "Deployment";

  // ── Canvas pan ───────────────────────────────────────────────
  const panState = useRef<{
    startX: number;
    startY: number;
    startPan: { x: number; y: number };
  } | null>(null);
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target !== canvasRef.current && !target.classList.contains("canvas-bg"))
      return;
    setSelectedId(null);
    setContextMenu(null);
    panState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPan: { ...pan },
    };
    const onMove = (me: MouseEvent) => {
      if (!panState.current) return;
      setPan({
        x: panState.current.startPan.x + me.clientX - panState.current.startX,
        y: panState.current.startPan.y + me.clientY - panState.current.startY,
      });
    };
    const onUp = () => {
      panState.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.25, Math.min(3, z * (e.deltaY < 0 ? 1.1 : 0.9))));
  };

  // ── Fit view ──────────────────────────────────────────────────
  const fitView = useCallback(() => {
    if (!canvasRef.current || storeNodes.length === 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const xs = storeNodes.map((n) => (localPos[n.id] ?? n).x);
    const ys = storeNodes.map((n) => (localPos[n.id] ?? n).y);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs) + 158;
    const minY = Math.min(...ys),
      maxY = Math.max(...ys) + 90;
    const newZoom =
      Math.min(
        rect.width / (maxX - minX + 80),
        rect.height / (maxY - minY + 80),
        1.5,
      ) * 0.85;
    setPan({
      x: rect.width / 2 - ((minX + maxX) / 2) * newZoom,
      y: rect.height / 2 - ((minY + maxY) / 2) * newZoom,
    });
    setZoom(newZoom);
  }, [storeNodes, localPos]);

  useEffect(() => {
    if (storeNodes.length > 0 && !fittedRef.current) {
      fittedRef.current = true;
      fitView();
    }
  }, [storeNodes, fitView]);

  // ── Inline rename ─────────────────────────────────────────────
  const startRename = (node: YamlNode) => {
    setRenamingId(node.id);
    setRenameValue(node.label);
    setTimeout(() => renameRef.current?.select(), 30);
  };

  const commitRename = () => {
    if (renamingId && renameValue.trim()) {
      executeCommand("field.rename", {
        node: storeNodes.find((n) => n.id === renamingId)!,
        newName: renameValue.trim(),
      });
    }
    setRenamingId(null);
  };

  const getStatus = (node: YamlNode) =>
    clusterStatus?.fields.find((f) => f.label === node.label) ?? null;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "var(--bg-primary)",
      }}
      onWheel={handleWheel}
    >
      {/* Canvas background — subtle dot grid */}
      <div
        className="canvas-bg"
        ref={canvasRef}
        onMouseDown={handleCanvasMouseDown}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `radial-gradient(circle, var(--ctp-surface1) 1px, transparent 1px)`,
          backgroundSize: `${28 * zoom}px ${28 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
          cursor: "default",
          opacity: 0.45,
        }}
      />

      {/* Empty state */}
      {storeNodes.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-faint)",
            fontFamily: "var(--font-ui)",
            pointerEvents: "none",
            gap: 10,
          }}
        >
          <span style={{ opacity: 0.25, display: "flex" }}>
            <AppIcon name="graph" size={28} strokeWidth={1.25} />
          </span>
          <div style={{ fontSize: "var(--font-size-sm)", opacity: 0.4 }}>
            Open a project to see the graph
          </div>
        </div>
      )}

      {/* Ingress route edges — SVG layer */}
      <svg
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          overflow: "visible",
          zIndex: 1,
        }}
      >
        <defs>
          <marker
            id="ingress-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L0,6 L8,3 z" fill="#89b4fa" opacity={0.7} />
          </marker>
        </defs>
        {routes.map((route) => {
          const srcNode = storeNodes.find((n) => n.id === route.field_id);

          let tgtNode = storeNodes.find(
            (n) =>
              n.label === route.target_service &&
              n.namespace === route.target_namespace,
          );
          if (!tgtNode) {
            tgtNode = storeNodes.find(
              (n) =>
                n.source === "helm" &&
                n.helm != null &&
                (n.namespace === route.target_namespace ||
                  n.helm.namespace === route.target_namespace) &&
                (route.target_service === n.helm.release_name ||
                  route.target_service.startsWith(n.helm.release_name + "-") ||
                  route.target_service.startsWith(n.helm.release_name + "_") ||
                  n.helm.release_name.startsWith(route.target_service)),
            );
          }

          if (!srcNode || !tgtNode) return null;

          const srcPos = localPos[srcNode.id] ?? { x: srcNode.x, y: srcNode.y };
          const tgtPos = localPos[tgtNode.id] ?? { x: tgtNode.x, y: tgtNode.y };

          const nodeW = 158,
            nodeH = 88;

          const x1 = pan.x + (srcPos.x + nodeW) * zoom;
          const y1 = pan.y + (srcPos.y + nodeH / 2) * zoom;
          const x2 = pan.x + tgtPos.x * zoom;
          const y2 = pan.y + (tgtPos.y + nodeH / 2) * zoom;

          const cx1 = x1 + 60 * zoom;
          const cx2 = x2 - 60 * zoom;

          const label = routeEdgeLabel(route);
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2 - 12 * zoom;

          return (
            <g
              key={route.route_id}
              style={{ pointerEvents: "all", cursor: "pointer" }}
              onContextMenu={(e) => {
                e.preventDefault();
                setEdgeCtxMenu({ route, x: e.clientX, y: e.clientY });
              }}
            >
              <path
                d={`M${x1},${y1} C${cx1},${y1} ${cx2},${y2} ${x2},${y2}`}
                fill="none"
                stroke="transparent"
                strokeWidth={14}
              />
              <path
                d={`M${x1},${y1} C${cx1},${y1} ${cx2},${y2} ${x2},${y2}`}
                fill="none"
                stroke="#89b4fa"
                strokeWidth={1.5}
                strokeOpacity={0.55}
                strokeDasharray="6,4"
                markerEnd="url(#ingress-arrow)"
              />
              <text
                x={midX}
                y={midY}
                textAnchor="middle"
                fill="#89b4fa"
                fontSize={10 * zoom}
                fontFamily="var(--font-mono)"
                opacity={0.75}
                style={{ userSelect: "none" }}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* PostgreSQL DB connection edges — SVG layer */}
      <svg
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          overflow: "visible",
          zIndex: 2,
        }}
      >
        <defs>
          <marker
            id="db-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L0,6 L8,3 z" fill="#74c7ec" opacity={0.7} />
          </marker>
        </defs>
        {Array.from(dbConnections.entries()).map(
          ([svcNodeId, { fieldId, conn }]) => {
            const svcNode = storeNodes.find((n) => n.id === svcNodeId);
            const pgNode = storeNodes.find((n) => n.id === fieldId);
            if (!svcNode || !pgNode) return null;

            const svcPos = localPos[svcNode.id] ?? {
              x: svcNode.x,
              y: svcNode.y,
            };
            const pgPos = localPos[pgNode.id] ?? { x: pgNode.x, y: pgNode.y };

            const nodeW = 158,
              nodeH = 88;

            // Service right edge → Postgres left edge
            const x1 = pan.x + (svcPos.x + nodeW) * zoom;
            const y1 = pan.y + (svcPos.y + nodeH / 2) * zoom;
            const x2 = pan.x + pgPos.x * zoom;
            const y2 = pan.y + (pgPos.y + nodeH / 2) * zoom;

            const cx1 = x1 + 50 * zoom;
            const cx2 = x2 - 50 * zoom;

            return (
              <g
                key={`db-${svcNodeId}-${fieldId}`}
                style={{ pointerEvents: "all", cursor: "default" }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const svcNode = storeNodes.find((n) => n.id === svcNodeId);
                  const pgNode = storeNodes.find((n) => n.id === fieldId);
                  if (svcNode && pgNode) {
                    setDbEdgeCtxMenu({
                      svcNode,
                      pgNode,
                      conn,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }
                }}
              >
                {/* Wide invisible hit area for hover */}
                <path
                  d={`M${x1},${y1} C${cx1},${y1} ${cx2},${y2} ${x2},${y2}`}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                />
                {/* Visible edge — sapphire blue, tighter dash */}
                <path
                  d={`M${x1},${y1} C${cx1},${y1} ${cx2},${y2} ${x2},${y2}`}
                  fill="none"
                  stroke="#74c7ec"
                  strokeWidth={1.5}
                  strokeOpacity={0.5}
                  strokeDasharray="4,3"
                  markerEnd="url(#db-arrow)"
                />
              </g>
            );
          },
        )}
      </svg>

      {/* Nodes */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          overflow: "visible",
        }}
      >
        {storeNodes.map((node) => {
          const pos = getNodePos(node);
          return (
            <div
              key={node.id}
              style={{
                position: "absolute",
                left: pan.x + pos.x * zoom,
                top: pan.y + pos.y * zoom,
                pointerEvents: "all",
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
              }}
            >
              <GraphNode
                node={node}
                selected={selectedId === node.id}
                renaming={renamingId === node.id}
                renameValue={renameValue}
                status={getStatus(node)}
                onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                onClick={(e) => handleNodeClick(e, node)}
                onContextMenu={(e) => handleNodeContextMenu(e, node)}
                onRenameChange={setRenameValue}
                onRenameCommit={commitRename}
                renameRef={renameRef}
                dbConnected={
                  node.type_id === "database"
                    ? Array.from(dbConnections.values()).some(
                        (c) => c.fieldId === node.id,
                      )
                    : dbConnections.has(node.id)
                }
              />
            </div>
          );
        })}
      </div>

      {/* Toolbar — blurred floating surface */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          zIndex: 10,
          display: "flex",
          gap: 6,
          background: "var(--bg-modal)",
          backdropFilter: "var(--blur-md)",
          WebkitBackdropFilter: "var(--blur-md)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-lg)",
          padding: "5px 6px",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        {projectPath && (
          <ToolbarButton
            onClick={() => setShowAddField(true)}
            title="Add Field"
            accent
          >
            + Add Field
          </ToolbarButton>
        )}
        <ToolbarButton onClick={fitView} title="Fit to view">
          <AppIcon
            name="fitView"
            size={12}
            strokeWidth={2}
            style={{ marginRight: 4 }}
          />
          Fit
        </ToolbarButton>
        <ZoomDisplay zoom={zoom} />
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onRename={(node) => {
            startRename(node);
            setContextMenu(null);
          }}
          onEdit={(node) => {
            setEditTarget(node);
            setContextMenu(null);
          }}
          onDelete={(node) => {
            setDeleteTarget(node);
            setContextMenu(null);
          }}
          extraItems={
            contextMenu.node &&
            isServiceNode(contextMenu.node) &&
            postgresFields.length > 0
              ? [
                  {
                    label: "Connect to PostgreSQL…",
                    icon: "database",
                    action: () => {
                      const node = contextMenu.node!;
                      setDbConnectModal({
                        serviceNodeId: node.id,
                        serviceLabel: node.label,
                        serviceNamespace: node.namespace,
                      });
                      setContextMenu(null);
                    },
                  },
                ]
              : []
          }
        />
      )}

      {/* IngressNginx "Create Route" floating button */}
      {selectedId &&
        (() => {
          const node = storeNodes.find((n) => n.id === selectedId);
          if (!node || !isIngressNode(node)) return null;
          const pos = getNodePos(node);
          return (
            <div
              style={{
                position: "absolute",
                left: pan.x + pos.x * zoom,
                top: pan.y + (pos.y + 96) * zoom,
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
                zIndex: 20,
                pointerEvents: "all",
              }}
            >
              <button
                onClick={() => handleCreateRoute(node)}
                style={{
                  background: "rgba(137,180,250,0.14)",
                  border: "1px solid rgba(137,180,250,0.4)",
                  borderRadius: "var(--radius-sm)",
                  color: "#89b4fa",
                  cursor: "pointer",
                  fontSize: "var(--font-size-xs)",
                  fontFamily: "var(--font-ui)",
                  fontWeight: 500,
                  padding: "3px 10px",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  whiteSpace: "nowrap",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <AppIcon name="add" size={10} strokeWidth={2.5} />
                Create Route
              </button>
            </div>
          );
        })()}

      {/* "Connect to Service" floating button — shown when postgres node is selected */}
      {selectedId &&
        (() => {
          const node = storeNodes.find((n) => n.id === selectedId);
          if (!node || node.type_id !== "database") return null;
          const pos = getNodePos(node);
          // Count how many services are already connected to this postgres node
          const connectedCount = Array.from(dbConnections.values()).filter(
            (c) => c.fieldId === node.id,
          ).length;
          return (
            <div
              style={{
                position: "absolute",
                left: pan.x + pos.x * zoom,
                top: pan.y + (pos.y + 96) * zoom,
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
                zIndex: 20,
                pointerEvents: "all",
              }}
            >
              <button
                onClick={() => setDbConnectModal({ postgresNodeId: node.id })}
                style={{
                  background:
                    connectedCount > 0
                      ? "rgba(116,199,236,0.18)"
                      : "rgba(116,199,236,0.10)",
                  border: `1px solid rgba(116,199,236,${connectedCount > 0 ? "0.50" : "0.30"})`,
                  borderRadius: "var(--radius-sm)",
                  color: "#74c7ec",
                  cursor: "pointer",
                  fontSize: "var(--font-size-xs)",
                  fontFamily: "var(--font-ui)",
                  fontWeight: 500,
                  padding: "3px 10px",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  whiteSpace: "nowrap",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <AppIcon name="database" size={10} strokeWidth={2} />
                {connectedCount > 0
                  ? `${connectedCount} service${connectedCount > 1 ? "s" : ""} connected`
                  : "Connect Service"}
              </button>
            </div>
          );
        })()}

      {deleteTarget && (
        <DeleteConfirmDialog
          node={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {editTarget && (
        <EditFieldModal node={editTarget} onClose={() => setEditTarget(null)} />
      )}

      {showAddField && projectPath && (
        <AddFieldModal
          projectPath={projectPath}
          namespace={namespace}
          onAdd={(node) => {
            addNode(node);
            setShowAddField(false);
          }}
          onClose={() => setShowAddField(false)}
        />
      )}

      {/* Ingress Route Modal (create/edit) */}
      {routeModal && (
        <IngressRouteModal
          fieldId={routeModal.fieldId}
          ingressClassName={routeModal.ingressClassName}
          existing={routeModal.existing}
          onSave={(route) => {
            setRoutes((prev) => {
              const idx = prev.findIndex((r) => r.route_id === route.route_id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = route;
                return next;
              }
              return [...prev, route];
            });
            if (projectPath) {
              getIngressRouteYaml(route)
                .then((yaml) => {
                  const ingressNode = storeNodes.find(
                    (n) => n.id === route.field_id,
                  );
                  const ingressDir = ingressNode?.file_path
                    ? ingressNode.file_path.substring(
                        0,
                        ingressNode.file_path.lastIndexOf("/helm/"),
                      )
                    : `${projectPath}/infra/${route.field_id}`;
                  return saveYamlFile(
                    `${ingressDir}/routes/${route.ingress_name}.yaml`,
                    yaml,
                  );
                })
                .catch((e) =>
                  console.warn("[ingress] failed to save route yaml:", e),
                );
            }
            setRouteModal(null);
          }}
          onClose={() => setRouteModal(null)}
        />
      )}

      {/* PostgreSQL Connection Modal */}
      {dbConnectModal &&
        (() => {
          const pgNode = storeNodes.find(
            (n) => n.id === dbConnectModal.postgresNodeId,
          );
          const pgConfig = postgresFields.find(
            (f) => f.fieldId === dbConnectModal.postgresNodeId,
          );
          if (!pgNode || !pgConfig) return null;
          const svcNodes = storeNodes.filter(
            (n) =>
              n.type_id === "service" ||
              n.type_id === "custom" ||
              n.kind === "Deployment",
          );
          return (
            <PostgresConnectionModal
              postgresNode={pgNode}
              postgresConfig={pgConfig}
              serviceNodes={svcNodes}
              onClose={() => setDbConnectModal(null)}
              onConnect={(serviceNodeId, postgresFieldId, envVarNames) => {
                setDbConnections((prev) => {
                  const next = new Map(prev);
                  next.set(serviceNodeId, {
                    fieldId: postgresFieldId,
                    conn: {
                      serviceNodeId,
                      reason: "DATABASE_URL",
                      envVars: envVarNames,
                    },
                  });
                  return next;
                });
              }}
            />
          );
        })()}

      {/* Edge right-click context menu */}
      {edgeCtxMenu && (
        <IngressEdgeContextMenu
          state={edgeCtxMenu}
          onClose={() => setEdgeCtxMenu(null)}
          onEdit={(route) => {
            const srcNode = storeNodes.find((n) => n.id === route.field_id);
            setRouteModal({
              fieldId: route.field_id,
              ingressClassName: srcNode
                ? getIngressClassName(srcNode)
                : route.ingress_class_name,
              existing: route,
            });
          }}
          onDelete={(route) => setDeleteRouteTarget(route)}
          onViewYaml={async (route) => {
            try {
              const yaml = await getIngressRouteYaml(route);
              setYamlView(yaml);
            } catch {
              setYamlView("# Error generating YAML");
            }
          }}
          onJumpToService={(route) => {
            let tgtNode = storeNodes.find(
              (n) =>
                n.label === route.target_service &&
                n.namespace === route.target_namespace,
            );
            if (!tgtNode) {
              tgtNode = storeNodes.find(
                (n) =>
                  n.source === "helm" &&
                  n.helm != null &&
                  (n.namespace === route.target_namespace ||
                    n.helm.namespace === route.target_namespace) &&
                  (route.target_service === n.helm.release_name ||
                    route.target_service.startsWith(
                      n.helm.release_name + "-",
                    ) ||
                    route.target_service.startsWith(
                      n.helm.release_name + "_",
                    ) ||
                    n.helm.release_name.startsWith(route.target_service)),
              );
            }
            if (tgtNode) {
              setSelectedId(tgtNode.id);
              executeCommand("field.properties", { node: tgtNode });
            }
          }}
        />
      )}

      {/* DB edge right-click context menu */}
      {dbEdgeCtxMenu && (
        <DbEdgeContextMenu
          state={dbEdgeCtxMenu}
          onClose={() => setDbEdgeCtxMenu(null)}
          onDisconnect={async (svcNodeId) => {
            const svcNode = storeNodes.find((n) => n.id === svcNodeId);
            if (svcNode?.file_path) {
              try {
                const { readYamlFile, saveYamlFile: saveYaml } =
                  await import("../store/tauriStore");
                const yaml = await readYamlFile(svcNode.file_path);
                // Remove lines containing DB env keys
                const dbEnvKeys = [
                  "DATABASE_URL",
                  "PGHOST",
                  "PGPORT",
                  "PGUSER",
                  "PGPASSWORD",
                  "PGDATABASE",
                ];
                const pattern = new RegExp(
                  `^[\\s\\S]*?(${dbEnvKeys.join("|")})[\\s\\S]*?\\n`,
                  "gm",
                );
                // Line-by-line removal of env var entries
                const lines = yaml.split("\n");
                let skipNext = false;
                const filtered = lines.filter((line) => {
                  if (skipNext && /^\s+-\s+/.test(line)) {
                    skipNext = false;
                    return false;
                  }
                  skipNext = false;
                  const isDbKey = dbEnvKeys.some((k) =>
                    new RegExp(`\\b${k}\\b`).test(line),
                  );
                  if (isDbKey) {
                    return false;
                  }
                  return true;
                });
                await saveYaml(svcNode.file_path, filtered.join("\n"));
              } catch {
                /* ignore file errors */
              }
            }
            setDbConnections((prev) => {
              const next = new Map(prev);
              next.delete(svcNodeId);
              return next;
            });
          }}
          onJumpToService={(node) => {
            setSelectedId(node.id);
            executeCommand("field.properties", { node });
          }}
          onJumpToDatabase={(node) => {
            setSelectedId(node.id);
            executeCommand("field.properties", { node });
          }}
        />
      )}

      {/* Delete route confirmation */}
      {deleteRouteTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 10001,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "var(--bg-modal)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-lg)",
              padding: 24,
              width: 360,
              boxShadow: "var(--shadow-lg)",
              fontFamily: "var(--font-ui)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>
              Delete Ingress Route?
            </div>
            <div
              style={{
                color: "var(--text-secondary)",
                fontSize: "var(--font-size-sm)",
              }}
            >
              This will delete the Kubernetes Ingress resource{" "}
              <code
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--ctp-red)",
                }}
              >
                {deleteRouteTarget.ingress_name}
              </code>{" "}
              in namespace{" "}
              <code style={{ fontFamily: "var(--font-mono)" }}>
                {deleteRouteTarget.ingress_namespace}
              </code>
              .
            </div>
            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}
            >
              <button
                onClick={() => setDeleteRouteTarget(null)}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  padding: "5px 14px",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--font-size-sm)",
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    await deleteIngressRoute(
                      deleteRouteTarget.ingress_name,
                      deleteRouteTarget.ingress_namespace,
                    );
                    if (projectPath) {
                      const ingressNode = storeNodes.find(
                        (n) => n.id === deleteRouteTarget!.field_id,
                      );
                      const ingressDir = ingressNode?.file_path
                        ? ingressNode.file_path.substring(
                            0,
                            ingressNode.file_path.lastIndexOf("/helm/"),
                          )
                        : `${projectPath}/infra/${deleteRouteTarget!.field_id}`;
                      const routeFile = `${ingressDir}/routes/${deleteRouteTarget!.ingress_name}.yaml`;
                      deleteFieldFiles(
                        [routeFile],
                        deleteRouteTarget!.ingress_namespace,
                      ).catch(() => {});
                    }
                  } catch {
                    /* ignore */
                  }
                  setRoutes((prev) =>
                    prev.filter(
                      (r) => r.route_id !== deleteRouteTarget!.route_id,
                    ),
                  );
                  setDeleteRouteTarget(null);
                }}
                style={{
                  background: "rgba(243,139,168,0.12)",
                  border: "1px solid rgba(243,139,168,0.35)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--ctp-red)",
                  cursor: "pointer",
                  padding: "5px 14px",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--font-size-sm)",
                  fontWeight: 500,
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* YAML viewer modal */}
      {yamlView !== null && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 10001,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setYamlView(null);
          }}
        >
          <div
            style={{
              background: "var(--bg-modal)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-lg)",
              padding: 24,
              width: 600,
              maxWidth: "90vw",
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              boxShadow: "var(--shadow-lg)",
              fontFamily: "var(--font-ui)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                Generated Ingress YAML
              </div>
              <button
                onClick={() => setYamlView(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-faint)",
                  cursor: "pointer",
                  display: "flex",
                }}
              >
                <AppIcon name="close" size={16} strokeWidth={2} />
              </button>
            </div>
            <pre
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                padding: 12,
                overflowY: "auto",
                flex: 1,
                margin: 0,
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--text-secondary)",
                whiteSpace: "pre",
              }}
            >
              {yamlView}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Toolbar helpers ───────────────────────────────────────────────

function ToolbarButton({
  children,
  onClick,
  title,
  accent,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  accent?: boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        height: 26,
        padding: "0 10px",
        background: accent
          ? hov
            ? "rgba(203, 166, 247, 0.22)"
            : "rgba(203, 166, 247, 0.12)"
          : hov
            ? "var(--bg-elevated)"
            : "transparent",
        border: accent
          ? "1px solid rgba(203, 166, 247, 0.3)"
          : "1px solid transparent",
        borderRadius: "var(--radius-sm)",
        color: accent ? "var(--accent)" : "var(--text-muted)",
        cursor: "pointer",
        fontSize: "var(--font-size-xs)",
        display: "flex",
        alignItems: "center",
        gap: 5,
        fontFamily: "var(--font-ui)",
        fontWeight: accent ? 500 : 400,
        transition: "var(--ease-fast)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function ZoomDisplay({ zoom }: { zoom: number }) {
  return (
    <div
      style={{
        height: 26,
        padding: "0 8px",
        display: "flex",
        alignItems: "center",
        color: "var(--text-faint)",
        fontSize: "var(--font-size-xs)",
        fontFamily: "var(--font-mono)",
        minWidth: 44,
        justifyContent: "center",
      }}
    >
      {Math.round(zoom * 100)}%
    </div>
  );
}

// ─── DB Edge Context Menu ──────────────────────────────────────────

interface DbEdgeContextMenuState {
  svcNode: YamlNode;
  pgNode: YamlNode;
  conn: PostgresConnection;
  x: number;
  y: number;
}

function DbEdgeContextMenu({
  state,
  onClose,
  onDisconnect,
  onJumpToService,
  onJumpToDatabase,
}: {
  state: DbEdgeContextMenuState;
  onClose: () => void;
  onDisconnect: (svcNodeId: string) => void;
  onJumpToService: (node: YamlNode) => void;
  onJumpToDatabase: (node: YamlNode) => void;
}) {
  const { svcNode, pgNode, conn, x, y } = state;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  const menuW = 230;
  const menuH = 200;
  const left = Math.min(x, window.innerWidth - menuW - 8);
  const top = Math.min(y, window.innerHeight - menuH - 8);

  const envLabel = conn.envVars
    .filter((v) => !v.startsWith("("))
    .slice(0, 3)
    .join(", ");

  const items = [
    {
      id: "jumpSvc",
      label: `Jump to ${svcNode.label}`,
      icon: "service" as const,
      action: () => {
        onJumpToService(svcNode);
        onClose();
      },
    },
    {
      id: "jumpDb",
      label: `Jump to ${pgNode.label}`,
      icon: "database" as const,
      action: () => {
        onJumpToDatabase(pgNode);
        onClose();
      },
    },
    {
      id: "disconnect",
      label: "Remove DB connection",
      icon: "delete" as const,
      danger: true,
      dividerBefore: true,
      action: () => {
        onDisconnect(svcNode.id);
        onClose();
      },
    },
  ];

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        top,
        left,
        background: "var(--bg-modal)",
        backdropFilter: "var(--blur-md)",
        WebkitBackdropFilter: "var(--blur-md)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-lg)",
        padding: "4px 0",
        minWidth: menuW,
        boxShadow: "var(--shadow-lg)",
        zIndex: 9999,
        animation: "ef-slidein 0.12s ease-out",
        fontFamily: "var(--font-ui)",
      }}
    >
      <div
        style={{
          padding: "8px 12px 6px",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 2,
        }}
      >
        <span
          style={{ color: "#74c7ec", display: "flex", alignItems: "center" }}
        >
          <AppIcon name="database" size={14} strokeWidth={1.75} />
        </span>
        <div>
          <div
            style={{
              color: "var(--text-primary)",
              fontSize: "var(--font-size-sm)",
              fontWeight: 500,
            }}
          >
            DB Connection
          </div>
          <div
            style={{
              color: "var(--text-faint)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              maxWidth: 190,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {svcNode.label} → {pgNode.label}
            {envLabel ? ` · ${envLabel}` : ""}
          </div>
        </div>
      </div>

      {items.map((item) => (
        <React.Fragment key={item.id}>
          {item.dividerBefore && (
            <div
              style={{
                height: 1,
                background: "var(--border-subtle)",
                margin: "3px 0",
              }}
            />
          )}
          <DbEdgeMenuItem
            label={item.label}
            icon={item.icon}
            danger={item.danger}
            onClick={item.action}
          />
        </React.Fragment>
      ))}
    </div>,
    document.body,
  );
}

function DbEdgeMenuItem({
  label,
  icon,
  danger,
  onClick,
}: {
  label: string;
  icon: Parameters<typeof AppIcon>[0]["name"];
  danger?: boolean;
  onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 12px 5px 10px",
        cursor: "pointer",
        background: hov
          ? danger
            ? "rgba(243,139,168,0.08)"
            : "var(--bg-sidebar-active)"
          : "transparent",
        color: danger
          ? "var(--ctp-red)"
          : hov
            ? "var(--text-primary)"
            : "var(--text-secondary)",
        fontSize: "var(--font-size-sm)",
        transition: "var(--ease-fast)",
        borderRadius: "var(--radius-xs)",
        margin: "1px 4px",
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          opacity: danger ? 1 : 0.7,
        }}
      >
        <AppIcon name={icon} size={13} strokeWidth={1.75} />
      </span>
      {label}
    </div>
  );
}
