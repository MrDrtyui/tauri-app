import React, { useState, useEffect } from "react";
import { useIDEStore } from "../store/ideStore";
import {
  YamlNode,
  saveYamlFile,
  kubectlApply,
  helmTemplate,
  scanProjectFiles,
} from "../store/tauriStore";
import { genId } from "../layout/utils";
import { ContextMenu, ContextMenuState } from "../components/ContextMenu";
import { DeleteConfirmDialog } from "../components/DeleteConfirmDialog";
import { EditFieldModal } from "../components/EditFieldModal";
import { executeCommand } from "../commands/commands";
import {
  ExplorerIcon,
  resolveNodeIcon,
  resolveNodeColor,
} from "./Explorericons";

// ─── File tree helpers ─────────────────────────────────────────────

interface FileTreeNode {
  id: string;
  name: string;
  isDir: boolean;
  path: string;
  isHelm: boolean;
  children: FileTreeNode[];
}

function buildTreeFromPaths(
  filePaths: string[],
  projectPath: string,
): FileTreeNode[] {
  const map = new Map<string, FileTreeNode>();

  function ensure(
    fullPath: string,
    name: string,
    isDir: boolean,
  ): FileTreeNode {
    if (!map.has(fullPath)) {
      const isHelm =
        name === "Chart.yaml" ||
        name.endsWith("values.yaml") ||
        name.endsWith("values.prod.yaml");
      map.set(fullPath, {
        id: fullPath,
        name,
        isDir,
        path: fullPath,
        isHelm,
        children: [],
      });
    }
    return map.get(fullPath)!;
  }

  // Ensure root exists
  ensure(projectPath, projectPath.split("/").pop() ?? projectPath, true);

  for (const filePath of filePaths) {
    const rel = filePath.startsWith(projectPath)
      ? filePath.slice(projectPath.length).replace(/^\//, "")
      : filePath;
    const parts = rel.split("/").filter(Boolean);
    let cur = projectPath;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const next = cur + "/" + part;
      const isLast = i === parts.length - 1;
      const child = ensure(next, part, !isLast);
      const parent = map.get(cur);
      if (parent && !parent.children.find((c) => c.id === next)) {
        parent.children.push(child);
      }
      cur = next;
    }
  }

  const root = map.get(projectPath);
  return root ? root.children : [];
}

// Legacy: build tree from nodes (fallback if scan_project_files not available)
function buildTree(nodes: YamlNode[], projectPath: string): FileTreeNode[] {
  return buildTreeFromPaths(
    nodes.map((n) => n.file_path).filter(Boolean),
    projectPath,
  );
}

// ─── Presets ───────────────────────────────────────────────────────

interface RawPreset {
  typeId: string;
  image: string;
  port: number;
  kind: "Deployment" | "StatefulSet";
  replicas: number;
  desc: string;
  folder: string;
  storage?: string;
  env: Array<{ k: string; v: string }>;
  svc: boolean;
}

const RAW_PRESETS: Record<string, RawPreset> = {
  service: {
    typeId: "service",
    image: "",
    port: 8080,
    kind: "Deployment",
    replicas: 2,
    desc: "Generic service",
    folder: "apps",
    env: [],
    svc: true,
  },
  postgres: {
    typeId: "database",
    image: "postgres:16-alpine",
    port: 5432,
    kind: "StatefulSet",
    replicas: 1,
    desc: "PostgreSQL",
    folder: "databases",
    env: [
      { k: "POSTGRES_DB", v: "appdb" },
      { k: "POSTGRES_PASSWORD", v: "changeme" },
    ],
    svc: true,
    storage: "10Gi",
  },
  mongodb: {
    typeId: "database",
    image: "mongo:7",
    port: 27017,
    kind: "StatefulSet",
    replicas: 1,
    desc: "MongoDB",
    folder: "databases",
    env: [{ k: "MONGO_INITDB_ROOT_PASSWORD", v: "changeme" }],
    svc: true,
    storage: "10Gi",
  },
  redis: {
    typeId: "cache",
    image: "redis:7-alpine",
    port: 6379,
    kind: "StatefulSet",
    replicas: 1,
    desc: "Redis cache",
    folder: "cache",
    env: [],
    svc: true,
    storage: "2Gi",
  },
  kafka: {
    typeId: "queue",
    image: "confluentinc/cp-kafka:7.6.0",
    port: 9092,
    kind: "StatefulSet",
    replicas: 3,
    desc: "Apache Kafka",
    folder: "messaging",
    env: [{ k: "KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR", v: "3" }],
    svc: true,
    storage: "20Gi",
  },
  nginx: {
    typeId: "gateway",
    image: "nginx:1.25-alpine",
    port: 80,
    kind: "Deployment",
    replicas: 2,
    desc: "Nginx proxy",
    folder: "apps",
    env: [],
    svc: true,
  },
  grafana: {
    typeId: "monitoring",
    image: "grafana/grafana:latest",
    port: 3000,
    kind: "Deployment",
    replicas: 1,
    desc: "Grafana dashboard",
    folder: "monitoring",
    env: [],
    svc: true,
  },
};

