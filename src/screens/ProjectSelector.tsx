import { AppIcon, AppIconName } from "../ui/AppIcon";
import React, { useState, useEffect } from "react";
import { useIDEStore } from "../store/ideStore";
import { openFolderDialog, scanYamlFiles } from "../store/tauriStore";

const RECENT_KEY = "endfield_recent_paths";
function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function addRecent(p: string) {
  const prev = getRecent().filter((x) => x !== p);
  localStorage.setItem(RECENT_KEY, JSON.stringify([p, ...prev].slice(0, 8)));
}

// ─── EndfieldLogo ─────────────────────────────────────────────────

function EndfieldLogo({ size = 44 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.24,
        background:
          "linear-gradient(135deg, var(--ctp-mauve) 0%, var(--ctp-lavender) 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow:
          "0 4px 20px rgba(203, 166, 247, 0.25), 0 0 0 1px rgba(203, 166, 247, 0.15)",
        flexShrink: 0,
      }}
    >
      <svg
        width={size * 0.48}
        height={size * 0.48}
        viewBox="0 0 24 24"
        fill="none"
      >
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
  );
}

// ─── FeatureItem ──────────────────────────────────────────────────

function FeatureItem({ icon, label }: { icon: string; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 10,
      }}
    >
      <span
        style={{
          fontSize: 13,
          color: "var(--accent)",
          opacity: 0.6,
          width: 18,
          textAlign: "center",
          flexShrink: 0,
        }}
      >
        <AppIcon name={icon as any} size={13} strokeWidth={1.75} />
      </span>
      <span
        style={{ color: "var(--text-subtle)", fontSize: "var(--font-size-sm)" }}
      >
        {label}
      </span>
    </div>
  );
}

// ─── ProjectSelector ──────────────────────────────────────────────

