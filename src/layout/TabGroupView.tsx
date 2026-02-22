import React, { useRef, useState } from "react";
import { TabGroupNode, Tab, DropPosition } from "../layout/types";
import { useIDEStore } from "../store/ideStore";
import { PanelRenderer } from "./PanelRenderer";

interface TabGroupViewProps {
  group: TabGroupNode;
  areaSlot: string;
}

export function TabGroupView({ group, areaSlot }: TabGroupViewProps) {
  const [dropZoneVisible, setDropZoneVisible] = useState(false);
  const dragState = useIDEStore((s) => s.dragState);
  const dropTab = useIDEStore((s) => s.dropTab);

  const activeTab = group.tabs.find((t) => t.id === group.activeTabId);

  // Show drop zones when dragging something that's not from this group
  const showDrop = dragState.isDragging && dragState.sourceGroupId !== group.id;

  const handleDrop = (position: DropPosition) => {
    if (!dragState.tab) return;
    dropTab(dragState.tab.id, group.id, position);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "#0d1526",
        position: "relative",
        overflow: "hidden",
      }}
      onMouseEnter={() => showDrop && setDropZoneVisible(true)}
      onMouseLeave={() => setDropZoneVisible(false)}
    >
      {/* Tab bar */}
      <TabBar group={group} />

      {/* Panel content */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {activeTab ? (
          <PanelRenderer tab={activeTab} groupId={group.id} />
        ) : (
          <EmptyPanel />
        )}

        {/* Drop zones overlay */}
        {showDrop && dropZoneVisible && (
          <DropZones onDrop={handleDrop} />
        )}
      </div>
    </div>
  );
}

// ─── TabBar ───────────────────────────────────────────────────────────────────

function TabBar({ group }: { group: TabGroupNode }) {
  const setActiveTab = useIDEStore((s) => s.setActiveTab);
  const closeTab = useIDEStore((s) => s.closeTab);
  const startDrag = useIDEStore((s) => s.startDrag);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        background: "#070f1e",
        borderBottom: "1px solid rgba(59,130,246,0.12)",
        height: 34,
        flexShrink: 0,
        overflowX: "auto",
        overflowY: "hidden",
        scrollbarWidth: "none",
      }}
    >
      {group.tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === group.activeTabId}
          onActivate={() => setActiveTab(group.id, tab.id)}
          onClose={(e) => {
            e.stopPropagation();
            closeTab(tab.id);
          }}
          onDragStart={() => startDrag(tab, group.id)}
        />
      ))}

      {/* Add tab button */}
      <button
        title="New file"
        style={{
          flexShrink: 0,
          width: 28,
          background: "none",
          border: "none",
          borderRight: "1px solid rgba(255,255,255,0.04)",
          color: "rgba(255,255,255,0.2)",
          cursor: "pointer",
          fontSize: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          alignSelf: "center",
          margin: "0 2px",
          borderRadius: 3,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          e.currentTarget.style.color = "rgba(255,255,255,0.5)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "none";
          e.currentTarget.style.color = "rgba(255,255,255,0.2)";
        }}
      >
        +
      </button>
    </div>
  );
}

// ─── TabItem ──────────────────────────────────────────────────────────────────

interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
  onClose: (e: React.MouseEvent) => void;
  onDragStart: () => void;
}

