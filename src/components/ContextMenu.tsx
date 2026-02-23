import React, { useEffect, useRef } from "react";
import { YamlNode } from "../store/tauriStore";
import { executeCommand } from "../commands/commands";

export interface ContextMenuState {
  node: YamlNode;
  x: number;
  y: number;
}

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onRename: (node: YamlNode) => void;
  onDelete: (node: YamlNode) => void;
}

interface MenuItem {
  id: string;
  label: string;
  icon: string;
  dividerBefore?: boolean;
  danger?: boolean;
  action: () => void;
}

export function ContextMenu({ state, onClose, onRename, onDelete }: ContextMenuProps) {
  const { node, x, y } = state;
  const menuRef = useRef<HTMLDivElement>(null);

  // Position adjustment: keep menu inside viewport
  const [pos, setPos] = React.useState({ x, y });
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPos({
      x: x + rect.width > vw ? Math.max(0, vw - rect.width - 8) : x,
      y: y + rect.height > vh ? Math.max(0, vh - rect.height - 8) : y,
    });
  }, [x, y]);

  // Close on outside click / Escape
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  const items: MenuItem[] = [
    {
      id: "openYaml",
      label: "Open YAML",
      icon: "📄",
      action: () => { executeCommand("field.openYaml", { node }); onClose(); },
    },
    {
      id: "openInExplorer",
      label: "Open in Explorer",
      icon: "📁",
      action: () => { executeCommand("field.openInExplorer", { node }); onClose(); },
    },
    {
      id: "properties",
      label: "Properties",
      icon: "◈",
      action: () => { executeCommand("field.properties", { node }); onClose(); },
    },
    {
      id: "logs",
      label: "Logs",
      icon: "≡",
      dividerBefore: true,
      action: () => { executeCommand("field.logs", { node }); onClose(); },
    },
    {
      id: "diff",
      label: "Cluster Diff",
      icon: "⊞",
      action: () => { executeCommand("field.diff", { node }); onClose(); },
    },
    {
      id: "rename",
      label: "Rename",
      icon: "✎",
      dividerBefore: true,
      action: () => { onRename(node); onClose(); },
    },
    {
      id: "delete",
      label: "Delete",
      icon: "⌫",
      danger: true,
      action: () => { onDelete(node); onClose(); },
    },
  ];

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 9999,
        background: "#0f1a2e",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 7,
        padding: "4px 0",
        minWidth: 180,
        boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)",
        fontFamily: "'JetBrains Mono', monospace",
        userSelect: "none",
      }}
      onContextMenu={e => e.preventDefault()}
    >
      {/* Header: node info */}
      <div style={{
        padding: "6px 12px 6px 10px",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        marginBottom: 3,
        display: "flex", alignItems: "center", gap: 7,
      }}>
        <span style={{ fontSize: 12 }}>⬡</span>
        <div>
          <div style={{ color: "#e2e8f0", fontSize: 11, fontWeight: 600 }}>{node.label}</div>
          <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 9 }}>{node.kind} · {node.namespace}</div>
        </div>
      </div>

      {items.map(item => (
        <React.Fragment key={item.id}>
          {item.dividerBefore && (
            <div style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "3px 0" }} />
          )}
          <MenuRow item={item} />
        </React.Fragment>
      ))}
    </div>
  );
}

function MenuRow({ item }: { item: MenuItem }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <div
      onClick={item.action}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "5px 12px 5px 10px",
        cursor: "pointer",
        background: hovered
          ? item.danger ? "rgba(239,68,68,0.12)" : "rgba(59,130,246,0.1)"
          : "transparent",
        color: hovered
          ? item.danger ? "#fca5a5" : "#e2e8f0"
          : item.danger ? "rgba(239,68,68,0.7)" : "rgba(255,255,255,0.65)",
        fontSize: 11,
        transition: "all 0.08s",
      }}
    >
      <span style={{ width: 14, fontSize: 12, flexShrink: 0, textAlign: "center" }}>{item.icon}</span>
      <span>{item.label}</span>
    </div>
  );
}
