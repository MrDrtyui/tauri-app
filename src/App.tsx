import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

// ─── Mock данные для dev без Tauri ────────────────────────────────────────────
const MOCK_SCAN_RESULT = {
  project_path: "/home/user/infra",
  errors: [],
  nodes: [
    {
      id: "nginx-0",
      label: "nginx",
      kind: "Deployment",
      image: "nginx:latest",
      type_id: "gateway",
      namespace: "default",
      file_path: "/infra/nginx.yaml",
      replicas: 2,
    },
    {
      id: "auth-1",
      label: "auth-service",
      kind: "Deployment",
      image: "myapp/auth:v1.2",
      type_id: "service",
      namespace: "default",
      file_path: "/infra/auth.yaml",
      replicas: 3,
    },
    {
      id: "payment-2",
      label: "payment-svc",
      kind: "Deployment",
      image: "myapp/payment:v2.0",
      type_id: "service",
      namespace: "default",
      file_path: "/infra/payment.yaml",
      replicas: 3,
    },
    {
      id: "redis-3",
      label: "redis-cache",
      kind: "StatefulSet",
      image: "redis:7-alpine",
      type_id: "cache",
      namespace: "default",
      file_path: "/infra/redis.yaml",
      replicas: 1,
    },
    {
      id: "kafka-4",
      label: "kafka-broker",
      kind: "StatefulSet",
      image: "confluentinc/cp-kafka:7.4",
      type_id: "queue",
      namespace: "default",
      file_path: "/infra/kafka.yaml",
      replicas: 3,
    },
    {
      id: "postgres-5",
      label: "postgres-db",
      kind: "StatefulSet",
      image: "postgres:15",
      type_id: "database",
      namespace: "default",
      file_path: "/infra/postgres.yaml",
      replicas: 1,
    },
    {
      id: "api-gw-6",
      label: "api-gateway",
      kind: "Deployment",
      image: "traefik:v3",
      type_id: "gateway",
      namespace: "default",
      file_path: "/infra/gateway.yaml",
      replicas: 2,
    },
    {
      id: "redis-cl-7",
      label: "redis-cluster",
      kind: "StatefulSet",
      image: "redis:7-alpine",
      type_id: "cache",
      namespace: "kube-sys",
      file_path: "/infra/redis-cl.yaml",
      replicas: 6,
    },
  ],
};

// ─── Safe invoke: пробует Tauri, при ошибке fallback на mock ─────────────────
async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    console.warn(`[mock] invoke("${cmd}") failed, using mock:`, e);
    if (cmd === "open_folder_dialog") return "/home/user/infra" as T;
    if (cmd === "scan_yaml_files") return MOCK_SCAN_RESULT as T;
    if (cmd === "read_yaml_file")
      return "# mock yaml\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: mock\n" as T;
    throw e;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface YamlNode {
  id: string;
  label: string;
  kind: string;
  image: string;
  type_id: string;
  typeId: string;
  namespace: string;
  file_path: string;
  filePath: string;
  replicas: number | null;
  x: number;
  y: number;
}

interface ScanResult {
  nodes: YamlNode[];
  project_path: string;
  errors: string[];
}

interface NodeType {
  label: string;
  bg: string;
  border: string;
  color: string;
  shadow: string;
  glow: string;
  accent: string;
  dot: string;
  icon: string;
}

// ─── Node type визуальные пресеты ─────────────────────────────────────────────
const NODE_TYPES: Record<string, NodeType> = {
  gateway: {
    label: "Gateway",
    bg: "linear-gradient(135deg, #0f2847 0%, #1a3a6b 100%)",
    border: "rgba(96,165,250,0.6)",
    color: "#bfdbfe",
    shadow: "rgba(59,130,246,0.4)",
    glow: "rgba(59,130,246,0.7)",
    accent: "#3b82f6",
    dot: "#60a5fa",
    icon: "⬡",
  },
  service: {
    label: "Service",
    bg: "linear-gradient(135deg, #052e1c 0%, #0d4a2e 100%)",
    border: "rgba(52,211,153,0.6)",
    color: "#6ee7b7",
    shadow: "rgba(16,185,129,0.35)",
    glow: "rgba(16,185,129,0.65)",
    accent: "#10b981",
    dot: "#34d399",
    icon: "◈",
  },
  database: {
    label: "Database",
    bg: "linear-gradient(135deg, #0a1f3d 0%, #112d58 100%)",
    border: "rgba(59,130,246,0.55)",
    color: "#93c5fd",
    shadow: "rgba(37,99,235,0.4)",
    glow: "rgba(37,99,235,0.65)",
    accent: "#2563eb",
    dot: "#60a5fa",
    icon: "◫",
  },
  cache: {
    label: "Cache",
    bg: "linear-gradient(135deg, #2d1000 0%, #4a1f00 100%)",
    border: "rgba(251,146,60,0.6)",
    color: "#fed7aa",
    shadow: "rgba(234,88,12,0.4)",
    glow: "rgba(234,88,12,0.65)",
    accent: "#ea580c",
    dot: "#fb923c",
    icon: "⚡",
  },
  queue: {
    label: "Queue",
    bg: "linear-gradient(135deg, #2d0000 0%, #4a0a0a 100%)",
    border: "rgba(239,68,68,0.6)",
    color: "#fca5a5",
    shadow: "rgba(220,38,38,0.4)",
    glow: "rgba(220,38,38,0.65)",
    accent: "#dc2626",
    dot: "#f87171",
    icon: "⊛",
  },
  monitoring: {
    label: "Monitoring",
    bg: "linear-gradient(135deg, #12003d 0%, #1e0a5e 100%)",
    border: "rgba(167,139,250,0.6)",
    color: "#ddd6fe",
    shadow: "rgba(124,58,237,0.4)",
    glow: "rgba(124,58,237,0.65)",
    accent: "#7c3aed",
    dot: "#a78bfa",
    icon: "◎",
  },
  config: {
    label: "Config",
    bg: "linear-gradient(135deg, #1f1a00 0%, #332c00 100%)",
    border: "rgba(234,179,8,0.55)",
    color: "#fef08a",
    shadow: "rgba(202,138,4,0.35)",
    glow: "rgba(202,138,4,0.6)",
    accent: "#ca8a04",
    dot: "#facc15",
    icon: "≡",
  },
  custom: {
    label: "Custom",
    bg: "linear-gradient(135deg, #0f1117 0%, #1a1d27 100%)",
    border: "rgba(100,116,139,0.5)",
    color: "#cbd5e1",
    shadow: "rgba(71,85,105,0.35)",
    glow: "rgba(71,85,105,0.55)",
    accent: "#475569",
    dot: "#64748b",
    icon: "◇",
  },
};

