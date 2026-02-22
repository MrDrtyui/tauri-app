import React from "react";
import { Tab } from "../layout/types";

interface DragPreviewProps {
  tab: Tab;
  x: number;
  y: number;
}

export function DragPreview({ tab, x, y }: DragPreviewProps) {
  if (x === 0 && y === 0) return null;

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
      style={{
        position: "fixed",
        left: x + 12,
        top: y + 8,
        zIndex: 9999,
        pointerEvents: "none",
        background: "rgba(13,22,40,0.95)",
        border: `1px solid rgba(96,165,250,0.4)`,
        borderRadius: 6,
        padding: "5px 10px",
        display: "flex",
        alignItems: "center",
        gap: 6,
        boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(96,165,250,0.15)",
        backdropFilter: "blur(12px)",
        animation: "fadeIn 0.05s ease",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: 12 }}>{tab.icon ?? "◦"}</span>
      <span style={{ fontSize: 11, color, fontWeight: 500, fontFamily: "monospace" }}>
        {tab.title}
      </span>
    </div>
  );
}
