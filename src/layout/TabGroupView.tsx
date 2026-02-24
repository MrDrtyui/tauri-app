import React, { useRef, useState } from "react";
import { TabGroupNode, Tab, DropPosition } from "../layout/types";
import { useIDEStore } from "../store/ideStore";
import { PanelRenderer } from "./PanelRenderer";
import { AppIcon, contentTypeIcon } from "../ui/AppIcon";
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Plus as PlusIcon,
} from "lucide-react";

interface TabGroupViewProps {
  group: TabGroupNode;
  areaSlot: string;
}

export function TabGroupView({ group, areaSlot }: TabGroupViewProps) {
  const [dropZoneVisible, setDropZoneVisible] = useState(false);
  const dragState = useIDEStore((s) => s.dragState);
  const dropTab = useIDEStore((s) => s.dropTab);

  const activeTab = group.tabs.find((t) => t.id === group.activeTabId);
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
        background: "var(--bg-primary)",
        position: "relative",
        overflow: "hidden",
      }}
      onMouseEnter={() => showDrop && setDropZoneVisible(true)}
      onMouseLeave={() => setDropZoneVisible(false)}
    >
      <TabBar group={group} />
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {activeTab ? (
          <PanelRenderer tab={activeTab} groupId={group.id} />
        ) : (
          <EmptyPanel />
        )}
        {showDrop && dropZoneVisible && <DropZones onDrop={handleDrop} />}
      </div>
    </div>
  );
}

// ─── TabBar ───────────────────────────────────────────────────────

function TabBar({ group }: { group: TabGroupNode }) {
  const setActiveTab = useIDEStore((s) => s.setActiveTab);
  const closeTab = useIDEStore((s) => s.closeTab);
  const startDrag = useIDEStore((s) => s.startDrag);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border-subtle)",
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

      <button
        title="New file"
        style={{
          flexShrink: 0,
          width: 28,
          background: "none",
          border: "none",
          color: "var(--text-faint)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          alignSelf: "center",
          margin: "0 2px",
          borderRadius: "var(--radius-xs)",
          transition: "var(--ease-fast)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background =
            "var(--bg-elevated)";
          (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "none";
          (e.currentTarget as HTMLElement).style.color = "var(--text-faint)";
        }}
      >
        <PlusIcon size={13} strokeWidth={2} />
      </button>

      {/* Drag region — empty space after tabs lets user drag the window */}
      <div
        data-tauri-drag-region
        className="drag-region"
        style={{ flex: 1, cursor: "default", height: "100%" }}
      />
    </div>
  );
}

// ─── TabItem ──────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  file: "var(--ctp-lavender)",
  graph: "var(--ctp-green)",
  clusterDiff: "var(--ctp-red)",
  clusterLogs: "var(--ctp-peach)",
  inspector: "var(--ctp-mauve)",
  explorer: "var(--ctp-teal)",
  welcome: "var(--text-secondary)",
  deployImage: "var(--ctp-sapphire)",
};

interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
  onClose: (e: React.MouseEvent) => void;
  onDragStart: () => void;
}

