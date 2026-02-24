import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
      const newSize = Math.max(
        MIN_LEFT,
        Math.min(MAX_LEFT, (left?.size ?? 260) + delta),
      );
      setAreaSize("left", newSize);
    },
    [left?.size, setAreaSize],
  );

  const handleResizeRight = useCallback(
    (delta: number) => {
      const newSize = Math.max(
        MIN_RIGHT,
        Math.min(MAX_RIGHT, (right?.size ?? 300) - delta),
      );
      setAreaSize("right", newSize);
    },
    [right?.size, setAreaSize],
  );

  const handleResizeBottom = useCallback(
    (delta: number) => {
      const newSize = Math.max(
        MIN_BOTTOM,
        Math.min(MAX_BOTTOM, (bottom?.size ?? 220) - delta),
      );
      setAreaSize("bottom", newSize);
    },
    [bottom?.size, setAreaSize],
  );

  return (
    <div
      className="dock-layout"
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100vh",
        background: "var(--bg-primary)",
        fontFamily: "var(--font-ui)",
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      <TitleBar />

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left panel */}
        {left?.visible && left.root && (
          <>
            <div
              style={{
                width: left.size,
                flexShrink: 0,
                overflow: "hidden",
                background: "var(--bg-sidebar)",
                borderRight: "1px solid var(--border-subtle)",
              }}
            >
              <DockAreaView area={left} />
            </div>
            <Resizer direction="horizontal" onResize={handleResizeLeft} />
          </>
        )}

        {/* Center + Bottom */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minWidth: 300,
          }}
        >
          <div style={{ flex: 1, overflow: "hidden" }}>
            {center && <DockAreaView area={center} />}
          </div>

          {bottom?.visible && bottom.root && (
            <>
              <Resizer direction="vertical" onResize={handleResizeBottom} />
              <div
                style={{
                  height: bottom.size,
                  flexShrink: 0,
                  overflow: "hidden",
                  borderTop: "1px solid var(--border-subtle)",
                }}
              >
                <DockAreaView area={bottom} />
              </div>
            </>
          )}
        </div>

        {/* Right panel */}
        {right?.visible && right.root && (
          <>
            <Resizer direction="horizontal" onResize={handleResizeRight} />
            <div
              style={{
                width: right.size,
                flexShrink: 0,
                overflow: "hidden",
                background: "var(--bg-sidebar)",
                borderLeft: "1px solid var(--border-subtle)",
              }}
            >
              <DockAreaView area={right} />
            </div>
          </>
        )}
      </div>

      <StatusBar />

      {dragState.isDragging && dragState.tab && (
        <DragPreview tab={dragState.tab} x={dragState.x} y={dragState.y} />
      )}
    </div>
  );
}

// ─── TitleBar ─────────────────────────────────────────────────────────────────

