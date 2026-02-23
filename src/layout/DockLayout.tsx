import React, { useCallback, useEffect } from "react";
import { useIDEStore } from "../store/ideStore";
import { DockAreaView } from "./DockAreaView";
import { DragPreview } from "./DragPreview";
import { Resizer } from "./Resizer";

const MIN_LEFT = 180;
const MAX_LEFT = 500;
const MIN_RIGHT = 220;
const MAX_RIGHT = 520;
const MIN_BOTTOM = 120;
const MAX_BOTTOM = 500;

export function DockLayout() {
  const areas = useIDEStore((s) => s.areas);
  const dragState = useIDEStore((s) => s.dragState);
  const updateDragPos = useIDEStore((s) => s.updateDragPos);
  const endDrag = useIDEStore((s) => s.endDrag);
  const setAreaSize = useIDEStore((s) => s.setAreaSize);

  const left = areas.find((a) => a.slot === "left");
  const center = areas.find((a) => a.slot === "center");
  const right = areas.find((a) => a.slot === "right");
  const bottom = areas.find((a) => a.slot === "bottom");

  // Global mouse tracking for drag
  useEffect(() => {
    if (!dragState.isDragging) return;
    const onMove = (e: MouseEvent) => updateDragPos(e.clientX, e.clientY);
    const onUp = () => endDrag();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragState.isDragging, updateDragPos, endDrag]);

  const handleResizeLeft = useCallback(
    (delta: number) => {
      const newSize = Math.max(MIN_LEFT, Math.min(MAX_LEFT, (left?.size ?? 260) + delta));
      setAreaSize("left", newSize);
    },
    [left?.size, setAreaSize]
  );

  const handleResizeRight = useCallback(
    (delta: number) => {
      const newSize = Math.max(MIN_RIGHT, Math.min(MAX_RIGHT, (right?.size ?? 300) - delta));
      setAreaSize("right", newSize);
    },
    [right?.size, setAreaSize]
  );

  const handleResizeBottom = useCallback(
    (delta: number) => {
      const newSize = Math.max(MIN_BOTTOM, Math.min(MAX_BOTTOM, (bottom?.size ?? 220) - delta));
      setAreaSize("bottom", newSize);
    },
    [bottom?.size, setAreaSize]
  );

  return (
    <div
      className="dock-layout"
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100vh",
        background: "#0b1120",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      {/* Top bar */}
      <TitleBar />

      {/* Main body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left panel */}
        {left?.visible && left.root && (
          <>
            <div style={{ width: left.size, flexShrink: 0, overflow: "hidden" }}>
              <DockAreaView area={left} />
            </div>
            <Resizer direction="horizontal" onResize={handleResizeLeft} />
          </>
        )}

        {/* Center + Bottom */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 300 }}>
          {/* Center */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            {center && <DockAreaView area={center} />}
          </div>

          {/* Bottom panel */}
          {bottom?.visible && bottom.root && (
            <>
              <Resizer direction="vertical" onResize={handleResizeBottom} />
              <div style={{ height: bottom.size, flexShrink: 0, overflow: "hidden" }}>
                <DockAreaView area={bottom} />
              </div>
            </>
          )}
        </div>

        {/* Right panel */}
        {right?.visible && right.root && (
          <>
            <Resizer direction="horizontal" onResize={handleResizeRight} />
            <div style={{ width: right.size, flexShrink: 0, overflow: "hidden" }}>
              <DockAreaView area={right} />
            </div>
          </>
        )}
      </div>

      {/* Status bar */}
      <StatusBar />

      {/* Drag preview portal */}
      {dragState.isDragging && dragState.tab && (
        <DragPreview tab={dragState.tab} x={dragState.x} y={dragState.y} />
      )}
    </div>
  );
}

// ─── TitleBar ─────────────────────────────────────────────────────────────────