function TabItem({
  tab,
  isActive,
  onActivate,
  onClose,
  onDragStart,
}: TabItemProps) {
  const dragState = useIDEStore((s) => s.dragState);
  const isDragSrc = dragState.isDragging && dragState.tab?.id === tab.id;
  const [hov, setHov] = useState(false);
  const color = TYPE_COLORS[tab.contentType] ?? "var(--text-muted)";

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      onClose(e);
      return;
    }
    if (e.button === 0) {
      onActivate();
      const startX = e.clientX,
        startY = e.clientY;
      const onMove = (me: MouseEvent) => {
        if (
          Math.abs(me.clientX - startX) > 5 ||
          Math.abs(me.clientY - startY) > 5
        ) {
          onDragStart();
          window.removeEventListener("mousemove", onMove);
        }
      };
      const onUp = () => window.removeEventListener("mousemove", onMove);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp, { once: true });
    }
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "0 10px 0 9px",
        cursor: "pointer",
        borderRight: "1px solid var(--border-subtle)",
        borderBottom: isActive ? `2px solid ${color}` : "2px solid transparent",
        background: isActive
          ? "var(--bg-primary)"
          : hov
            ? "var(--bg-sidebar-hover)"
            : "transparent",
        minWidth: 80,
        maxWidth: 180,
        height: "100%",
        flexShrink: 0,
        opacity: isDragSrc ? 0.3 : 1,
        transition: "background 0.1s",
      }}
      className="no-drag"
    >
      {/* Tab type icon */}
      <span
        style={{
          color: isActive ? color : "var(--text-faint)",
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          opacity: 0.75,
        }}
      >
        <AppIcon
          name={contentTypeIcon(tab.contentType)}
          size={11}
          strokeWidth={1.75}
        />
      </span>

      <span
        style={{
          fontSize: "var(--font-size-sm)",
          color: isActive ? color : "var(--text-muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
          fontWeight: isActive ? 500 : 400,
        }}
      >
        {tab.title}
        {tab.isDirty && (
          <span
            style={{
              color: "var(--ctp-yellow)",
              marginLeft: 4,
              display: "inline-block",
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "var(--ctp-yellow)",
              verticalAlign: "middle",
            }}
          />
        )}
      </span>

      {/* Close button */}
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
          onClose(e);
        }}
        style={{
          width: 14,
          height: 14,
          borderRadius: "var(--radius-xs)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-faint)",
          flexShrink: 0,
          transition: "all 0.1s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background =
            "rgba(243,139,168,0.2)";
          (e.currentTarget as HTMLElement).style.color = "var(--ctp-red)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
          (e.currentTarget as HTMLElement).style.color = "var(--text-faint)";
        }}
      >
        <AppIcon name="close" size={9} strokeWidth={2.5} />
      </div>
    </div>
  );
}

// ─── DropZones ────────────────────────────────────────────────────

const DROP_ZONE_ICONS = {
  center: <AppIcon name="maximize" size={16} strokeWidth={1.5} />,
  top: <ArrowUp size={12} strokeWidth={2} />,
  bottom: <ArrowDown size={12} strokeWidth={2} />,
  left: <ArrowLeft size={12} strokeWidth={2} />,
  right: <ArrowRight size={12} strokeWidth={2} />,
} as const;

function DropZones({ onDrop }: { onDrop: (pos: DropPosition) => void }) {
  const dragState = useIDEStore((s) => s.dragState);
  const endDrag = useIDEStore((s) => s.endDrag);
  const [hovering, setHovering] = useState<DropPosition | null>(null);

  const positions: { pos: DropPosition; style: React.CSSProperties }[] = [
    {
      pos: "center",
      style: { top: "30%", left: "30%", width: "40%", height: "40%" },
    },
    { pos: "top", style: { top: 0, left: "20%", width: "60%", height: "28%" } },
    {
      pos: "bottom",
      style: { bottom: 0, left: "20%", width: "60%", height: "28%" },
    },
    {
      pos: "left",
      style: { top: "20%", left: 0, width: "28%", height: "60%" },
    },
    {
      pos: "right",
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
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(17,17,27,0.5)",
          backdropFilter: "blur(2px)",
        }}
      />
      {positions.map(({ pos, style }) => (
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
            borderRadius:
              pos === "center" ? "var(--radius-lg)" : "var(--radius-sm)",
            border: `2px solid ${hovering === pos ? "var(--accent)" : "rgba(203,166,247,0.3)"}`,
            background:
              hovering === pos
                ? "rgba(203,166,247,0.15)"
                : "rgba(203,166,247,0.05)",
            transition: "all 0.12s ease",
            cursor: "copy",
            boxShadow:
              hovering === pos ? "0 0 20px rgba(203,166,247,0.2)" : "none",
            color: hovering === pos ? "var(--accent)" : "rgba(203,166,247,0.4)",
          }}
        >
          {DROP_ZONE_ICONS[pos]}
        </div>
      ))}
    </div>
  );
}

// ─── EmptyPanel ───────────────────────────────────────────────────

function EmptyPanel() {
  return (
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
      No tabs open
    </div>
  );
}
