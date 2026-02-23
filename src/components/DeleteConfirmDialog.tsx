import React, { useEffect } from "react";
import { YamlNode } from "../store/tauriStore";
import { executeCommand } from "../commands/commands";
import { AppIcon } from "../ui/AppIcon";

interface Props {
  node: YamlNode;
  onClose: () => void;
}

export function DeleteConfirmDialog({ node, onClose }: Props) {
  const handleDelete = () => {
    executeCommand("field.delete", { node });
    onClose();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter") handleDelete();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "var(--blur-sm)",
        WebkitBackdropFilter: "var(--blur-sm)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "var(--bg-modal)",
          border: "1px solid rgba(243,139,168,0.20)",
          borderRadius: "var(--radius-2xl)",
          width: 360,
          fontFamily: "var(--font-ui)",
          overflow: "hidden",
          boxShadow:
            "0 24px 64px rgba(0,0,0,0.75), 0 0 0 1px var(--border-subtle)",
          animation: "ef-fadein 0.12s ease-out",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              color: "var(--status-error)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <AppIcon name="warning" size={15} strokeWidth={2} />
          </span>
          <span
            style={{
              color: "var(--text-primary)",
              fontSize: "var(--font-size-md)",
              fontWeight: 500,
            }}
          >
            Delete field
          </span>
        </div>

        {/* Body */}
        <div style={{ padding: "14px 16px" }}>
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: "var(--font-size-sm)",
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            Are you sure you want to delete{" "}
            <span
              style={{
                color: "var(--accent-alt)",
                fontWeight: 500,
                fontFamily: "var(--font-mono)",
              }}
            >
              "{node.label}"
            </span>
            ?
          </p>

          <div
            style={{
              marginTop: 10,
              padding: "8px 10px",
              background: "rgba(243,139,168,0.05)",
              border: "1px solid rgba(243,139,168,0.14)",
              borderRadius: "var(--radius-md)",
            }}
          >
            {[
              ["Kind", node.kind],
              ["Namespace", node.namespace ?? "—"],
              ["Source", node.source],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", gap: 8, marginBottom: 3 }}>
                <span
                  style={{
                    color: "var(--text-faint)",
                    fontSize: "var(--font-size-xs)",
                    fontFamily: "var(--font-mono)",
                    width: 68,
                    flexShrink: 0,
                  }}
                >
                  {k}
                </span>
                <span
                  style={{
                    color: "var(--text-muted)",
                    fontSize: "var(--font-size-xs)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {v}
                </span>
              </div>
            ))}
          </div>

          <p
            style={{
              color: "var(--text-faint)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              marginTop: 10,
              marginBottom: 0,
            }}
          >
            Open editor tabs for this field will be closed.
          </p>
        </div>

        {/* Actions */}
        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "6px 14px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-muted)",
              fontSize: "var(--font-size-sm)",
              cursor: "pointer",
              fontFamily: "var(--font-ui)",
              transition: "var(--ease-fast)",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.background =
                "var(--ctp-surface1)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background =
                "var(--bg-elevated)")
            }
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            style={{
              padding: "6px 14px",
              background: "rgba(243,139,168,0.12)",
              border: "1px solid rgba(243,139,168,0.30)",
              borderRadius: "var(--radius-sm)",
              color: "var(--ctp-red)",
              fontSize: "var(--font-size-sm)",
              cursor: "pointer",
              fontFamily: "var(--font-ui)",
              fontWeight: 500,
              transition: "var(--ease-fast)",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.background =
                "rgba(243,139,168,0.22)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background =
                "rgba(243,139,168,0.12)")
            }
          >
            <AppIcon name="delete" size={13} strokeWidth={2} />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