function getType(typeId: string): NodeType {
  return NODE_TYPES[typeId] || NODE_TYPES.custom;
}

// ─── Нормализация ноды из бэкенда (snake_case → camelCase) ───────────────────
function normalizeNode(node: Partial<YamlNode>): YamlNode {
  return {
    ...node,
    id: node.id || "",
    label: node.label || "",
    kind: node.kind || "",
    image: node.image || "",
    namespace: node.namespace || "default",
    replicas: node.replicas ?? null,
    x: node.x ?? 0,
    y: node.y ?? 0,
    typeId: node.typeId || (node as any).type_id || "service",
    filePath: node.filePath || (node as any).file_path || "",
    type_id: (node as any).type_id || node.typeId || "service",
    file_path: (node as any).file_path || node.filePath || "",
  } as YamlNode;
}

// ─── Авто-расстановка нод в сетку ────────────────────────────────────────────
function autoLayout(nodes: Partial<YamlNode>[]): YamlNode[] {
  const cols = 4,
    xStep = 22,
    yStep = 18,
    xStart = 5,
    yStart = 8;
  return nodes.map((node, i) => ({
    ...normalizeNode(node),
    x: xStart + (i % cols) * xStep,
    y: yStart + Math.floor(i / cols) * yStep,
  }));
}