function ViewMenu() {
  const [open, setOpen] = React.useState(false);
  const [menuPos, setMenuPos] = React.useState({ top: 0, left: 0 });
  const ref = React.useRef<HTMLDivElement>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);

  const areas = useIDEStore((s) => s.areas);
  const setAreaVisible = useIDEStore((s) => s.setAreaVisible);
  const resetLayout = useIDEStore((s) => s.resetLayout);
  const openTab = useIDEStore((s) => s.openTab);

  const left = areas.find((a) => a.slot === "left");
  const right = areas.find((a) => a.slot === "right");
  const bottom = areas.find((a) => a.slot === "bottom");

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        ref.current &&
        !ref.current.contains(target) &&
        btnRef.current &&
        !btnRef.current.contains(target)
      )
        setOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [open]);

  const openPanel = (
    slot: "left" | "right" | "bottom",
    contentType: string,
    title: string,
    icon: string,
  ) => {
    setAreaVisible(slot, true);
    openTab(
      {
        id: `tab-${contentType}`,
        title,
        contentType: contentType as never,
        icon,
      },
      slot,
    );
    setOpen(false);
  };

  const menuItems = [
    {
      type: "toggle",
      label: "Explorer",
      slot: "left" as const,
      visible: left?.visible ?? false,
    },
    {
      type: "toggle",
      label: "Properties",
      slot: "right" as const,
      visible: right?.visible ?? false,
    },
    { type: "divider" },
    {
      type: "action",
      label: "Logs",
      action: () => openPanel("bottom", "clusterLogs", "Logs", "≡"),
    },
    {
      type: "action",
      label: "Cluster Diff",
      action: () => openPanel("bottom", "clusterDiff", "Cluster Diff", "⊞"),
    },
    { type: "divider" },
    {
      type: "action",
      label: "Reset Layout",
      action: () => {
        resetLayout();
        setOpen(false);
      },
    },
  ];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        ref={btnRef}
        onClick={() => {
          if (!open && btnRef.current) {
            const r = btnRef.current.getBoundingClientRect();
            setMenuPos({ top: r.bottom + 6, left: r.left });
          }
          setOpen((o) => !o);
        }}
        style={{
          background: open ? "var(--bg-elevated)" : "transparent",
          border: "none",
          color: open ? "var(--text-primary)" : "var(--text-subtle)",
          fontSize: "var(--font-size-sm)",
          padding: "3px 8px",
          cursor: "pointer",
          borderRadius: "var(--radius-xs)",
          fontFamily: "var(--font-ui)",
          transition: "var(--ease-fast)",
        }}
        onMouseEnter={(e) => {
          if (!open)
            (e.currentTarget as HTMLElement).style.background =
              "var(--bg-elevated)";
        }}
        onMouseLeave={(e) => {
          if (!open)
            (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
      >
        View
      </button>

      {open &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              background: "var(--bg-modal)",
              backdropFilter: "var(--blur-md)",
              WebkitBackdropFilter: "var(--blur-md)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-lg)",
              padding: "4px 0",
              minWidth: 200,
              boxShadow: "var(--shadow-lg)",
              zIndex: 9999,
              animation: "ef-slidein 0.12s ease-out",
            }}
          >
            {menuItems.map((item, i) => {
              if (item.type === "divider") {
                return (
                  <div
                    key={i}
                    style={{
                      height: 1,
                      background: "var(--border-subtle)",
                      margin: "3px 0",
                    }}
                  />
                );
              }
              if (item.type === "toggle") {
                return (
                  <ViewMenuItem
                    key={item.label}
                    label={item.label!}
                    checked={item.visible}
                    onClick={() => {
                      setAreaVisible(item.slot!, !item.visible);
                    }}
                  />
                );
              }
              return (
                <ViewMenuItem
                  key={item.label}
                  label={item.label!}
                  onClick={item.action!}
                />
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

function ViewMenuItem({
  label,
  checked,
  onClick,
}: {
  label: string;
  checked?: boolean;
  onClick: () => void;
}) {
  const [hov, setHov] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 14px 5px 10px",
        cursor: "pointer",
        background: hov ? "var(--bg-sidebar-active)" : "transparent",
        color: hov ? "var(--text-primary)" : "var(--text-secondary)",
        fontSize: "var(--font-size-sm)",
        transition: "var(--ease-fast)",
        borderRadius: "var(--radius-xs)",
        margin: "1px 4px",
      }}
    >
      <span
        style={{
          width: 14,
          fontSize: 10,
          color: "var(--accent)",
          flexShrink: 0,
        }}
      >
        {checked === true ? "✓" : ""}
      </span>
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
        height: 34,
        background: "var(--bg-toolbar)",
        backdropFilter: "var(--blur-md)",
        WebkitBackdropFilter: "var(--blur-md)",
        borderBottom: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        paddingLeft: 76,
        paddingRight: 14,
        gap: 8,
        flexShrink: 0,
      }}
      className="drag-region"
    >
      {/* Logo — no-drag so click works */}
      <div
        className="no-drag"
        style={{ display: "flex", alignItems: "center", gap: 6 }}
      >
        <div
          onClick={closeProject}
          title="Back to start"
          style={{
            width: 16,
            height: 16,
            borderRadius: "var(--radius-xs)",
            background:
              "linear-gradient(135deg, var(--ctp-mauve), var(--ctp-lavender))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 7,
            color: "var(--ctp-crust)",
            fontWeight: 700,
            cursor: "pointer",
            flexShrink: 0,
            transition: "var(--ease-fast)",
            userSelect: "none",
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLElement).style.opacity = "0.7")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLElement).style.opacity = "1")
          }
        >
          E
        </div>
        <span
          style={{
            color: "var(--text-secondary)",
            fontSize: "var(--font-size-sm)",
            fontWeight: 500,
            letterSpacing: "0.08em",
            userSelect: "none",
          }}
        >
          ENDFIELD
        </span>
      </div>

      {/* Separator */}
      <span
        className="no-drag"
        style={{ color: "var(--border-strong)", fontSize: 12 }}
      >
        ·
      </span>

      {/* Project name */}
      <span
        className="no-drag"
        style={{
          color: "var(--text-muted)",
          fontSize: "var(--font-size-sm)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.01em",
          userSelect: "none",
        }}
      >
        {projectName}
      </span>

      {/* Menu bar — no-drag so dropdowns work */}
      <div
        className="no-drag"
        style={{ display: "flex", gap: 2, marginLeft: 8 }}
      >
        <ViewMenu />
      </div>

      {/* Spacer — drag region, no children so it works correctly */}
      <div data-tauri-drag-region style={{ flex: 1, height: "100%" }} />

      {/* Version badge */}
      <span
        className="no-drag"
        style={{
          color: "var(--text-faint)",
          fontSize: 9,
          padding: "2px 6px",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-full)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.05em",
        }}
      >
        alpha
      </span>
    </div>
  );
}