export function ProjectSelector() {
  const setProject = useIDEStore((s) => s.setProject);
  const refreshClusterStatus = useIDEStore((s) => s.refreshClusterStatus);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setRecent(getRecent());
    const t = setTimeout(() => setMounted(true), 40);
    return () => clearTimeout(t);
  }, []);

  const open = async (path?: string) => {
    setError(null);
    setLoading(true);
    try {
      const folderPath = path ?? (await openFolderDialog());
      if (!folderPath) {
        setLoading(false);
        return;
      }
      const result = await scanYamlFiles(folderPath);
      addRecent(folderPath);
      await setProject(result);
      refreshClusterStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        background: "var(--bg-app)",
        display: "flex",
        overflow: "hidden",
        fontFamily: "var(--font-ui)",
        opacity: mounted ? 1 : 0,
        transition: "opacity 0.3s ease",
      }}
    >
      {/* ── Left sidebar ── */}
      <div
        style={{
          width: 300,
          flexShrink: 0,
          background: "var(--bg-sidebar)",
          borderRight: "1px solid var(--border-subtle)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "44px 28px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Subtle ambient glow */}
        <div
          style={{
            position: "absolute",
            top: -120,
            left: -120,
            width: 400,
            height: 400,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(203, 166, 247, 0.06) 0%, transparent 65%)",
            pointerEvents: "none",
          }}
        />

        <div>
          {/* Logo + name */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              marginBottom: 32,
            }}
          >
            <EndfieldLogo size={42} />
            <div>
              <div
                style={{
                  color: "var(--text-primary)",
                  fontSize: "var(--font-size-xl)",
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                }}
              >
                Endfield
              </div>
              <div
                style={{
                  color: "var(--text-faint)",
                  fontSize: "var(--font-size-xs)",
                  marginTop: 2,
                }}
              >
                Kubernetes IDE
              </div>
            </div>
          </div>

          <p
            style={{
              color: "var(--text-faint)",
              fontSize: "var(--font-size-sm)",
              lineHeight: 1.8,
              marginBottom: 32,
            }}
          >
            Infrastructure-as-code workspace
            <br />
            for Kubernetes developers
          </p>

          {/* Feature list */}
          <FeatureItem icon="graph" label="Visual graph editor" />
          <FeatureItem icon="helmRelease" label="Helm chart support" />
          <FeatureItem icon="monitoring" label="Live cluster status" />
          <FeatureItem icon="fileYaml" label="YAML editor" />
          <FeatureItem icon="diff" label="Cluster diff & logs" />
        </div>

        <div
          style={{
            color: "var(--text-faint)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            opacity: 0.5,
          }}
        >
          v0.1.0-alpha
        </div>
      </div>

      {/* ── Right panel ── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "52px 56px",
          overflowY: "auto",
          background: "var(--bg-primary)",
        }}
      >
        <div
          style={{
            color: "var(--text-primary)",
            fontSize: "var(--font-size-2xl)",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            marginBottom: 6,
          }}
        >
          Start
        </div>
        <div
          style={{
            color: "var(--text-subtle)",
            fontSize: "var(--font-size-md)",
            marginBottom: 36,
          }}
        >
          Open a folder with Kubernetes configs to begin
        </div>

        {/* Open button */}
        <button
          onClick={() => open()}
          disabled={loading}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "13px 20px",
            background: loading
              ? "rgba(203, 166, 247, 0.1)"
              : "rgba(203, 166, 247, 0.08)",
            border: "1px solid var(--border-accent)",
            borderRadius: "var(--radius-xl)",
            cursor: loading ? "wait" : "pointer",
            marginBottom: 28,
            maxWidth: 420,
            transition: "var(--ease-std)",
          }}
          onMouseEnter={(e) => {
            if (!loading)
              (e.currentTarget as HTMLElement).style.background =
                "rgba(203, 166, 247, 0.15)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background =
              "rgba(203, 166, 247, 0.08)";
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "var(--radius-md)",
              background: "rgba(203, 166, 247, 0.15)",
              border: "1px solid rgba(203, 166, 247, 0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              flexShrink: 0,
            }}
          >
            {loading ? (
              <span
                style={{
                  animation: "ef-pulse-dot 0.8s ease-in-out infinite",
                  display: "inline-block",
                }}
              >
                ···
              </span>
            ) : (
              <AppIcon
                name="folderOpen"
                size={18}
                strokeWidth={1.5}
                style={{ color: "var(--accent-alt)" }}
              />
            )}
          </div>
          <div style={{ textAlign: "left" }}>
            <div
              style={{
                color: "var(--accent-alt)",
                fontSize: "var(--font-size-md)",
                fontWeight: 500,
              }}
            >
              {loading ? "Opening…" : "Open Folder"}
            </div>
            <div
              style={{
                color: "var(--text-faint)",
                fontSize: "var(--font-size-xs)",
                marginTop: 1,
              }}
            >
              Select a project directory
            </div>
          </div>
        </button>

        {/* Error */}
        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: "10px 14px",
              background: "rgba(243, 139, 168, 0.08)",
              border: "1px solid rgba(243, 139, 168, 0.2)",
              borderRadius: "var(--radius-md)",
              marginBottom: 24,
              maxWidth: 420,
            }}
          >
            <AppIcon
              name="warning"
              size={13}
              strokeWidth={2}
              style={{ color: "var(--accent-red)", flexShrink: 0 }}
            />
            <span
              style={{
                color: "var(--accent-red)",
                fontSize: "var(--font-size-sm)",
                lineHeight: 1.5,
              }}
            >
              {error}
            </span>
          </div>
        )}

        {/* Recent */}
        {recent.length > 0 && (
          <div style={{ maxWidth: 520 }}>
            <div
              style={{
                color: "var(--text-subtle)",
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 500,
                marginBottom: 12,
              }}
            >
              Recent
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {recent.map((p) => {
                const parts = p.split("/").filter(Boolean);
                const name = parts[parts.length - 1];
                const dir = "/" + parts.slice(0, -1).join("/");
                return (
                  <RecentItem
                    key={p}
                    name={name}
                    path={dir}
                    onClick={() => open(p)}
                    disabled={loading}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RecentItem({
  name,
  path,
  onClick,
  disabled,
}: {
  name: string;
  path: string;
  onClick: () => void;
  disabled: boolean;
}) {
  const [hov, setHov] = React.useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "9px 12px",
        background: hov ? "var(--bg-elevated)" : "transparent",
        border: "1px solid " + (hov ? "var(--border-default)" : "transparent"),
        borderRadius: "var(--radius-md)",
        cursor: disabled ? "wait" : "pointer",
        textAlign: "left",
        transition: "var(--ease-fast)",
        width: "100%",
      }}
    >
      <span style={{ flexShrink: 0, opacity: 0.7, display: "flex" }}>
        <AppIcon name="folder" size={16} strokeWidth={1.5} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: hov ? "var(--text-primary)" : "var(--text-secondary)",
            fontSize: "var(--font-size-md)",
            fontWeight: 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            transition: "var(--ease-fast)",
          }}
        >
          {name}
        </div>
        <div
          style={{
            color: "var(--text-faint)",
            fontSize: "var(--font-size-xs)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "var(--font-mono)",
            marginTop: 1,
          }}
        >
          {path}
        </div>
      </div>
      {hov && (
        <span
          style={{ color: "var(--text-faint)", flexShrink: 0, display: "flex" }}
        >
          <AppIcon name="arrowRight" size={12} strokeWidth={2} />
        </span>
      )}
    </button>
  );
}