interface HelmPreset {
  typeId: string;
  desc: string;
  chart: string;
  repo: string;
  version: string;
  ns: string;
  values: string;
}

const HELM_PRESETS: Record<string, HelmPreset> = {
  "ingress-nginx": {
    typeId: "gateway",
    desc: "Nginx Ingress Controller",
    chart: "ingress-nginx",
    repo: "https://kubernetes.github.io/ingress-nginx",
    version: "4.10.1",
    ns: "infra-ingress-nginx",
    values:
      "controller:\n  replicaCount: 2\n  service:\n    type: LoadBalancer\n",
  },
  "cert-manager": {
    typeId: "infra",
    desc: "TLS certificate manager",
    chart: "cert-manager",
    repo: "https://charts.jetstack.io",
    version: "v1.14.4",
    ns: "cert-manager",
    values: "installCRDs: true\n",
  },
  "kube-prometheus-stack": {
    typeId: "monitoring",
    desc: "Prometheus + Grafana",
    chart: "kube-prometheus-stack",
    repo: "https://prometheus-community.github.io/helm-charts",
    version: "58.0.0",
    ns: "infra-monitoring",
    values: "grafana:\n  enabled: true\nprometheus:\n  enabled: true\n",
  },
};

function buildRawYaml(
  name: string,
  p: RawPreset,
  port: number,
  ns: string,
): Record<string, string> {
  const n = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const files: Record<string, string> = {};
  const envYaml = p.env.length
    ? "        env:\n" +
      p.env
        .map((e) => `          - name: ${e.k}\n            value: "${e.v}"`)
        .join("\n") +
      "\n"
    : "";
  const volMount = p.storage
    ? `        volumeMounts:\n          - name: data\n            mountPath: /data\n      volumes:\n        - name: data\n          persistentVolumeClaim:\n            claimName: ${n}-pvc\n`
    : "";
  files[`${p.folder}/${n}-${p.kind.toLowerCase()}.yaml`] =
    `apiVersion: apps/v1\nkind: ${p.kind}\nmetadata:\n  name: ${n}\n  namespace: ${ns}\n  labels:\n    app: ${n}\n    managed-by: endfield\nspec:\n  replicas: ${p.replicas}\n  selector:\n    matchLabels:\n      app: ${n}\n  template:\n    metadata:\n      labels:\n        app: ${n}\n    spec:\n      containers:\n        - name: ${n}\n          image: ${p.image || n + ":latest"}\n          ports:\n            - containerPort: ${port}\n${envYaml}${volMount}`;
  if (p.svc) {
    files[`${p.folder}/${n}-service.yaml`] =
      `apiVersion: v1\nkind: Service\nmetadata:\n  name: ${n}\n  namespace: ${ns}\nspec:\n  selector:\n    app: ${n}\n  ports:\n    - port: ${port}\n      targetPort: ${port}\n`;
  }
  if (p.storage) {
    files[`${p.folder}/${n}-pvc.yaml`] =
      `apiVersion: v1\nkind: PersistentVolumeClaim\nmetadata:\n  name: ${n}-pvc\n  namespace: ${ns}\nspec:\n  accessModes: [ReadWriteOnce]\n  resources:\n    requests:\n      storage: ${p.storage}\n`;
  }
  return files;
}

