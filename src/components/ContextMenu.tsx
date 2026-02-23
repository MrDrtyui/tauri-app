import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { YamlNode } from "../store/tauriStore";
import { executeCommand } from "../commands/commands";
import { AppIcon, resolveNodeIconName, resolveNodeColor } from "../ui/AppIcon";

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

export function ContextMenu({
  state,
  onClose,
  onRename,
  onDelete,
}: ContextMenuProps) {
  const { node, x, y } = state;
  const ref = useRef<HTMLDivElement>(null);

  const iconName = resolveNodeIconName(node.type_id, node.label, node.source);
  const color = resolveNodeColor(node.type_id);

  const items = [
    {
      id: "openYaml",
      label: "Open YAML",
      icon: "openYaml" as const,
      action: () => {
        executeCommand("field.openYaml", { node });
        onClose();
      },
    },
    {
      id: "openInExplorer",
      label: "Open in Explorer",
      icon: "openInExplorer" as const,
      action: () => {
        executeCommand("field.openInExplorer", { node });
        onClose();
      },
    },
    {
      id: "properties",
      label: "Properties",
      icon: "properties" as const,
      action: () => {
        executeCommand("field.properties", { node });
        onClose();
      },
    },
    {
      id: "logs",
      label: "Logs",
      icon: "logs" as const,
      dividerBefore: true,
      action: () => {
        executeCommand("field.logs", { node });
        onClose();
      },
    },
    {
      id: "diff",
      label: "Cluster Diff",
      icon: "diff" as const,
      action: () => {
        executeCommand("field.diff", { node });
        onClose();
      },
    },
    {
      id: "rename",
      label: "Rename",
      icon: "rename" as const,
      dividerBefore: true,
      action: () => {
        onRename(node);
        onClose();
      },
    },
    {
      id: "delete",
      label: "Delete",
      icon: "delete" as const,
      danger: true,
      action: () => {
        onDelete(node);
        onClose();
      },
    },
  ];

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

  // Clamp to viewport
  const menuW = 200,
    menuH = items.length * 32 + 60;
  const left = Math.min(x, window.innerWidth - menuW - 8);
  const top = Math.min(y, window.innerHeight - menuH - 8);

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
      {/* Node header */}
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
        <span style={{ color, display: "flex", alignItems: "center" }}>
          <AppIcon name={iconName} size={14} strokeWidth={1.75} />
        </span>
        <div>
          <div
            style={{
              color: "var(--text-primary)",
              fontSize: "var(--font-size-sm)",
              fontWeight: 500,
            }}
          >
            {node.label}
          </div>
          <div
            style={{
              color: "var(--text-faint)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
            }}
          >
            {node.kind} · {node.namespace}
          </div>
        </div>
      </div>

      {/* Menu items */}
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
          <ContextMenuItem
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

function ContextMenuItem({
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
  const [hov, setHov] = React.useState(false);
  const dangerColor = "var(--ctp-red)";
  const normalColor = hov ? "var(--text-primary)" : "var(--text-secondary)";

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
        color: danger ? dangerColor : normalColor,
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
