import React, { useCallback, useRef, useState, useEffect } from "react";
import { useIDEStore } from "../store/ideStore";
import { YamlNode } from "../store/tauriStore";
import { ContextMenu, ContextMenuState } from "../components/ContextMenu";
import { DeleteConfirmDialog } from "../components/DeleteConfirmDialog";
import { AddFieldModal } from "../components/AddFieldModal";
import { executeCommand } from "../commands/commands";
import { AppIcon, resolveNodeIconName, resolveNodeColor } from "../ui/AppIcon";

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
        {status && <StatusDot status={status.status} />}
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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [localPos, setLocalPos] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<YamlNode | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showAddField, setShowAddField] = useState(false);

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
          onDelete={(node) => {
            setDeleteTarget(node);
            setContextMenu(null);
          }}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmDialog
          node={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
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
