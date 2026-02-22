import React, { useState } from "react";
import { useIDEStore } from "../store/ideStore";
import { openFolderDialog, scanYamlFiles } from "../store/tauriStore";

export function WelcomePanel() {
  const openTab = useIDEStore((s) => s.openTab);
  const resetLayout = useIDEStore((s) => s.resetLayout);
  const setProject = useIDEStore((s) => s.setProject);
  const refreshClusterStatus = useIDEStore((s) => s.refreshClusterStatus);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleOpenProject = async () => {
    setLoading(true); setErr(null);
    try {
      const path = await openFolderDialog();
      if (!path) return;
      const result = await scanYamlFiles(path);
      await setProject(result);
      refreshClusterStatus();
      openTab({ id: "tab-graph", title: "Graph", contentType: "graph", icon: "⬡" }, "center");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        background: "linear-gradient(160deg, #0a1628 0%, #060e1c 100%)",
        fontFamily: "'JetBrains Mono', monospace",
        color: "#94a3b8",
        padding: 40,
        gap: 0,
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: "linear-gradient(135deg, #60a5fa, #2563eb)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            color: "white",
            fontWeight: 700,
            boxShadow: "0 0 30px rgba(59,130,246,0.4)",
          }}
        >
          E
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0", letterSpacing: "0.06em" }}>
            Endfield IDE
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
            Kubernetes Infrastructure-as-Code Workspace
          </div>
        </div>
      </div>

      <div style={{ width: 1, height: 24 }} />

      {/* Grid of quick actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 520, width: "100%" }}>
        {[
          {
            icon: loading ? "⟳" : "📁",
            title: "Open Project",
            desc: "Scan YAML / Helm charts from a folder",
            action: handleOpenProject,
          },
          {
            icon: "⬡",
            title: "Graph View",
            desc: "Visualize microservices and dependencies",
            action: () =>
              openTab({ id: "tab-graph", title: "Graph", contentType: "graph", icon: "⬡" }, "center"),
          },
          {
            icon: "⊞",
            title: "Cluster Diff",
            desc: "Compare desired vs live cluster state",
            action: () =>
              openTab({ id: "tab-diff", title: "Cluster Diff", contentType: "clusterDiff", icon: "⊞" }, "bottom"),
          },
          {
            icon: "↺",
            title: "Reset Layout",
            desc: "Restore the default panel layout",
            action: resetLayout,
          },
        ].map((item) => (
          <div
            key={item.title}
            onClick={item.action}
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 8,
              padding: "14px 16px",
              cursor: "pointer",
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              transition: "all 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(59,130,246,0.08)";
              e.currentTarget.style.borderColor = "rgba(96,165,250,0.3)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.03)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)";
            }}
          >
            <span style={{ fontSize: 20, flexShrink: 0 }}>{item.icon}</span>
            <div>
              <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600, marginBottom: 3 }}>
                {item.title}
              </div>
              <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 10, lineHeight: 1.4 }}>
                {item.desc}
              </div>
            </div>
          </div>
        ))}
      </div>

      {err && (
        <div style={{ maxWidth: 520, width: "100%", marginTop: 8, padding: "6px 12px",
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: 5, color: "#fca5a5", fontSize: 10, fontFamily: "monospace" }}>
          ✗ {err}
        </div>
      )}

      <div style={{ width: 1, height: 28 }} />

      {/* Feature list */}
      <div style={{ maxWidth: 520, width: "100%" }}>
        <div
          style={{
            color: "rgba(255,255,255,0.15)",
            fontSize: 9,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Features
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {[
            "Dockable, splittable panels",
            "Drag & drop tab rearranging",
            "Graph → Editor cross-linking",
            "Cluster diff & status",
            "Helm chart management",
            "Serializable workspace layout",
          ].map((f) => (
            <div
              key={f}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: "rgba(255,255,255,0.3)",
                fontSize: 10,
              }}
            >
              <span style={{ color: "#6ee7b7", fontSize: 9 }}>◦</span>
              {f}
            </div>
          ))}
        </div>
      </div>

      <div style={{ width: 1, height: 24 }} />

      <div style={{ color: "rgba(255,255,255,0.1)", fontSize: 9 }}>
        Mock data • Connect Tauri backend to use real cluster
      </div>
    </div>
  );
}
