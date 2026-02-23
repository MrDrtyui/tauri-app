import React, { useState } from "react";
import { useIDEStore } from "../store/ideStore";
import { openFolderDialog, scanYamlFiles } from "../store/tauriStore";
import { AppIcon, AppIconName } from "../ui/AppIcon";

const ACTIONS: {
  icon: AppIconName;
  title: string;
  desc: string;
  ct: string | null;
}[] = [
  {
    icon: "folderOpen",
    title: "Open Project",
    desc: "Scan YAML / Helm charts from a folder",
    ct: null,
  },
  {
    icon: "graph",
    title: "Graph View",
    desc: "Visualize microservices and dependencies",
    ct: "graph",
  },
  {
    icon: "diff",
    title: "Cluster Diff",
    desc: "Compare desired vs live cluster state",
    ct: "clusterDiff",
  },
  {
    icon: "reset",
    title: "Reset Layout",
    desc: "Restore the default panel layout",
    ct: "reset",
  },
];

const FEATURES = [
  "Dockable, splittable panels",
  "Drag & drop tab rearranging",
  "Graph to Editor cross-linking",
  "Cluster diff & status",
  "Helm chart management",
  "Serializable workspace layout",
];

export function WelcomePanel() {
  const openTab = useIDEStore((s) => s.openTab);
  const resetLayout = useIDEStore((s) => s.resetLayout);
  const setProject = useIDEStore((s) => s.setProject);
  const refreshClusterStatus = useIDEStore((s) => s.refreshClusterStatus);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleOpenProject = async () => {
    setLoading(true);
    setErr(null);
    try {
      const path = await openFolderDialog();
      if (!path) return;
      const result = await scanYamlFiles(path);
      await setProject(result);
      refreshClusterStatus();
      openTab(
        {
          id: "tab-graph",
          title: "Graph",
          contentType: "graph",
          icon: "graph",
        },
        "center",
      );
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleAction = (ct: string | null) => {
    if (!ct) {
      handleOpenProject();
      return;
    }
    if (ct === "reset") {
      resetLayout();
      return;
    }
    openTab(
      {
        id: `tab-${ct}`,
        title: ct === "graph" ? "Graph" : "Cluster Diff",
        contentType: ct as never,
        icon: ct,
      },
      ct === "graph" ? "center" : "bottom",
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        background: "var(--bg-primary)",
        fontFamily: "var(--font-ui)",
        color: "var(--text-secondary)",
        padding: 40,
        gap: 0,
        overflowY: "auto",
      }}
    >
      {/* Logo */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background:
              "linear-gradient(135deg, var(--ctp-mauve), var(--ctp-lavender))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow:
              "0 4px 20px rgba(203,166,247,0.25), 0 0 0 1px rgba(203,166,247,0.12)",
            flexShrink: 0,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <rect
              x="3"
              y="3"
              width="8"
              height="8"
              rx="1.5"
              fill="white"
              opacity="0.95"
            />
            <rect
              x="13"
              y="3"
              width="8"
              height="8"
              rx="1.5"
              fill="white"
              opacity="0.65"
            />
            <rect
              x="3"
              y="13"
              width="8"
              height="8"
              rx="1.5"
              fill="white"
              opacity="0.65"
            />
            <rect
              x="13"
              y="13"
              width="8"
              height="8"
              rx="1.5"
              fill="white"
              opacity="0.35"
            />
          </svg>
        </div>
        <div>
          <div
            style={{
              fontSize: "var(--font-size-2xl)",
              fontWeight: 600,
              color: "var(--text-primary)",
              letterSpacing: "-0.02em",
            }}
          >
            Endfield IDE
          </div>
          <div
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--text-faint)",
              marginTop: 2,
            }}
          >
            Kubernetes Infrastructure-as-Code Workspace
          </div>
        </div>
      </div>

      {/* Quick actions grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          maxWidth: 500,
          width: "100%",
          marginBottom: 8,
        }}
      >
        {ACTIONS.map((item) => (
          <ActionCard
            key={item.title}
            icon={loading && !item.ct ? "refresh" : item.icon}
            title={item.title}
            desc={item.desc}
            onClick={() => handleAction(item.ct)}
          />
        ))}
      </div>

      {/* Error */}
      {err && (
        <div
          style={{
            maxWidth: 500,
            width: "100%",
            marginTop: 6,
            padding: "8px 12px",
            background: "rgba(243,139,168,0.07)",
            border: "1px solid rgba(243,139,168,0.2)",
            borderRadius: "var(--radius-md)",
            color: "var(--ctp-red)",
            fontSize: "var(--font-size-xs)",
            fontFamily: "var(--font-mono)",
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <AppIcon name="error" size={12} strokeWidth={2} />
          {err}
        </div>
      )}

      {/* Features */}
      <div style={{ maxWidth: 500, width: "100%", marginTop: 24 }}>
        <div
          style={{
            color: "var(--text-subtle)",
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontWeight: 500,
            marginBottom: 10,
          }}
        >
          Features
        </div>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}
        >
          {FEATURES.map((f) => (
            <div
              key={f}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                color: "var(--text-faint)",
                fontSize: "var(--font-size-xs)",
              }}
            >
              <span
                style={{
                  color: "var(--status-ok)",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <AppIcon name="confirm" size={9} strokeWidth={2.5} />
              </span>
              {f}
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          marginTop: 24,
          color: "var(--text-faint)",
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          opacity: 0.5,
        }}
      >
        Mock data · Connect Tauri backend to use real cluster
      </div>
    </div>
  );
}

function ActionCard({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: AppIconName;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  const [hov, setHov] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? "var(--bg-elevated)" : "var(--bg-surface)",
        border: `1px solid ${hov ? "var(--border-default)" : "var(--border-subtle)"}`,
        borderRadius: "var(--radius-lg)",
        padding: "13px 14px",
        cursor: "pointer",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        transition: "var(--ease-fast)",
      }}
    >
      <span
        style={{
          flexShrink: 0,
          color: hov ? "var(--accent)" : "var(--text-faint)",
          display: "flex",
          alignItems: "center",
          marginTop: 2,
          transition: "var(--ease-fast)",
        }}
      >
        <AppIcon name={icon} size={18} strokeWidth={1.5} />
      </span>
      <div>
        <div
          style={{
            color: hov ? "var(--text-primary)" : "var(--text-secondary)",
            fontSize: "var(--font-size-md)",
            fontWeight: 500,
            marginBottom: 3,
            transition: "var(--ease-fast)",
          }}
        >
          {title}
        </div>
        <div
          style={{
            color: "var(--text-faint)",
            fontSize: "var(--font-size-xs)",
            lineHeight: 1.5,
          }}
        >
          {desc}
        </div>
      </div>
    </div>
  );
}