function ViewMenu() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  const areas         = useIDEStore(s => s.areas);
  const setAreaVisible = useIDEStore(s => s.setAreaVisible);
  const resetLayout   = useIDEStore(s => s.resetLayout);
  const openTab       = useIDEStore(s => s.openTab);

  const left   = areas.find(a => a.slot === "left");
  const right  = areas.find(a => a.slot === "right");
  const bottom = areas.find(a => a.slot === "bottom");

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => { document.removeEventListener("mousedown", handler); document.removeEventListener("keydown", keyHandler); };
  }, [open]);

  const panels: Array<{ label: string; icon: string; slot: "left" | "right" | "bottom"; visible: boolean }> = [
    { label: "Explorer",   icon: "📁", slot: "left",   visible: left?.visible   ?? false },
    { label: "Properties", icon: "◈",  slot: "right",  visible: right?.visible  ?? false },
    { label: "Bottom",     icon: "⊟",  slot: "bottom", visible: bottom?.visible ?? false },
  ];

  const openPanel = (slot: "left" | "right" | "bottom", contentType: string, title: string, icon: string) => {
    setAreaVisible(slot, true);
    openTab({ id: `tab-${contentType}`, title, contentType: contentType as never, icon }, slot);
    setOpen(false);
  };

  const menuItems = [
    { type: "toggle", label: "Explorer",     icon: "📁", slot: "left"   as const, visible: left?.visible   ?? false },
    { type: "toggle", label: "Properties",   icon: "◈",  slot: "right"  as const, visible: right?.visible  ?? false },
    { type: "divider" },
    { type: "action", label: "Logs",         icon: "≡",  action: () => openPanel("bottom", "clusterLogs", "Logs", "≡") },
    { type: "action", label: "Cluster Diff", icon: "⊞",  action: () => openPanel("bottom", "clusterDiff", "Cluster Diff", "⊞") },
    { type: "divider" },
    { type: "action", label: "Reset Layout", icon: "↺",  action: () => { resetLayout(); setOpen(false); } },
  ];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: open ? "rgba(255,255,255,0.08)" : "none",
          border: "none",
          color: open ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.45)",
          fontSize: 11, padding: "2px 8px", cursor: "pointer", borderRadius: 3,
          fontFamily: "monospace",
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = "none"; }}
      >
        View
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0,
          background: "#0f1a2e", border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 7, padding: "4px 0", minWidth: 200,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)", zIndex: 9999,
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {menuItems.map((item, i) => {
            if (item.type === "divider") {
              return <div key={i} style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "3px 0" }} />;
            }
            if (item.type === "toggle") {
              return (
                <ViewMenuItem
                  key={item.label}
                  icon={item.icon!}
                  label={item.label!}
                  checked={item.visible}
                  onClick={() => { setAreaVisible(item.slot!, !item.visible); }}
                />
              );
            }
            return (
              <ViewMenuItem key={item.label} icon={item.icon!} label={item.label!} onClick={item.action!} />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ViewMenuItem({ icon, label, checked, onClick }: {
  icon: string; label: string; checked?: boolean; onClick: () => void;
}) {
  const [hov, setHov] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "5px 12px 5px 10px", cursor: "pointer",
        background: hov ? "rgba(59,130,246,0.1)" : "transparent",
        color: hov ? "#e2e8f0" : "rgba(255,255,255,0.65)",
        fontSize: 11, transition: "all 0.08s",
      }}
    >
      {/* checkmark column */}
      <span style={{ width: 12, fontSize: 10, color: "rgba(96,165,250,0.8)", flexShrink: 0 }}>
        {checked === true ? "✓" : checked === false ? "" : ""}
      </span>
      <span style={{ width: 14, fontSize: 12, flexShrink: 0, textAlign: "center" }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
    </div>
  );
}

function TitleBar() {
  const projectPath = useIDEStore((s) => s.projectPath);
  const closeProject = useIDEStore((s) => s.closeProject);
  const projectName = projectPath?.split("/").pop() ?? "Endfield";

  return (
    <div
      style={{
        height: 36,
        background: "#060d1a",
        borderBottom: "1px solid rgba(59,130,246,0.15)",
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        gap: 8,
        flexShrink: 0,
      }}
    >
      {/* Logo + close project */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div
          onClick={closeProject}
          title="Back to start"
          style={{
            width: 18, height: 18, borderRadius: 4,
            background: "linear-gradient(135deg, #60a5fa, #2563eb)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 8, color: "white", fontWeight: 700,
            cursor: "pointer", flexShrink: 0,
            transition: "opacity 0.12s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        >
          E
        </div>
        <span style={{ color: "#e2e8f0", fontSize: 11, fontWeight: 600, letterSpacing: "0.1em" }}>
          ENDFIELD
        </span>
        <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 11 }}>·</span>
        <span style={{ color: "rgba(96,165,250,0.7)", fontSize: 11, fontFamily: "monospace" }}>
          {projectName}
        </span>
        <span
          style={{
            color: "rgba(96,165,250,0.5)",
            fontSize: 9,
            padding: "1px 5px",
            border: "1px solid rgba(96,165,250,0.2)",
            borderRadius: 3,
          }}
        >
          MVP
        </span>
      </div>

      {/* Menu bar */}
      <div style={{ display: "flex", gap: 2, marginLeft: 8 }}>
        <ViewMenu />
      </div>

      <div style={{ flex: 1 }} />
    </div>
  );
}

// ─── StatusBar ────────────────────────────────────────────────────────────────

function StatusBar() {
  const selectedEntity = useIDEStore((s) => s.selectedEntity);
  const projectPath = useIDEStore((s) => s.projectPath);
  const clusterStatus = useIDEStore((s) => s.clusterStatus);
  const nodes = useIDEStore((s) => s.nodes);

  const allGreen = clusterStatus?.fields.every(f => f.status === "green");
  const hasProblem = clusterStatus?.fields.some(f => f.status === "red");
  const dotColor = !clusterStatus ? "#475569" : hasProblem ? "#ef4444" : allGreen ? "#22c55e" : "#eab308";
  const dotLabel = !clusterStatus ? "no kubectl" : hasProblem ? "degraded" : allGreen ? "healthy" : "partial";

  return (
    <div
      style={{
        height: 22,
        background: "#060d1a",
        borderTop: "1px solid rgba(59,130,246,0.1)",
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        gap: 12,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, boxShadow: dotColor !== "#475569" ? `0 0 6px ${dotColor}` : "none" }} />
        <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>{dotLabel}</span>
      </div>
      {nodes.length > 0 && (
        <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 10 }}>{nodes.length} fields</span>
      )}
      {selectedEntity && (
        <span style={{ color: "rgba(96,165,250,0.6)", fontSize: 10 }}>
          {selectedEntity.type}: {selectedEntity.label}
        </span>
      )}
      <div style={{ flex: 1 }} />
      <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 10, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {projectPath ?? "Endfield IDE"}
      </span>
    </div>
  );
}