function buildHelmFiles(name: string, p: HelmPreset): Record<string, string> {
  return {
    [`infra/${name}/helm/Chart.yaml`]: `apiVersion: v2\nname: ${name}\ndescription: Endfield wrapper for ${p.chart}\ntype: application\nversion: 0.1.0\ndependencies:\n  - name: ${p.chart}\n    version: "${p.version}"\n    repository: "${p.repo}"\n`,
    [`infra/${name}/helm/values.yaml`]: p.values,
    [`infra/${name}/namespace.yaml`]: `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${p.ns}\n`,
  };
}

// ─── Shared styles ────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-sm)",
  padding: "6px 10px",
  color: "var(--text-primary)",
  fontSize: "var(--font-size-sm)",
  fontFamily: "var(--font-mono)",
  outline: "none",
  width: "100%",
  transition: "var(--ease-fast)",
};

const fieldLabelStyle: React.CSSProperties = {
  color: "var(--text-faint)",
  fontSize: 10,
  marginBottom: 5,
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.07em",
  textTransform: "uppercase",
};

// ─── AddFieldModal ────────────────────────────────────────────────

function AddFieldModal({
  projectPath,
  onAdd,
  onClose,
}: {
  projectPath: string;
  onAdd: (n: YamlNode) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"raw" | "helm">("raw");
  const [rawKey, setRawKey] = useState("service");
  const [helmKey, setHelmKey] = useState("ingress-nginx");
  const [name, setName] = useState("");
  const [ns, setNs] = useState("default");
  const [port, setPort] = useState(8080);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const rawPreset = RAW_PRESETS[rawKey];
  const helmPreset = HELM_PRESETS[helmKey];

  const handleCreate = async () => {
    if (!name.trim()) {
      setMsg("Name is required");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const n = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      if (mode === "raw") {
        const files = buildRawYaml(n, rawPreset, port, ns);
        for (const [rel, content] of Object.entries(files)) {
          await saveYamlFile(`${projectPath}/${rel}`, content);
          await kubectlApply(`${projectPath}/${rel}`).catch(() => {});
        }
        const mainFile = Object.keys(files)[0];
        onAdd({
          id: genId("node"),
          label: n,
          kind: rawPreset.kind,
          image: rawPreset.image || n + ":latest",
          type_id: rawPreset.typeId,
          namespace: ns,
          file_path: `${projectPath}/${mainFile}`,
          replicas: rawPreset.replicas,
          source: "raw",
          x: 10 + Math.random() * 60,
          y: 10 + Math.random() * 60,
        });
      } else {
        const files = buildHelmFiles(n, helmPreset);
        for (const [rel, content] of Object.entries(files)) {
          await saveYamlFile(`${projectPath}/${rel}`, content);
        }
        const dir = `${projectPath}/infra/${n}`;
        await helmTemplate(dir, n, helmPreset.ns).catch(() => {});
        onAdd({
          id: genId("node"),
          label: n,
          kind: "HelmRelease",
          image: `helm:${helmPreset.chart}/${helmPreset.version}`,
          type_id: helmPreset.typeId,
          namespace: helmPreset.ns,
          file_path: `${dir}/helm/Chart.yaml`,
          replicas: null,
          source: "helm",
          x: 10 + Math.random() * 60,
          y: 10 + Math.random() * 60,
        });
      }
      setMsg("Created successfully");
    } catch (e: unknown) {
      setMsg("Error: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

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
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "var(--bg-modal)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-2xl)",
          width: 440,
          overflow: "hidden",
          boxShadow: "var(--shadow-modal)",
          animation: "ef-fadein 0.15s ease-out",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px 12px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              color: "var(--text-primary)",
              fontWeight: 500,
              fontSize: "var(--font-size-lg)",
            }}
          >
            Add Field
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-faint)",
              cursor: "pointer",
              padding: 4,
              borderRadius: "var(--radius-xs)",
              transition: "var(--ease-fast)",
              display: "flex",
              alignItems: "center",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.color =
                "var(--text-secondary)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.color =
                "var(--text-faint)")
            }
          >
            <ExplorerIcon name="chevronRight" size={14} />
          </button>
        </div>

        {/* Mode tabs */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid var(--border-subtle)",
            padding: "0 18px",
          }}
        >
          {(["raw", "helm"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                padding: "9px 0",
                background: "none",
                border: "none",
                borderBottom: `2px solid ${mode === m ? "var(--accent)" : "transparent"}`,
                color: mode === m ? "var(--accent)" : "var(--text-muted)",
                fontSize: "var(--font-size-xs)",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                transition: "var(--ease-fast)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <ExplorerIcon
                name={m === "helm" ? "helmRelease" : "fileYaml"}
                size={12}
              />
              {m === "helm" ? "Helm Chart" : "Raw YAML"}
            </button>
          ))}
        </div>

        <div
          style={{
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div>
            <div style={fieldLabelStyle}>Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === "raw" ? "my-service" : "my-release"}
              style={inputStyle}
            />
          </div>

          {mode === "raw" ? (
            <>
              <div>
                <div style={fieldLabelStyle}>Preset</div>
                <select
                  value={rawKey}
                  onChange={(e) => {
                    setRawKey(e.target.value);
                    setPort(RAW_PRESETS[e.target.value].port);
                  }}
                  style={{ ...inputStyle, cursor: "pointer" }}
                >
                  {Object.entries(RAW_PRESETS).map(([k, p]) => (
                    <option key={k} value={k}>
                      {k} — {p.desc}
                    </option>
                  ))}
                </select>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <div>
                  <div style={fieldLabelStyle}>Namespace</div>
                  <input
                    value={ns}
                    onChange={(e) => setNs(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div style={fieldLabelStyle}>Port</div>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    style={inputStyle}
                  />
                </div>
              </div>
              <div
                style={{
                  color: "var(--text-faint)",
                  fontSize: "var(--font-size-xs)",
                  fontFamily: "var(--font-mono)",
                  lineHeight: 1.7,
                }}
              >
                {rawPreset.image && (
                  <>
                    {rawPreset.image}
                    <br />
                  </>
                )}
                folder: {rawPreset.folder}/
                {rawPreset.storage && <> · storage: {rawPreset.storage}</>}
              </div>
            </>
          ) : (
            <>
              <div>
                <div style={fieldLabelStyle}>Chart</div>
                <select
                  value={helmKey}
                  onChange={(e) => setHelmKey(e.target.value)}
                  style={{ ...inputStyle, cursor: "pointer" }}
                >
                  {Object.entries(HELM_PRESETS).map(([k, p]) => (
                    <option key={k} value={k}>
                      {k} — {p.desc}
                    </option>
                  ))}
                </select>
              </div>
              <div
                style={{
                  color: "var(--text-faint)",
                  fontSize: "var(--font-size-xs)",
                  fontFamily: "var(--font-mono)",
                  lineHeight: 1.7,
                }}
              >
                {helmPreset.chart} {helmPreset.version}
                <br />
                ns: {helmPreset.ns}
              </div>
            </>
          )}

          {msg && (
            <div
              style={{
                color: msg.startsWith("Error")
                  ? "var(--status-error)"
                  : "var(--status-ok)",
                fontSize: "var(--font-size-sm)",
                fontFamily: "var(--font-mono)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {msg}
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={busy}
            style={{
              padding: "8px 16px",
              background: "rgba(180,190,254,0.10)",
              border: "1px solid var(--border-accent)",
              borderRadius: "var(--radius-md)",
              color: "var(--accent-alt)",
              fontSize: "var(--font-size-sm)",
              fontFamily: "var(--font-ui)",
              fontWeight: 500,
              cursor: busy ? "wait" : "pointer",
              marginTop: 4,
              transition: "var(--ease-fast)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
            onMouseEnter={(e) => {
              if (!busy)
                (e.currentTarget as HTMLElement).style.background =
                  "rgba(180,190,254,0.18)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                "rgba(180,190,254,0.10)";
            }}
          >
            <ExplorerIcon name="add" size={13} strokeWidth={2.5} />
            {busy ? "Creating…" : "Create Field"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SectionHeader ────────────────────────────────────────────────

function SectionHeader({
  label,
  count,
  expanded,
  onToggle,
}: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "6px 14px 4px",
        cursor: "pointer",
        userSelect: "none",
        background: hov ? "var(--bg-sidebar-hover)" : "transparent",
        transition: "background 0.1s",
      }}
    >
      <span
        style={{
          color: "var(--text-faint)",
          display: "flex",
          alignItems: "center",
          transition: "transform 0.15s",
          transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
        }}
      >
        <ExplorerIcon name="chevronDown" size={11} strokeWidth={2} />
      </span>
      <span
        style={{
          fontSize: 10,
          color: "var(--text-faint)",
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          fontWeight: 600,
          fontFamily: "var(--font-ui)",
          flex: 1,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 10,
          color: "var(--text-faint)",
          fontFamily: "var(--font-mono)",
          background: "var(--bg-elevated)",
          padding: "1px 5px",
          borderRadius: 99,
          lineHeight: 1.6,
        }}
      >
        {count}
      </span>
    </div>
  );
}

// ─── FileTreeView ─────────────────────────────────────────────────

function FileTreeView({
  nodes,
  depth,
  expanded,
  onToggle,
  selectedId,
  onFileClick,
}: {
  nodes: FileTreeNode[];
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  selectedId: string | null;
  onFileClick: (n: FileTreeNode) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const isOpen = expanded.has(node.id);
        const isSel = selectedId === node.id;
        const iconName = node.isDir
          ? isOpen
            ? "folderOpen"
            : "folder"
          : node.isHelm
            ? "fileHelm"
            : "fileYaml";

        return (
          <React.Fragment key={node.id}>
            <div
              onClick={() =>
                node.isDir ? onToggle(node.id) : onFileClick(node)
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: `4px 10px 4px ${14 + depth * 14}px`,
                cursor: "pointer",
                background: isSel ? "var(--bg-sidebar-active)" : "transparent",
                borderRadius: 6,
                margin: "1px 6px",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => {
                if (!isSel)
                  (e.currentTarget as HTMLElement).style.background =
                    "var(--bg-sidebar-hover)";
              }}
              onMouseLeave={(e) => {
                if (!isSel)
                  (e.currentTarget as HTMLElement).style.background =
                    "transparent";
              }}
            >
              <span
                style={{
                  width: 10,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  color: "var(--text-faint)",
                  transition: "transform 0.12s",
                  transform:
                    node.isDir && isOpen ? "rotate(90deg)" : "rotate(0deg)",
                  opacity: node.isDir ? 1 : 0,
                }}
              >
                <ExplorerIcon name="chevronRight" size={10} strokeWidth={2.5} />
              </span>

              <span
                style={{
                  color: isSel
                    ? node.isHelm
                      ? "var(--node-infra)"
                      : "var(--accent)"
                    : node.isDir
                      ? "var(--text-subtle)"
                      : "var(--text-faint)",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <ExplorerIcon name={iconName as any} size={13} />
              </span>

              <span
                style={{
                  fontSize: "var(--font-size-sm)",
                  color: isSel
                    ? "var(--text-primary)"
                    : node.isDir
                      ? "var(--text-secondary)"
                      : "var(--text-muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontWeight: isSel ? 500 : 400,
                }}
              >
                {node.name}
              </span>
            </div>

            {node.isDir && isOpen && (
              <FileTreeView
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                selectedId={selectedId}
                onFileClick={onFileClick}
              />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

// ─── FieldItem ────────────────────────────────────────────────────

function FieldItem({
  node,
  isSel,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onClick,
  onContextMenu,
}: {
  node: YamlNode;
  isSel: boolean;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [hov, setHov] = useState(false);
  const iconName = resolveNodeIcon(node.type_id, node.label, node.source);
  const color = resolveNodeColor(node.type_id);

  return (
    <div
      onClick={() => !isRenaming && onClick()}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 10px 5px 22px",
        cursor: "pointer",
        background: isSel
          ? "var(--bg-sidebar-active)"
          : hov
            ? "var(--bg-sidebar-hover)"
            : "transparent",
        borderRadius: 6,
        margin: "1px 6px",
        transition: "background 0.1s",
      }}
    >
      <span
        style={{
          color: isSel ? color : "var(--text-faint)",
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          transition: "color 0.1s",
        }}
      >
        <ExplorerIcon name={iconName} size={14} strokeWidth={1.75} />
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={onRenameCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onRenameCommit();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                onRenameCancel();
              }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-accent)",
              borderRadius: "var(--radius-xs)",
              color: "var(--text-primary)",
              fontSize: "var(--font-size-sm)",
              fontFamily: "var(--font-mono)",
              width: "100%",
              outline: "none",
              padding: "1px 5px",
            }}
          />
        ) : (
          <div
            style={{
              color: isSel ? "var(--text-primary)" : "var(--text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "var(--font-size-sm)",
              fontWeight: isSel ? 500 : 400,
            }}
          >
            {node.label}
          </div>
        )}
        <div
          style={{
            color: "var(--text-faint)",
            fontSize: 10,
            marginTop: 1,
            fontFamily: "var(--font-mono)",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span>{node.kind}</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{node.namespace}</span>
        </div>
      </div>

      <div
        style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}
      >
        {node.source === "helm" && (
          <span
            style={{
              color: isSel ? "var(--node-infra)" : "var(--text-faint)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <ExplorerIcon name="helmRelease" size={10} strokeWidth={1.5} />
          </span>
        )}
        {node.replicas != null && (
          <span
            style={{
              fontSize: 10,
              color: "var(--text-faint)",
              fontFamily: "var(--font-mono)",
              background: "var(--bg-elevated)",
              padding: "0 4px",
              borderRadius: 4,
              lineHeight: 1.7,
            }}
          >
            ×{node.replicas}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── FieldSection ─────────────────────────────────────────────────

function FieldSection({
  label,
  fields,
  expanded,
  onToggle,
  selectedId,
  onFieldClick,
  onFieldRightClick,
  renamingId,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}: {
  label: string;
  fields: YamlNode[];
  expanded: boolean;
  onToggle: () => void;
  selectedId: string | null;
  onFieldClick: (n: YamlNode) => void;
  onFieldRightClick: (e: React.MouseEvent, n: YamlNode) => void;
  renamingId: string | null;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}) {
  return (
    <>
      <SectionHeader
        label={label}
        count={fields.length}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded &&
        fields.map((node) => (
          <FieldItem
            key={node.id}
            node={node}
            isSel={selectedId === node.id}
            isRenaming={renamingId === node.id}
            renameValue={renameValue}
            onRenameChange={onRenameChange}
            onRenameCommit={onRenameCommit}
            onRenameCancel={onRenameCancel}
            onClick={() => onFieldClick(node)}
            onContextMenu={(e) => onFieldRightClick(e, node)}
          />
        ))}
    </>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────

function EmptyState({ tab }: { tab: "files" | "fields" }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "60%",
        color: "var(--text-faint)",
        gap: 10,
        padding: "0 24px",
        textAlign: "center",
      }}
    >
      <span style={{ opacity: 0.3 }}>
        <ExplorerIcon
          name={tab === "files" ? "folder" : "service"}
          size={28}
          strokeWidth={1.25}
        />
      </span>
      <span style={{ fontSize: 11, opacity: 0.5, lineHeight: 1.5 }}>
        {tab === "files" ? "No project open" : "No fields found"}
      </span>
    </div>
  );
}

// ─── IconBtn ──────────────────────────────────────────────────────

function IconBtn({
  title,
  onClick,
  accent,
  children,
}: {
  title: string;
  onClick: () => void;
  accent?: string;
  children: React.ReactNode;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? "var(--bg-elevated)" : "transparent",
        border: "none",
        borderRadius: 6,
        color: hov ? (accent ?? "var(--text-muted)") : "var(--text-faint)",
        width: 26,
        height: 26,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
        transition: "background 0.1s, color 0.1s",
      }}
    >
      {children}
    </button>
  );
}

// ─── TabBtn ───────────────────────────────────────────────────────

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flex: 1,
        padding: "8px 0",
        background: active
          ? "var(--bg-elevated)"
          : hov
            ? "var(--bg-sidebar-hover)"
            : "transparent",
        border: "none",
        borderBottom: `1.5px solid ${active ? "var(--accent)" : "transparent"}`,
        color: active ? "var(--accent)" : "var(--text-faint)",
        fontSize: 11,
        cursor: "pointer",
        fontFamily: "var(--font-ui)",
        letterSpacing: "0.07em",
        textTransform: "uppercase",
        fontWeight: active ? 600 : 400,
        transition: "background 0.1s, color 0.1s, border-color 0.1s",
      }}
    >
      {children}
    </button>
  );
}

// ─── ExplorerPanel ────────────────────────────────────────────────

export function ExplorerPanel() {
  const [activeTab, setActiveTab] = useState<"files" | "fields">("files");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [expandedSecs, setExpandedSecs] = useState<{
    services: boolean;
    infra: boolean;
    configs?: boolean;
  }>({
    services: true,
    infra: true,
  });
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<YamlNode | null>(null);
  const [editTarget, setEditTarget] = useState<YamlNode | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);

  const nodes = useIDEStore((s) => s.nodes);
  const projectPath = useIDEStore((s) => s.projectPath);
  const addNode = useIDEStore((s) => s.addNode);
  const renameNode = useIDEStore((s) => s.renameNode);
  const openTab = useIDEStore((s) => s.openTab);
  const setSelected = useIDEStore((s) => s.setSelectedEntity);
  const selected = useIDEStore((s) => s.selectedEntity);

  const [projectFiles, setProjectFiles] = useState<string[]>([]);

  // Load all project files for the file tree
  useEffect(() => {
    if (!projectPath) return;
    scanProjectFiles(projectPath)
      .then(setProjectFiles)
      .catch(() => setProjectFiles([]));
  }, [projectPath, nodes]); // re-scan when nodes change (new files added)

  const fileTree = projectPath
    ? buildTreeFromPaths(projectFiles, projectPath)
    : [];

  useEffect(() => {
    if (fileTree.length > 0 && expandedFolders.size === 0) {
      setExpandedFolders(new Set(fileTree.map((n) => n.id)));
    }
  }, [fileTree.length]);

  const toggleFolder = (id: string) =>
    setExpandedFolders((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });

  const handleFileClick = (node: FileTreeNode) => {
    setSelected({
      type: "file",
      id: node.id,
      label: node.name,
      filePath: node.path,
    });
    openTab(
      {
        id: `file-${node.path}`,
        title: node.name,
        contentType: "file",
        filePath: node.path,
        icon: "fileYaml",
      },
      "center",
    );
  };

  const handleFieldClick = (node: YamlNode) => {
    setSelected({
      type: "field",
      id: node.id,
      label: node.label,
      filePath: node.file_path,
      meta: { kind: node.kind, namespace: node.namespace },
    });
    if (node.file_path) {
      openTab(
        {
          id: `file-${node.file_path}`,
          title: node.file_path.split("/").pop() ?? node.label,
          contentType: "file",
          filePath: node.file_path,
          icon: "fileYaml",
        },
        "center",
      );
    }
  };

  const handleFieldRightClick = (e: React.MouseEvent, node: YamlNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ node, x: e.clientX, y: e.clientY });
  };

  const startRename = (node: YamlNode) => {
    setRenamingId(node.id);
    setRenameValue(node.label);
  };
  const commitRename = () => {
    if (renamingId && renameValue.trim())
      renameNode(renamingId, renameValue.trim());
    setRenamingId(null);
  };

  const q = search.toLowerCase();
  const serviceNodes = nodes.filter(
    (n) =>
      !["gateway", "infra", "monitoring"].includes(n.type_id) &&
      (!q || n.label.toLowerCase().includes(q)),
  );
  const infraNodes = nodes.filter(
    (n) =>
      ["gateway", "infra", "monitoring"].includes(n.type_id) &&
      (!q || n.label.toLowerCase().includes(q)),
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg-sidebar)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--font-size-sm)",
        color: "var(--text-secondary)",
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        <TabBtn
          active={activeTab === "files"}
          onClick={() => setActiveTab("files")}
        >
          Files
        </TabBtn>
        <TabBtn
          active={activeTab === "fields"}
          onClick={() => setActiveTab("fields")}
        >
          Fields
        </TabBtn>
      </div>

      {/* Toolbar */}
      <div
        style={{
          padding: "6px 8px",
          flexShrink: 0,
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          gap: 4,
          alignItems: "center",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: searchFocus
              ? "var(--bg-elevated)"
              : "var(--bg-sidebar-hover)",
            border: `1px solid ${searchFocus ? "var(--border-accent)" : "transparent"}`,
            borderRadius: 6,
            padding: "4px 8px",
            transition: "all 0.15s",
          }}
        >
          <span
            style={{
              color: "var(--text-faint)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <ExplorerIcon name="search" size={11} strokeWidth={2} />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setSearchFocus(true)}
            onBlur={() => setSearchFocus(false)}
            placeholder={
              activeTab === "files" ? "Search files…" : "Search fields…"
            }
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: "var(--text-secondary)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
            }}
          />
        </div>

        {activeTab === "fields" && projectPath && (
          <IconBtn
            title="Add Field"
            onClick={() => setShowAdd(true)}
            accent="var(--accent)"
          >
            <ExplorerIcon name="add" size={13} strokeWidth={2.5} />
          </IconBtn>
        )}

        {projectPath && (
          <IconBtn
            title="Deploy Image"
            accent="var(--ctp-teal)"
            onClick={() =>
              openTab(
                {
                  id: "tab-deploy-image",
                  title: "Deploy Image",
                  contentType: "deployImage",
                  icon: "fileYaml",
                },
                "center",
              )
            }
          >
            <ExplorerIcon name="deploy" size={13} strokeWidth={2} />
          </IconBtn>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0 8px" }}>
        {nodes.length === 0 ? (
          <EmptyState tab={activeTab} />
        ) : activeTab === "files" ? (
          fileTree.length === 0 ? (
            <EmptyState tab="files" />
          ) : (
            <FileTreeView
              nodes={fileTree}
              depth={0}
              expanded={expandedFolders}
              onToggle={toggleFolder}
              selectedId={selected?.type === "file" ? selected.id : null}
              onFileClick={handleFileClick}
            />
          )
        ) : (
          <>
            <FieldSection
              label="Services"
              fields={serviceNodes}
              expanded={expandedSecs.services}
              onToggle={() =>
                setExpandedSecs((s) => ({ ...s, services: !s.services }))
              }
              selectedId={selected?.type === "field" ? selected.id : null}
              onFieldClick={handleFieldClick}
              onFieldRightClick={handleFieldRightClick}
              renamingId={renamingId}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRenameCommit={commitRename}
              onRenameCancel={() => setRenamingId(null)}
            />

            {infraNodes.length > 0 && (
              <div
                style={{
                  height: 1,
                  background: "var(--border-subtle)",
                  margin: "6px 14px",
                  opacity: 0.5,
                }}
              />
            )}

            <FieldSection
              label="Infrastructure"
              fields={infraNodes}
              expanded={expandedSecs.infra}
              onToggle={() =>
                setExpandedSecs((s) => ({ ...s, infra: !s.infra }))
              }
              selectedId={selected?.type === "field" ? selected.id : null}
              onFieldClick={handleFieldClick}
              onFieldRightClick={handleFieldRightClick}
              renamingId={renamingId}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRenameCommit={commitRename}
              onRenameCancel={() => setRenamingId(null)}
            />
          </>
        )}
      </div>

      {showAdd && projectPath && (
        <AddFieldModal
          projectPath={projectPath}
          onAdd={(node) => {
            addNode(node);
            setShowAdd(false);
          }}
          onClose={() => setShowAdd(false)}
        />
      )}

      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onRename={(node) => {
            startRename(node);
            setContextMenu(null);
          }}
          onEdit={(node) => {
            setEditTarget(node);
            setContextMenu(null);
          }}
          onDelete={(node) => {
            setDeleteTarget(node);
            setContextMenu(null);
          }}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmDialog
          node={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {editTarget && (
        <EditFieldModal node={editTarget} onClose={() => setEditTarget(null)} />
      )}
    </div>
  );
}
