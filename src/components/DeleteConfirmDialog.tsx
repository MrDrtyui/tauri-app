import React, { useEffect } from "react";
import { YamlNode } from "../store/tauriStore";
import { executeCommand } from "../commands/commands";

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
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div style={{
        background: "#0f1a2e",
        border: "1px solid rgba(239,68,68,0.25)",
        borderRadius: 9,
        width: 360,
        fontFamily: "'JetBrains Mono', monospace",
        overflow: "hidden",
        boxShadow: "0 16px 48px rgba(0,0,0,0.7)",
      }}>
        {/* Header */}
        <div style={{
          padding: "12px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ color: "#ef4444", fontSize: 14 }}>⚠</span>
          <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 700 }}>Delete field</span>
        </div>

        {/* Body */}
        <div style={{ padding: "14px 16px" }}>
          <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 11, lineHeight: 1.6, margin: 0 }}>
            Are you sure you want to delete{" "}
            <span style={{ color: "#93c5fd", fontWeight: 600 }}>"{node.label}"</span>?
          </p>
          <div style={{
            marginTop: 10,
            padding: "8px 10px",
            background: "rgba(239,68,68,0.07)",
            border: "1px solid rgba(239,68,68,0.15)",
            borderRadius: 5,
          }}>
            {[
              ["Kind", node.kind],
              ["Namespace", node.namespace ?? "—"],
              ["Source", node.source],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", gap: 8, marginBottom: 3 }}>
                <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 10, width: 70, flexShrink: 0 }}>{k}</span>
                <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 10 }}>{v}</span>
              </div>
            ))}
          </div>
          <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 10, marginTop: 10, marginBottom: 0 }}>
            Open editor tabs for this field will be closed.
          </p>
        </div>

        {/* Actions */}
        <div style={{
          padding: "10px 16px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button
            onClick={onClose}
            style={{
              padding: "6px 14px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 5, color: "rgba(255,255,255,0.5)",
              fontSize: 11, cursor: "pointer", fontFamily: "monospace",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            style={{
              padding: "6px 14px",
              background: "rgba(239,68,68,0.15)",
              border: "1px solid rgba(239,68,68,0.35)",
              borderRadius: 5, color: "#fca5a5",
              fontSize: 11, cursor: "pointer", fontFamily: "monospace",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(239,68,68,0.25)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(239,68,68,0.15)")}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