function TabItem({ tab, isActive, onActivate, onClose, onDragStart }: TabItemProps) {
  const dragState = useIDEStore((s) => s.dragState);
  const isDragSource = dragState.isDragging && dragState.tab?.id === tab.id;

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      // Middle click close
      e.preventDefault();
      onClose(e);
      return;
    }
    if (e.button === 0) {
      onActivate();
      // Start drag after small delay
      const startX = e.clientX;
      const startY = e.clientY;
      const onMove = (me: MouseEvent) => {
        if (Math.abs(me.clientX - startX) > 5 || Math.abs(me.clientY - startY) > 5) {
          onDragStart();
          window.removeEventListener("mousemove", onMove);
        }
      };
      const onUp = () => window.removeEventListener("mousemove", onMove);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp, { once: true });
    }
  };

  const typeColors: Record<string, string> = {
    file: "#93c5fd",
    graph: "#6ee7b7",
    clusterDiff: "#fca5a5",
    clusterLogs: "#fed7aa",
    inspector: "#ddd6fe",
    explorer: "#bbf7d0",
    welcome: "#e2e8f0",
  };

  const color = typeColors[tab.contentType] ?? "#94a3b8";

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "0 10px 0 8px",
        cursor: "pointer",
        borderRight: "1px solid rgba(255,255,255,0.04)",
        borderBottom: isActive
          ? "2px solid rgba(96,165,250,0.8)"
          : "2px solid transparent",
        background: isActive
          ? "rgba(59,130,246,0.08)"
          : "transparent",
        minWidth: 80,
        maxWidth: 180,
        height: "100%",
        flexShrink: 0,
        opacity: isDragSource ? 0.3 : 1,
        transition: "background 0.1s",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = "transparent";
      }}
    >
      {/* Icon */}
      <span style={{ fontSize: 11, opacity: 0.7, flexShrink: 0 }}>{tab.icon ?? "◦"}</span>

      {/* Title */}
      <span
        style={{
          fontSize: 11,
          color: isActive ? color : "rgba(255,255,255,0.5)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
          fontWeight: isActive ? 500 : 400,
        }}
      >
        {tab.title}
        {tab.isDirty && (
          <span style={{ color: "#f59e0b", marginLeft: 2 }}>●</span>
        )}
      </span>

      {/* Close */}
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
          onClose(e);
        }}
        style={{
          width: 14,
          height: 14,
          borderRadius: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 9,
          color: "rgba(255,255,255,0.25)",
          flexShrink: 0,
          transition: "all 0.1s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(239,68,68,0.25)";
          e.currentTarget.style.color = "#fca5a5";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "rgba(255,255,255,0.25)";
        }}
      >
        ✕
      </div>
    </div>
  );
}

// ─── DropZones ────────────────────────────────────────────────────────────────

function DropZones({ onDrop }: { onDrop: (pos: DropPosition) => void }) {
  const dragState = useIDEStore((s) => s.dragState);
  const endDrag = useIDEStore((s) => s.endDrag);
  const [hovering, setHovering] = useState<DropPosition | null>(null);

  const positions: { pos: DropPosition; style: React.CSSProperties; label: string }[] = [
    {
      pos: "center",
      label: "⊕",
      style: {
        top: "30%", left: "30%", width: "40%", height: "40%",
      },
    },
    {
      pos: "top",
      label: "↑",
      style: { top: 0, left: "20%", width: "60%", height: "28%" },
    },
    {
      pos: "bottom",
      label: "↓",
      style: { bottom: 0, left: "20%", width: "60%", height: "28%" },
    },
    {
      pos: "left",
      label: "←",
      style: { top: "20%", left: 0, width: "28%", height: "60%" },
    },
    {
      pos: "right",
      label: "→",
      style: { top: "20%", right: 0, width: "28%", height: "60%" },
    },
  ];

  if (!dragState.isDragging) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 100,
        pointerEvents: "none",
      }}
    >
      {/* dim background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(6,12,24,0.45)",
          backdropFilter: "blur(1px)",
        }}
      />

      {positions.map(({ pos, style, label }) => (
        <div
          key={pos}
          onMouseEnter={() => setHovering(pos)}
          onMouseLeave={() => setHovering(null)}
          onMouseUp={() => {
            onDrop(pos);
            endDrag();
            setHovering(null);
          }}
          style={{
            position: "absolute",
            ...style,
            pointerEvents: "all",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: pos === "center" ? 8 : 4,
            border: `2px solid ${hovering === pos ? "rgba(96,165,250,0.9)" : "rgba(96,165,250,0.35)"}`,
            background: hovering === pos
              ? "rgba(59,130,246,0.25)"
              : "rgba(59,130,246,0.08)",
            transition: "all 0.12s",
            cursor: "copy",
            boxShadow: hovering === pos ? "0 0 20px rgba(59,130,246,0.3)" : "none",
          }}
        >
          <span
            style={{
              fontSize: pos === "center" ? 16 : 12,
              color: hovering === pos ? "#93c5fd" : "rgba(96,165,250,0.5)",
              fontWeight: 600,
            }}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── EmptyPanel ───────────────────────────────────────────────────────────────

function EmptyPanel() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "rgba(255,255,255,0.12)",
        fontSize: 13,
        fontStyle: "italic",
      }}
    >
      No tabs open
    </div>
  );
}
