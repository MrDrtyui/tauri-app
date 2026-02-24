/**
 * IngressEdgeContextMenu.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Right-click context menu for Ingress route edges in the graph canvas.
 */

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AppIcon } from "../ui/AppIcon";
import { IngressRoute, routeEdgeLabel } from "./ingressStore";

export interface EdgeContextMenuState {
  route: IngressRoute;
  x: number;
  y: number;
}

interface IngressEdgeContextMenuProps {
  state: EdgeContextMenuState;
  onClose: () => void;
  onEdit: (route: IngressRoute) => void;
  onDelete: (route: IngressRoute) => void;
  onViewYaml: (route: IngressRoute) => void;
  onJumpToService: (route: IngressRoute) => void;
}

export function IngressEdgeContextMenu({
  state,
  onClose,
  onEdit,
  onDelete,
  onViewYaml,
  onJumpToService,
}: IngressEdgeContextMenuProps) {
  const { route, x, y } = state;
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

  const label = routeEdgeLabel(route);
  const menuW = 220;
  const menuH = 220;
  const left = Math.min(x, window.innerWidth - menuW - 8);
  const top = Math.min(y, window.innerHeight - menuH - 8);

  const items = [
    {
      id: "edit",
      label: "Edit Route",
      icon: "edit" as const,
      action: () => {
        onEdit(route);
        onClose();
      },
    },
    {
      id: "viewYaml",
      label: "View Ingress YAML",
      icon: "openYaml" as const,
      action: () => {
        onViewYaml(route);
        onClose();
      },
    },
    {
      id: "jumpSvc",
      label: "Jump to Service",
      icon: "service" as const,
      action: () => {
        onJumpToService(route);
        onClose();
      },
    },
    {
      id: "delete",
      label: "Delete Route",
      icon: "delete" as const,
      danger: true,
      dividerBefore: true,
      action: () => {
        onDelete(route);
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
      {/* Edge header */}
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
          style={{ color: "#89b4fa", display: "flex", alignItems: "center" }}
        >
          <AppIcon name="ingress" size={14} strokeWidth={1.75} />
        </span>
        <div>
          <div
            style={{
              color: "var(--text-primary)",
              fontSize: "var(--font-size-sm)",
              fontWeight: 500,
            }}
          >
            Ingress Route
          </div>
          <div
            style={{
              color: "var(--text-faint)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              maxWidth: 180,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
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
          <EdgeMenuItem
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

function EdgeMenuItem({
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