// ─── StatusBar ────────────────────────────────────────────────────────────────

function StatusBar() {
  const selectedEntity = useIDEStore((s) => s.selectedEntity);
  const projectPath = useIDEStore((s) => s.projectPath);
  const clusterStatus = useIDEStore((s) => s.clusterStatus);
  const nodes = useIDEStore((s) => s.nodes);

  const allGreen = clusterStatus?.fields.every((f) => f.status === "green");
  const hasProblem = clusterStatus?.fields.some((f) => f.status === "red");

  const dotColor = !clusterStatus
    ? "var(--status-unknown)"
    : hasProblem
      ? "var(--status-error)"
      : allGreen
        ? "var(--status-ok)"
        : "var(--status-warn)";

  const dotLabel = !clusterStatus
    ? "no kubectl"
    : hasProblem
      ? "degraded"
      : allGreen
        ? "healthy"
        : "partial";

  return (
    <div
      style={{
        height: 22,
        background: "var(--bg-statusbar)",
        borderTop: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        padding: "0 14px",
        gap: 14,
        flexShrink: 0,
      }}
    >
      {/* Cluster status */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span
          style={{
            display: "inline-block",
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: dotColor,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            color: "var(--text-faint)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
          }}
        >
          {dotLabel}
        </span>
      </div>

      {nodes.length > 0 && (
        <span
          style={{
            color: "var(--text-faint)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
          }}
        >
          {nodes.length} {nodes.length === 1 ? "field" : "fields"}
        </span>
      )}

      {selectedEntity && (
        <span
          style={{
            color: "var(--text-subtle)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
          }}
        >
          {selectedEntity.type}: {selectedEntity.label}
        </span>
      )}

      <div style={{ flex: 1 }} />

      <span
        style={{
          color: "var(--text-faint)",
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: 360,
        }}
      >
        {projectPath ?? "Endfield IDE"}
      </span>
    </div>
  );
}