// ─── Project Selector ─────────────────────────────────────────────────────────
function ProjectSelector({
  onProjectLoaded,
}: {
  onProjectLoaded: (r: ScanResult) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recentPaths = ["~/projects/myapp/infra", "~/work/k8s-configs"];

  const handleOpen = async () => {
    setLoading(true);
    setError(null);
    try {
      const folderPath = await safeInvoke<string>("open_folder_dialog");
      if (!folderPath) {
        setLoading(false);
        return;
      }
      const result = await safeInvoke<ScanResult>("scan_yaml_files", {
        folderPath,
      });
      onProjectLoaded(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleRecent = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await safeInvoke<ScanResult>("scan_yaml_files", {
        folderPath: path,
      });
      onProjectLoaded(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        background: "#0a1628",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "monospace",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(59,130,246,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.04) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "30%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: "40vw",
          height: "40vw",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(59,130,246,0.07) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "2vw",
          width: "32vw",
          minWidth: 340,
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.8vw",
            marginBottom: "0.5vw",
          }}
        >
          <div
            style={{
              width: "3vw",
              height: "3vw",
              minWidth: 36,
              minHeight: 36,
              borderRadius: "0.6vw",
              background: "linear-gradient(135deg, #60a5fa, #2563eb)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 20px rgba(59,130,246,0.5)",
            }}
          >
            <svg
              style={{ width: "55%", height: "55%" }}
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
                opacity="0.9"
              />
              <rect
                x="13"
                y="3"
                width="8"
                height="8"
                rx="1.5"
                fill="white"
                opacity="0.6"
              />
              <rect
                x="3"
                y="13"
                width="8"
                height="8"
                rx="1.5"
                fill="white"
                opacity="0.6"
              />
              <rect
                x="13"
                y="13"
                width="8"
                height="8"
                rx="1.5"
                fill="white"
                opacity="0.3"
              />
            </svg>
          </div>
          <span
            style={{
              fontSize: "1.8vw",
              fontWeight: "bold",
              color: "white",
              letterSpacing: "0.05em",
            }}
          >
            Endfield
          </span>
        </div>
        <p
          style={{
            color: "rgba(255,255,255,0.35)",
            fontSize: "0.85vw",
            textAlign: "center",
            margin: 0,
            lineHeight: 1.6,
          }}
        >
          Визуализация Kubernetes инфраструктуры
          <br />
          из YAML конфигов
        </p>
        {/* Open button */}
        <button
          onClick={handleOpen}
          disabled={loading}
          style={{
            width: "100%",
            padding: "1.1vw 0",
            background: loading
              ? "rgba(37,99,235,0.4)"
              : "linear-gradient(135deg, #3b82f6, #2563eb)",
            border: "1px solid rgba(96,165,250,0.3)",
            borderRadius: "0.7vw",
            color: "white",
            fontSize: "0.95vw",
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            boxShadow: "0 0 24px rgba(59,130,246,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.6vw",
            fontFamily: "monospace",
            transition: "all 0.15s",
            letterSpacing: "0.02em",
          }}
        >
          {loading ? (
            <>
              <div
                style={{
                  width: "0.9vw",
                  height: "0.9vw",
                  borderRadius: "50%",
                  border: "2px solid rgba(255,255,255,0.3)",
                  borderTopColor: "white",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              Сканирование...
            </>
          ) : (
            <>
              <span style={{ fontSize: "1.1vw" }}>⊞</span>Открыть папку с
              конфигами
            </>
          )}
        </button>
        {/* Recent */}
        <div style={{ width: "100%" }}>
          <div
            style={{
              color: "rgba(255,255,255,0.25)",
              fontSize: "0.7vw",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: "0.6vw",
            }}
          >
            Недавние
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.35vw" }}
          >
            {recentPaths.map((p) => (
              <div
                key={p}
                onClick={() => handleRecent(p)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.6vw",
                  padding: "0.55vw 0.8vw",
                  borderRadius: "0.5vw",
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.03)",
                  cursor: "pointer",
                  transition: "all 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(59,130,246,0.08)";
                  e.currentTarget.style.borderColor = "rgba(96,165,250,0.3)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                }}
              >
                <span
                  style={{ fontSize: "0.8vw", color: "rgba(255,255,255,0.3)" }}
                >
                  ⊙
                </span>
                <span
                  style={{
                    fontSize: "0.78vw",
                    color: "rgba(255,255,255,0.5)",
                    fontFamily: "monospace",
                  }}
                >
                  {p}
                </span>
              </div>
            ))}
          </div>
        </div>
        {error && (
          <div
            style={{
              width: "100%",
              padding: "0.7vw 0.9vw",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: "0.5vw",
              color: "#fca5a5",
              fontSize: "0.75vw",
            }}
          >
            ⚠ {error}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Scan Toast ───────────────────────────────────────────────────────────────
function ScanToast({
  result,
  onDismiss,
}: {
  result: ScanResult;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, []);
  const hasErrors = result.errors.length > 0;
  return (
    <div
      style={{
        position: "fixed",
        bottom: "2vw",
        right: "2vw",
        zIndex: 2000,
        background: hasErrors ? "rgba(120,40,10,0.9)" : "rgba(10,40,20,0.9)",
        border: `1px solid ${hasErrors ? "rgba(251,146,60,0.4)" : "rgba(52,211,153,0.4)"}`,
        borderRadius: "0.7vw",
        padding: "0.8vw 1.2vw",
        color: hasErrors ? "#fdba74" : "#6ee7b7",
        fontSize: "0.8vw",
        backdropFilter: "blur(16px)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        display: "flex",
        flexDirection: "column",
        gap: "0.3vw",
        animation: "ctxIn 0.2s ease both",
        maxWidth: "24vw",
      }}
    >
      <span style={{ fontWeight: 600 }}>
        {hasErrors ? "⚠" : "✓"} Загружено {result.nodes.length} fields
      </span>
      <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.7vw" }}>
        {result.project_path}
      </span>
      {hasErrors && (
        <span style={{ fontSize: "0.7vw" }}>
          {result.errors.length} ошибок парсинга
        </span>
      )}
    </div>
  );
}

// ─── Context Menu ─────────────────────────────────────────────────────────────
interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  nodeId: string | null;
  label: string;
  kind: string;
  namespace: string;
}

function ContextMenu({
  menu,
  onClose,
  onDelete,
  onRename,
  onOpenFile,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onOpenFile: (id: string) => void;
}) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(menu.label);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);
  if (!menu.visible) return null;

  const items = [
    {
      id: "rename",
      icon: "✎",
      label: "Переименовать",
      color: "#e2e8f0",
      action: () => setRenaming(true),
    },
    {
      id: "openfile",
      icon: "◫",
      label: "Открыть YAML",
      color: "#93c5fd",
      action: () => {
        onOpenFile(menu.nodeId!);
        onClose();
      },
    },
    { id: "sep" },
    {
      id: "delete",
      icon: "⌫",
      label: "Удалить",
      color: "#f87171",
      action: () => {
        onDelete(menu.nodeId!);
        onClose();
      },
    },
  ];

  return (
    <>
      <div
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
        style={{ position: "fixed", inset: 0, zIndex: 998 }}
      />
      <div
        style={{
          position: "fixed",
          left: menu.x,
          top: menu.y,
          zIndex: 999,
          minWidth: "13vw",
          borderRadius: "0.9vw",
          padding: "0.4vw",
          background: "rgba(20,28,46,0.78)",
          backdropFilter: "blur(28px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.13)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.55)",
          animation: "ctxIn 0.15s cubic-bezier(0.34,1.4,0.64,1) both",
          transformOrigin: "top left",
          fontFamily: "monospace",
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          style={{
            padding: "0.4vw 0.8vw 0.5vw",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            marginBottom: "0.3vw",
          }}
        >
          {renaming ? (
            <input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onRename(menu.nodeId!, newName);
                  onClose();
                }
                if (e.key === "Escape") setRenaming(false);
              }}
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(96,165,250,0.5)",
                borderRadius: "0.35vw",
                color: "white",
                fontSize: "0.78vw",
                padding: "0.25vw 0.5vw",
                outline: "none",
              }}
            />
          ) : (
            <div>
              <div
                style={{
                  color: "rgba(255,255,255,0.55)",
                  fontSize: "0.75vw",
                  fontWeight: 600,
                }}
              >
                {menu.label}
              </div>
              {menu.kind && (
                <div
                  style={{
                    color: "rgba(255,255,255,0.25)",
                    fontSize: "0.65vw",
                    marginTop: "0.1vw",
                  }}
                >
                  {menu.kind} · {menu.namespace}
                </div>
              )}
            </div>
          )}
        </div>
        {items.map((item) => {
          if (item.id === "sep")
            return (
              <div
                key="sep"
                style={{
                  height: "1px",
                  background: "rgba(255,255,255,0.07)",
                  margin: "0.3vw 0.4vw",
                }}
              />
            );
          return (
            <div
              key={item.id}
              onMouseEnter={() => setHoveredItem(item.id)}
              onMouseLeave={() => setHoveredItem(null)}
              onClick={item.action}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6vw",
                padding: "0.45vw 0.8vw",
                borderRadius: "0.55vw",
                cursor: "pointer",
                background:
                  hoveredItem === item.id
                    ? item.id === "delete"
                      ? "rgba(239,68,68,0.18)"
                      : "rgba(255,255,255,0.09)"
                    : "transparent",
                transition: "background 0.1s",
              }}
            >
              <span
                style={{
                  fontSize: "0.95vw",
                  color:
                    hoveredItem === item.id
                      ? item.color!
                      : "rgba(255,255,255,0.4)",
                  width: "1.1vw",
                  textAlign: "center",
                  flexShrink: 0,
                }}
              >
                {item.icon}
              </span>
              <span
                style={{
                  fontSize: "0.8vw",
                  color:
                    hoveredItem === item.id
                      ? item.color!
                      : "rgba(255,255,255,0.82)",
                  fontWeight: item.id === "delete" ? 500 : 400,
                }}
              >
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── YAML Modal ───────────────────────────────────────────────────────────────
function YamlModal({ node, onClose }: { node: YamlNode; onClose: () => void }) {
  const [content, setContent] = useState("Загрузка...");
  useEffect(() => {
    const path = node.filePath || node.file_path || "";
    if (!path) {
      setContent("# Путь к файлу не указан");
      return;
    }
    safeInvoke<string>("read_yaml_file", { filePath: path })
      .then(setContent)
      .catch((e) => setContent(`Ошибка: ${e}`));
  }, [node.filePath]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(6,12,22,0.7)",
          backdropFilter: "blur(8px)",
        }}
      />
      <div
        style={{
          position: "relative",
          width: "42vw",
          maxHeight: "75vh",
          borderRadius: "1vw",
          background: "rgba(13,22,40,0.95)",
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
          display: "flex",
          flexDirection: "column",
          animation: "modalIn 0.2s cubic-bezier(0.34,1.45,0.64,1) both",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "0.8vw 1.2vw",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div>
            <span
              style={{ color: "white", fontWeight: 600, fontSize: "0.9vw" }}
            >
              {node.label}
            </span>
            <span
              style={{
                color: "rgba(255,255,255,0.3)",
                fontSize: "0.72vw",
                marginLeft: "0.6vw",
              }}
            >
              {node.filePath || node.file_path}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "none",
              borderRadius: "50%",
              width: "1.5vw",
              height: "1.5vw",
              minWidth: 20,
              minHeight: 20,
              color: "rgba(255,255,255,0.5)",
              cursor: "pointer",
              fontSize: "0.75vw",
            }}
          >
            ✕
          </button>
        </div>
        <pre
          style={{
            flex: 1,
            overflowY: "auto",
            margin: 0,
            padding: "1vw 1.2vw",
            color: "#93c5fd",
            fontSize: "0.75vw",
            lineHeight: 1.7,
            fontFamily: "monospace",
            background: "transparent",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {content}
        </pre>
      </div>
    </div>
  );
}

// ─── Add Node Modal ───────────────────────────────────────────────────────────
function AddNodeModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (n: { name: string; typeId: string }) => void;
}) {
  const [name, setName] = useState("");
  const [selectedTypeId, setSelectedTypeId] = useState("service");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const typeEntries = Object.entries(NODE_TYPES);
  const handleAdd = () => {
    if (!name.trim()) {
      inputRef.current?.focus();
      return;
    }
    onAdd({ name: name.trim(), typeId: selectedTypeId });
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(6,12,22,0.65)",
          backdropFilter: "blur(8px)",
        }}
      />
      <div
        style={{
          position: "relative",
          width: "26vw",
          minWidth: 300,
          borderRadius: "1.2vw",
          background: "rgba(16,24,40,0.88)",
          backdropFilter: "blur(32px)",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
          animation: "modalIn 0.22s cubic-bezier(0.34,1.45,0.64,1) both",
          fontFamily: "monospace",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "1vw 1.3vw 0.8vw",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ color: "white", fontWeight: 600, fontSize: "0.95vw" }}>
            Новый Field
          </span>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "none",
              borderRadius: "50%",
              width: "1.5vw",
              height: "1.5vw",
              minWidth: 20,
              minHeight: 20,
              color: "rgba(255,255,255,0.5)",
              cursor: "pointer",
              fontSize: "0.72vw",
            }}
          >
            ✕
          </button>
        </div>
        <div
          style={{
            padding: "0.9vw 1.3vw 1.2vw",
            display: "flex",
            flexDirection: "column",
            gap: "0.9vw",
          }}
        >
          <div>
            <label
              style={{
                display: "block",
                color: "rgba(255,255,255,0.35)",
                fontSize: "0.68vw",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: "0.4vw",
              }}
            >
              Название
            </label>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
                if (e.key === "Escape") onClose();
              }}
              placeholder="my-service"
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "0.45vw",
                color: "white",
                fontSize: "0.82vw",
                padding: "0.55vw 0.7vw",
                outline: "none",
                fontFamily: "monospace",
              }}
              onFocus={(e) =>
                (e.target.style.borderColor = "rgba(96,165,250,0.6)")
              }
              onBlur={(e) =>
                (e.target.style.borderColor = "rgba(255,255,255,0.1)")
              }
            />
          </div>
          <div>
            <label
              style={{
                display: "block",
                color: "rgba(255,255,255,0.35)",
                fontSize: "0.68vw",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: "0.4vw",
              }}
            >
              Тип
            </label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "0.35vw",
              }}
            >
              {typeEntries.map(([id, t]) => (
                <div
                  key={id}
                  onClick={() => setSelectedTypeId(id)}
                  style={{
                    padding: "0.5vw 0.3vw",
                    borderRadius: "0.45vw",
                    border:
                      selectedTypeId === id
                        ? `1.5px solid ${t.border.replace("0.6)", "0.95)")}`
                        : "1.5px solid rgba(255,255,255,0.06)",
                    background:
                      selectedTypeId === id ? t.bg : "rgba(255,255,255,0.03)",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "0.25vw",
                    boxShadow:
                      selectedTypeId === id ? `0 0 10px ${t.shadow}` : "none",
                    transition: "all 0.12s",
                    position: "relative",
                    overflow: "hidden",
                  }}
                  onMouseEnter={(e) => {
                    if (selectedTypeId !== id)
                      e.currentTarget.style.background =
                        "rgba(255,255,255,0.06)";
                  }}
                  onMouseLeave={(e) => {
                    if (selectedTypeId !== id)
                      e.currentTarget.style.background =
                        "rgba(255,255,255,0.03)";
                  }}
                >
                  {selectedTypeId === id && (
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: "0.15vw",
                        background: t.accent,
                      }}
                    />
                  )}
                  <span
                    style={{
                      fontSize: "0.9vw",
                      color:
                        selectedTypeId === id
                          ? t.color
                          : "rgba(255,255,255,0.3)",
                    }}
                  >
                    {t.icon}
                  </span>
                  <span
                    style={{
                      fontSize: "0.6vw",
                      color:
                        selectedTypeId === id
                          ? t.color
                          : "rgba(255,255,255,0.35)",
                    }}
                  >
                    {t.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "0.6vw",
              background: "rgba(0,0,0,0.2)",
              borderRadius: "0.45vw",
              border: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            <div
              style={{
                background: getType(selectedTypeId).bg,
                border: `1px solid ${getType(selectedTypeId).border}`,
                borderRadius: "0.35vw",
                padding: "0.45vw 1vw",
                color: getType(selectedTypeId).color,
                fontSize: "0.78vw",
                fontWeight: 600,
                boxShadow: `0 0 12px ${getType(selectedTypeId).shadow}`,
                display: "flex",
                alignItems: "center",
                gap: "0.3vw",
              }}
            >
              <span style={{ fontSize: "0.78vw" }}>
                {getType(selectedTypeId).icon}
              </span>
              {name || "название"}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5vw" }}>
            <button
              onClick={onClose}
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "0.5vw",
                color: "rgba(255,255,255,0.5)",
                fontSize: "0.78vw",
                padding: "0.55vw 0",
                cursor: "pointer",
                fontFamily: "monospace",
              }}
            >
              Отмена
            </button>
            <button
              onClick={handleAdd}
              style={{
                flex: 2,
                background: "linear-gradient(135deg, #3b82f6, #2563eb)",
                border: "none",
                borderRadius: "0.5vw",
                color: "white",
                fontSize: "0.78vw",
                fontWeight: 600,
                padding: "0.55vw 0",
                cursor: "pointer",
                boxShadow: "0 0 16px rgba(59,130,246,0.35)",
                fontFamily: "monospace",
              }}
            >
              Добавить →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Draggable Node ───────────────────────────────────────────────────────────
