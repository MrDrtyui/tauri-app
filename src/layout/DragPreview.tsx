import React from "react";
import { Tab } from "../layout/types";
import { AppIcon, contentTypeIcon } from "../ui/AppIcon";

interface DragPreviewProps {
  tab: Tab;
  x: number;
  y: number;
}

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

export function DragPreview({ tab, x, y }: DragPreviewProps) {
  if (x === 0 && y === 0) return null;

  const color = TYPE_COLORS[tab.contentType] ?? "var(--text-muted)";
  const iconName = contentTypeIcon(tab.contentType);

  return (
    <div
      style={{
        position: "fixed",
        left: x + 12,
        top: y + 8,
        zIndex: 9999,
        pointerEvents: "none",
        background: "var(--bg-modal)",
        backdropFilter: "var(--blur-md)",
        WebkitBackdropFilter: "var(--blur-md)",
        border: "1px solid var(--border-accent)",
        borderRadius: "var(--radius-md)",
        padding: "5px 12px",
        display: "flex",
        alignItems: "center",
        gap: 7,
        boxShadow: "var(--shadow-lg)",
        animation: "ef-fadein 0.06s ease-out",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color, display: "flex", alignItems: "center" }}>
        <AppIcon name={iconName} size={12} strokeWidth={1.75} />
      </span>
      <span
        style={{
          fontSize: "var(--font-size-sm)",
          color,
          fontWeight: 500,
          fontFamily: "var(--font-ui)",
        }}
      >
        {tab.title}
      </span>
    </div>
  );
}