function DraggableNode({
  node,
  onDragStart,
  isDragging,
  onContextMenu,
}: {
  node: YamlNode;
  onDragStart: (e: React.MouseEvent, id: string) => void;
  isDragging: boolean;
  onContextMenu: (e: React.MouseEvent, node: YamlNode) => void;
}) {
  const t = getType(node.typeId);
  return (
    <div
      onMouseDown={(e) => {
        if (e.button === 0) onDragStart(e, node.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, node);
      }}
      style={{
        position: "absolute",
        left: `${node.x}%`,
        top: `${node.y}%`,
        cursor: isDragging ? "grabbing" : "grab",
        userSelect: "none",
        zIndex: isDragging ? 100 : 1,
      }}
    >
      <div
        style={{
          background: t.bg,
          border: `1px solid ${t.border}`,
          borderRadius: "0.4vw",
          padding: "0.7vw 1.2vw",
          color: t.color,
          fontSize: "0.82vw",
          fontWeight: 600,
          boxShadow: isDragging
            ? `0 0 24px ${t.shadow}, 0 8px 24px rgba(0,0,0,0.4)`
            : `0 0 12px ${t.shadow}`,
          whiteSpace: "nowrap",
          display: "flex",
          alignItems: "center",
          outline: isDragging
            ? `1.5px solid ${t.border.replace("0.6)", "0.9)")}`
            : "none",
          transform: isDragging ? "scale(1.05)" : "scale(1)",
          transition: isDragging ? "transform 0.05s" : "transform 0.12s",
        }}
      >
        <span
          style={{ fontSize: "0.85vw", marginRight: "0.35vw", opacity: 0.8 }}
        >
          {t.icon}
        </span>
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.05vw" }}
        >
          <span>{node.label}</span>
          {node.kind && (
            <span style={{ fontSize: "0.6vw", opacity: 0.45, fontWeight: 400 }}>
              {node.kind}
              {node.replicas ? ` ×${node.replicas}` : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState<"selector" | "dashboard">("selector");
  const [project, setProject] = useState<ScanResult | null>(null);
  const [nodes, setNodes] = useState<YamlNode[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    nodeId: null,
    label: "",
    kind: "",
    namespace: "",
  });
  const [showAddModal, setShowAddModal] = useState(false);
  const [yamlModal, setYamlModal] = useState<YamlNode | null>(null);
  const [scanToast, setScanToast] = useState<ScanResult | null>(null);
  const dragState = useRef<{
    id: string;
    offsetXpct: number;
    offsetYpct: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleProjectLoaded = useCallback((result: ScanResult) => {
    setNodes(autoLayout(result.nodes));
    setProject(result);
    setScanToast(result);
    setScreen("dashboard");
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nodeRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragState.current = {
      id,
      offsetXpct: ((e.clientX - nodeRect.left) / rect.width) * 100,
      offsetYpct: ((e.clientY - nodeRect.top) / rect.height) * 100,
    };
    setDraggingId(id);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const { id, offsetXpct, offsetYpct } = dragState.current;
    const newX = Math.max(
      0,
      Math.min(((e.clientX - rect.left) / rect.width) * 100 - offsetXpct, 88),
    );
    const newY = Math.max(
      0,
      Math.min(((e.clientY - rect.top) / rect.height) * 100 - offsetYpct, 90),
    );
    setNodes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, x: newX, y: newY } : n)),
    );
  }, []);

  const handleMouseUp = useCallback(() => {
    dragState.current = null;
    setDraggingId(null);
  }, []);
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: YamlNode) => {
      e.preventDefault();
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        nodeId: node.id,
        label: node.label,
        kind: node.kind || "",
        namespace: node.namespace || "",
      });
    },
    [],
  );
  const handleDelete = useCallback(
    (id: string) => setNodes((prev) => prev.filter((n) => n.id !== id)),
    [],
  );
  const handleRename = useCallback(
    (id: string, label: string) =>
      setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, label } : n))),
    [],
  );
  const handleOpenFile = useCallback(
    (id: string) => {
      const node = nodes.find((n) => n.id === id);
      if (node?.filePath || node?.file_path)
        setYamlModal({ ...node, filePath: node.filePath || node.file_path });
    },
    [nodes],
  );
  const handleAddNode = useCallback(
    ({ name, typeId }: { name: string; typeId: string }) => {
      const newNode: YamlNode = {
        id: `manual-${Date.now()}`,
        label: name,
        kind: "",
        image: "",
        type_id: typeId,
        typeId,
        namespace: "default",
        file_path: "",
        filePath: "",
        replicas: null,
        x: 35 + Math.random() * 20,
        y: 35 + Math.random() * 20,
      };
      setNodes((prev) => [...prev, newNode]);
    },
    [],
  );

  if (screen === "selector")
    return (
      <>
        <ProjectSelector onProjectLoaded={handleProjectLoaded} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes ctxIn{from{opacity:0;transform:scale(0.88)}to{opacity:1;transform:scale(1)}}*{box-sizing:border-box}`}</style>
      </>
    );

  const projectName = project?.project_path?.split("/").pop() || "Project";

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        background: "#0a1628",
        display: "flex",
        flexDirection: "column",
        gap: "0.5vw",
        padding: "0.8vw",
        fontFamily: "monospace",
        boxSizing: "border-box",
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* HEADER */}
      <div
        style={{
          position: "relative",
          borderRadius: "0.5vw",
          padding: "0.5vw 1vw",
          border: "1px solid rgba(255,255,255,0.1)",
          background: "linear-gradient(to bottom, #1b263b, #0f172a)",
          boxShadow: "0 0 40px rgba(0,0,0,0.8)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "0.5vw",
            background:
              "radial-gradient(circle at top, rgba(59,130,246,0.1), transparent 60%)",
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1vw",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.6vw",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: "2.2vw",
                height: "2.2vw",
                borderRadius: "0.4vw",
                background: "linear-gradient(135deg, #60a5fa, #2563eb)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 12px rgba(59,130,246,0.6)",
              }}
            >
              <svg
                style={{ width: "55%", height: "55%" }}
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
                  opacity="0.9"
                />
                <rect
                  x="13"
                  y="3"
                  width="8"
                  height="8"
                  rx="1.5"
                  fill="white"
                  opacity="0.6"
                />
                <rect
                  x="3"
                  y="13"
                  width="8"
                  height="8"
                  rx="1.5"
                  fill="white"
                  opacity="0.6"
                />
                <rect
                  x="13"
                  y="13"
                  width="8"
                  height="8"
                  rx="1.5"
                  fill="white"
                  opacity="0.3"
                />
              </svg>
            </div>
            <span
              style={{
                fontWeight: "bold",
                fontSize: "1.4vw",
                color: "white",
                letterSpacing: "0.05em",
              }}
            >
              Endfield
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4vw",
              fontSize: "0.85vw",
            }}
          >
            <span
              onClick={() => setScreen("selector")}
              style={{
                color: "#94a3b8",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) =>
                ((e.target as HTMLElement).style.color = "#e2e8f0")
              }
              onMouseLeave={(e) =>
                ((e.target as HTMLElement).style.color = "#94a3b8")
              }
            >
              ‹ Проекты
            </span>
            <span style={{ color: "#475569", padding: "0 0.2vw" }}>/</span>
            <span
              style={{
                color: "#cbd5e1",
                padding: "0.2vw 0.6vw",
                borderRadius: "0.3vw",
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.05)",
                whiteSpace: "nowrap",
              }}
            >
              {projectName}
            </span>
            <span
              style={{
                color: "#60a5fa",
                padding: "0.2vw 0.6vw",
                borderRadius: "0.3vw",
                border: "1px solid rgba(59,130,246,0.4)",
                background: "rgba(59,130,246,0.1)",
                whiteSpace: "nowrap",
              }}
            >
              ⚙ Monitoring
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.6vw",
              color: "#64748b",
              flexShrink: 0,
            }}
          >
            <span
              style={{ fontSize: "0.72vw", color: "rgba(255,255,255,0.2)" }}
            >
              {nodes.length} fields
            </span>
            <button
              onClick={() => setScreen("selector")}
              style={{
                background: "none",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                fontSize: "1vw",
              }}
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {/* MAIN GRID */}
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "3fr 1fr",
          gridTemplateRows: "1fr 2fr",
          gap: "0.5vw",
          minHeight: 0,
        }}
      >
        {/* SCHEME */}
        <div
          style={{
            gridColumn: "1",
            gridRow: "1 / 3",
            borderRadius: "0.5vw",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "#0d1b2e",
            overflow: "hidden",
            position: "relative",
            boxShadow: "inset 0 0 60px rgba(0,0,0,0.4)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "linear-gradient(rgba(59,130,246,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.06) 1px, transparent 1px)",
              backgroundSize: "3% 3%",
            }}
          />
          <div
            style={{
              position: "relative",
              zIndex: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.8vw 1.5vw",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                color: "white",
                fontWeight: 600,
                fontSize: "0.95vw",
                letterSpacing: "0.05em",
              }}
            >
              Microservice Dashboard
            </span>
            <div style={{ display: "flex", gap: "0.8vw", color: "#64748b" }}>
              <button
                style={{
                  background: "none",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  fontSize: "0.9vw",
                }}
              >
                ⚙
              </button>
              <button
                style={{
                  background: "none",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  fontSize: "0.9vw",
                }}
              >
                ⋯
              </button>
            </div>
          </div>
          <div
            ref={containerRef}
            style={{ flex: 1, position: "relative", overflow: "hidden" }}
          >
            {nodes.map((node) => (
              <DraggableNode
                key={node.id}
                node={node}
                onDragStart={handleDragStart}
                isDragging={draggingId === node.id}
                onContextMenu={handleContextMenu}
              />
            ))}
            <div
              style={{
                position: "absolute",
                bottom: "3%",
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 2,
              }}
            >
              <div
                onClick={() => setShowAddModal(true)}
                style={{
                  border: "1px dashed rgba(96,165,250,0.35)",
                  borderRadius: "0.4vw",
                  padding: "0.5vw 1.5vw",
                  color: "#64748b",
                  fontSize: "0.75vw",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  background: "rgba(0,0,0,0.2)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4vw",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(96,165,250,0.7)";
                  e.currentTarget.style.color = "#93c5fd";
                  e.currentTarget.style.background = "rgba(59,130,246,0.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(96,165,250,0.35)";
                  e.currentTarget.style.color = "#64748b";
                  e.currentTarget.style.background = "rgba(0,0,0,0.2)";
                }}
              >
                <span style={{ fontSize: "0.9vw" }}>⊕</span> New Field +
              </div>
            </div>
          </div>
        </div>

        {/* FIELD CONFIGURATION */}
        <div
          style={{
            gridColumn: "2",
            gridRow: "1",
            borderRadius: "0.5vw",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "#0d1b2e",
            padding: "1.2vw 1.4vw",
            boxShadow: "inset 0 0 30px rgba(0,0,0,0.3)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "1vw",
            }}
          >
            <span
              style={{
                color: "white",
                fontWeight: 600,
                fontSize: "1vw",
                letterSpacing: "0.05em",
              }}
            >
              Field Configuration
            </span>
            <button
              style={{
                background: "none",
                border: "none",
                color: "#64748b",
                cursor: "pointer",
                fontSize: "0.9vw",
              }}
            >
              ∨
            </button>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.9vw",
              flex: 1,
              justifyContent: "center",
            }}
          >
            {[
              { label: "Replicas", value: 75 },
              { label: "CPU", value: 45 },
              { label: "Memory", value: 30 },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{ display: "flex", alignItems: "center", gap: "0.6vw" }}
              >
                <span
                  style={{
                    color: "#cbd5e1",
                    fontSize: "0.85vw",
                    width: "35%",
                    flexShrink: 0,
                  }}
                >
                  {label}:
                </span>
                <div
                  style={{
                    flex: 1,
                    position: "relative",
                    height: "0.35vw",
                    background: "rgba(51,65,85,0.6)",
                    borderRadius: 999,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      height: "100%",
                      width: `${value}%`,
                      borderRadius: 999,
                      background: "linear-gradient(to right, #60a5fa, #3b82f6)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: `${value}%`,
                      transform: "translate(-50%,-50%)",
                      width: "1vw",
                      height: "1vw",
                      borderRadius: "50%",
                      background: "white",
                      border: "2px solid #60a5fa",
                      boxShadow: "0 0 8px rgba(59,130,246,0.8)",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <button
            style={{
              marginTop: "1vw",
              width: "100%",
              background: "#1e3a5f",
              border: "1px solid rgba(59,130,246,0.4)",
              borderRadius: "0.4vw",
              color: "#bfdbfe",
              fontSize: "0.85vw",
              padding: "0.7vw 0",
              cursor: "pointer",
              boxShadow: "0 0 12px rgba(59,130,246,0.15)",
            }}
          >
            Save Changes
          </button>
        </div>

        {/* AI ASSISTANT */}
        <div
          style={{
            gridColumn: "2",
            gridRow: "2",
            borderRadius: "0.5vw",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "#0d1b2e",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "inset 0 0 30px rgba(0,0,0,0.3)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.8vw 1.2vw",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                color: "white",
                fontWeight: 600,
                fontSize: "1vw",
                letterSpacing: "0.05em",
              }}
            >
              AI Assistant
            </span>
            <div style={{ display: "flex", gap: "0.3vw" }}>
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: "0.4vw",
                    height: "0.4vw",
                    borderRadius: "50%",
                    background: "#475569",
                  }}
                />
              ))}
            </div>
          </div>
          <div
            style={{
              flex: 1,
              padding: "0.8vw 1vw",
              display: "flex",
              flexDirection: "column",
              gap: "0.7vw",
              overflowY: "auto",
              minHeight: 0,
            }}
          >
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div
                style={{
                  background: "rgba(37,99,235,0.2)",
                  border: "1px solid rgba(59,130,246,0.3)",
                  borderRadius: "0.5vw",
                  borderTopRightRadius: "0.1vw",
                  padding: "0.5vw 0.8vw",
                  color: "#bfdbfe",
                  fontSize: "0.8vw",
                  maxWidth: "85%",
                }}
              >
                Increase replicas for 'Payment Service'
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: "0.5vw",
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  width: "1.6vw",
                  height: "1.6vw",
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #475569, #1e293b)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  fontSize: "0.7vw",
                  color: "#94a3b8",
                }}
              >
                ✦
              </div>
              <div
                style={{
                  background: "rgba(30,41,59,0.6)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: "0.5vw",
                  borderTopLeftRadius: "0.1vw",
                  padding: "0.5vw 0.8vw",
                  color: "#e2e8f0",
                  fontSize: "0.8vw",
                  maxWidth: "85%",
                }}
              >
                Got it! Increasing replicas for "Payment Service" to 5...
              </div>
            </div>
          </div>
          <div
            style={{
              padding: "0.7vw 1vw",
              borderTop: "1px solid rgba(255,255,255,0.05)",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", gap: "0.5vw" }}>
              <input
                style={{
                  flex: 1,
                  background: "rgba(30,41,59,0.6)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "0.4vw",
                  padding: "0.5vw 0.7vw",
                  color: "#e2e8f0",
                  fontSize: "0.8vw",
                  outline: "none",
                  minWidth: 0,
                  fontFamily: "monospace",
                }}
                placeholder="Ask me anything..."
              />
              <button
                style={{
                  background: "#2563eb",
                  border: "none",
                  borderRadius: "0.4vw",
                  color: "white",
                  fontSize: "0.8vw",
                  padding: "0 1vw",
                  cursor: "pointer",
                  boxShadow: "0 0 12px rgba(59,130,246,0.3)",
                  flexShrink: 0,
                  fontWeight: 600,
                  fontFamily: "monospace",
                }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>

      <ContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu((m) => ({ ...m, visible: false }))}
        onDelete={handleDelete}
        onRename={handleRename}
        onOpenFile={handleOpenFile}
      />
      {showAddModal && (
        <AddNodeModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddNode}
        />
      )}
      {yamlModal && (
        <YamlModal node={yamlModal} onClose={() => setYamlModal(null)} />
      )}
      {scanToast && (
        <ScanToast result={scanToast} onDismiss={() => setScanToast(null)} />
      )}

      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes ctxIn   { from { opacity:0; transform:scale(0.88); } to { opacity:1; transform:scale(1); } }
        @keyframes modalIn { from { opacity:0; transform:scale(0.9) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}
