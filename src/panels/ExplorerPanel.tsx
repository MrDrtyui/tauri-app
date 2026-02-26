/**
 * ExplorerPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Endfield IDE — Kubernetes-aware Infrastructure Explorer
 *
 * Architecture:
 *   - ExplorerPanel           Root container, state orchestration
 *   - useExplorerState        All state in one predictable hook
 *   - ExplorerContextMenu     Role-aware context menu, type-driven actions
 *   - ExplorerRow             Virtualization-ready row (fixed 32px height)
 *   - GroupHeader             Collapsible section header
 *   - StatusBadge             Ready/warn/error indicator
 *   - FileTreeView            File tree tab
 *   - AddFieldModal           Create new field modal
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useReducer,
} from "react";
import { createPortal } from "react-dom";
import { useIDEStore } from "../store/ideStore";
import { listen } from "@tauri-apps/api/event";
import {
  YamlNode,
  FieldStatus,
  saveYamlFile,
  kubectlApply,
  helmTemplate,
  scanProjectFiles,
} from "../store/tauriStore";
import { genId } from "../layout/utils";
import { DeleteConfirmDialog } from "../components/DeleteConfirmDialog";
import { EditFieldModal } from "../components/EditFieldModal";
import { executeCommand } from "../commands/commands";
import {
  ExplorerIcon,
  resolveNodeIcon,
  resolveNodeColor,
  IconName,
} from "./Explorericons";

// ─── Constants ────────────────────────────────────────────────────────────────

const ROW_HEIGHT = 32;
const OVERSCAN = 8;

// ─── Types ────────────────────────────────────────────────────────────────────

type GroupMode = "namespace" | "type" | "flat";
type ExplorerTab = "fields" | "files";

interface ExplorerState {
  tab: ExplorerTab;
  groupMode: GroupMode;
  search: string;
  expandedGroups: Set<string>;
  selectedIds: Set<string>;
  lastClickedId: string | null;
  renamingId: string | null;
  renameValue: string;
  scrollTop: number;
  containerHeight: number;
}

type ExplorerAction =
  | { type: "SET_TAB"; tab: ExplorerTab }
  | { type: "SET_GROUP_MODE"; mode: GroupMode }
  | { type: "SET_SEARCH"; q: string }
  | { type: "TOGGLE_GROUP"; id: string }
  | { type: "EXPAND_ALL" }
  | { type: "COLLAPSE_ALL" }
  | {
      type: "SELECT";
      id: string;
      multi: boolean;
      range: boolean;
      allIds: string[];
    }
  | { type: "CLEAR_SELECTION" }
  | { type: "START_RENAME"; id: string; current: string }
  | { type: "SET_RENAME_VALUE"; v: string }
  | { type: "CANCEL_RENAME" }
  | { type: "COMMIT_RENAME" }
  | { type: "SET_SCROLL"; top: number }
  | { type: "SET_HEIGHT"; h: number };

function explorerReducer(s: ExplorerState, a: ExplorerAction): ExplorerState {
  switch (a.type) {
    case "SET_TAB":
      return { ...s, tab: a.tab, search: "", selectedIds: new Set() };
    case "SET_GROUP_MODE":
      return { ...s, groupMode: a.mode };
    case "SET_SEARCH":
      return { ...s, search: a.q };
    case "TOGGLE_GROUP": {
      const next = new Set(s.expandedGroups);
      next.has(a.id) ? next.delete(a.id) : next.add(a.id);
      return { ...s, expandedGroups: next };
    }
    case "EXPAND_ALL":
      return { ...s, expandedGroups: new Set(["__all__"]) }; // sentinel
    case "COLLAPSE_ALL":
      return { ...s, expandedGroups: new Set() };
    case "SELECT": {
      if (a.range && s.lastClickedId && a.allIds.length) {
        const i1 = a.allIds.indexOf(s.lastClickedId);
        const i2 = a.allIds.indexOf(a.id);
        if (i1 >= 0 && i2 >= 0) {
          const [lo, hi] = i1 < i2 ? [i1, i2] : [i2, i1];
          const slice = new Set(a.allIds.slice(lo, hi + 1));
          const merged = a.multi
            ? new Set([...s.selectedIds, ...slice])
            : slice;
          return { ...s, selectedIds: merged, lastClickedId: a.id };
        }
      }
      if (a.multi) {
        const next = new Set(s.selectedIds);
        next.has(a.id) ? next.delete(a.id) : next.add(a.id);
        return { ...s, selectedIds: next, lastClickedId: a.id };
      }
      return {
        ...s,
        selectedIds: new Set([a.id]),
        lastClickedId: a.id,
      };
    }
    case "CLEAR_SELECTION":
      return { ...s, selectedIds: new Set(), lastClickedId: null };
    case "START_RENAME":
      return { ...s, renamingId: a.id, renameValue: a.current };
    case "SET_RENAME_VALUE":
      return { ...s, renameValue: a.v };
    case "CANCEL_RENAME":
      return { ...s, renamingId: null, renameValue: "" };
    case "COMMIT_RENAME":
      return { ...s, renamingId: null, renameValue: "" };
    case "SET_SCROLL":
      return { ...s, scrollTop: a.top };
    case "SET_HEIGHT":
      return { ...s, containerHeight: a.h };
    default:
      return s;
  }
}

// ─── Group helpers ────────────────────────────────────────────────────────────

interface FieldGroup {
  id: string;
  label: string;
  nodes: YamlNode[];
}

function groupByNamespace(nodes: YamlNode[]): FieldGroup[] {
  const map = new Map<string, YamlNode[]>();
  for (const n of nodes) {
    const ns = n.namespace || "default";
    if (!map.has(ns)) map.set(ns, []);
    map.get(ns)!.push(n);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ns, ns_nodes]) => ({ id: `ns:${ns}`, label: ns, nodes: ns_nodes }));
}

function groupByType(nodes: YamlNode[]): FieldGroup[] {
  const TYPE_ORDER = [
    "gateway",
    "infra",
    "monitoring",
    "service",
    "database",
    "cache",
    "queue",
    "default",
  ];
  const TYPE_LABELS: Record<string, string> = {
    gateway: "Gateways",
    infra: "Infrastructure",
    monitoring: "Monitoring",
    service: "Services",
    database: "Databases",
    cache: "Cache",
    queue: "Message Queues",
    default: "Other",
  };
  const map = new Map<string, YamlNode[]>();
  for (const n of nodes) {
    const t = TYPE_ORDER.includes(n.type_id) ? n.type_id : "default";
    if (!map.has(t)) map.set(t, []);
    map.get(t)!.push(n);
  }
  return TYPE_ORDER.filter((t) => map.has(t)).map((t) => ({
    id: `type:${t}`,
    label: TYPE_LABELS[t] ?? t,
    nodes: map.get(t)!,
  }));
}

function groupFlat(nodes: YamlNode[]): FieldGroup[] {
  return [{ id: "all", label: "All Fields", nodes }];
}

function isInfraType(typeId: string): boolean {
  return ["gateway", "infra", "monitoring"].includes(typeId);
}

// ─── Flat list builder (for virtualization) ───────────────────────────────────

type FlatItem =
  | { kind: "group-header"; group: FieldGroup; isExpanded: boolean }
  | { kind: "node"; node: YamlNode; groupId: string };

function buildFlatList(
  groups: FieldGroup[],
  expandedGroups: Set<string>,
  expandAll: boolean,
): FlatItem[] {
  const items: FlatItem[] = [];
  for (const g of groups) {
    const isExpanded =
      expandAll || expandedGroups.has(g.id) || expandedGroups.has("__all__");
    items.push({ kind: "group-header", group: g, isExpanded });
    if (isExpanded) {
      for (const node of g.nodes) {
        items.push({ kind: "node", node, groupId: g.id });
      }
    }
  }
  return items;
}

// ─── File tree ────────────────────────────────────────────────────────────────

interface FileTreeNode {
  id: string;
  name: string;
  isDir: boolean;
  path: string;
  isHelm: boolean;
  children: FileTreeNode[];
}

function buildFileTree(
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

  ensure(projectPath, projectPath.split("/").pop() ?? projectPath, true);

  for (const fp of filePaths) {
    const rel = fp.startsWith(projectPath)
      ? fp.slice(projectPath.length).replace(/^\//, "")
      : fp;
    const parts = rel.split("/").filter(Boolean);
    let cur = projectPath;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const next = `${cur}/${part}`;
      const isLast = i === parts.length - 1;
      const child = ensure(next, part, !isLast);
      const parent = map.get(cur);
      if (parent && !parent.children.find((c) => c.id === next)) {
        parent.children.push(child);
      }
      cur = next;
    }
  }

  return map.get(projectPath)?.children ?? [];
}

// ─── Context menu types ───────────────────────────────────────────────────────

interface CtxMenuState {
  x: number;
  y: number;
  nodes: YamlNode[]; // can be multiple (batch)
}

type CtxAction = {
  id: string;
  label: string;
  icon: IconName;
  shortcut?: string;
  danger?: boolean;
  dividerBefore?: boolean;
  disabled?: boolean;
  action: () => void;
};

function buildContextActions(
  nodes: YamlNode[],
  handlers: {
    onRename: (n: YamlNode) => void;
    onEdit: (n: YamlNode) => void;
    onDelete: (nodes: YamlNode[]) => void;
    onDuplicate: (n: YamlNode) => void;
    onLogs: (n: YamlNode) => void;
    onOpenYaml: (n: YamlNode) => void;
    onRevealInExplorer: (n: YamlNode) => void;
    onProperties: (n: YamlNode) => void;
    onCopyName: (n: YamlNode) => void;
    onClose: () => void;
  },
): CtxAction[] {
  const single = nodes.length === 1 ? nodes[0] : null;
  const multi = nodes.length > 1;
  const isHelm = single?.source === "helm";
  const isWorkload = single
    ? ["service", "database", "cache", "queue"].includes(single.type_id)
    : false;

  const actions: CtxAction[] = [];

  // ── Single node actions ──
  if (single) {
    actions.push({
      id: "open-yaml",
      label: "Open YAML",
      icon: "fileYaml",
      shortcut: "↩",
      action: () => {
        executeCommand("field.openYaml", { node: single });
        handlers.onClose();
      },
    });

    actions.push({
      id: "properties",
      label: "Properties",
      icon: "settings",
      shortcut: "⌘I",
      action: () => {
        executeCommand("field.properties", { node: single });
        handlers.onClose();
      },
    });

    actions.push({
      id: "reveal",
      label: "Reveal in Explorer",
      icon: "folderOpen",
      action: () => {
        handlers.onRevealInExplorer(single);
        handlers.onClose();
      },
    });

    actions.push({
      id: "copy-name",
      label: "Copy Resource Name",
      icon: "configmap",
      shortcut: "⌘⇧C",
      dividerBefore: true,
      action: () => {
        handlers.onCopyName(single);
        handlers.onClose();
      },
    });

    // Logs — workloads only
    if (isWorkload || isHelm) {
      actions.push({
        id: "logs",
        label: "View Logs",
        icon: "logs",
        shortcut: "⌘L",
        action: () => {
          handlers.onLogs(single);
          handlers.onClose();
        },
      });
    }

    // Diff
    actions.push({
      id: "diff",
      label: "Cluster Diff",
      icon: "events",
      action: () => {
        executeCommand("field.diff", { node: single });
        handlers.onClose();
      },
    });

    // Helm-specific
    if (isHelm) {
      actions.push({
        id: "deploy",
        label: "Deploy / Redeploy",
        icon: "deploy",
        shortcut: "⌘⇧D",
        dividerBefore: true,
        action: () => {
          handlers.onEdit(single);
          handlers.onClose();
        },
      });
    } else {
      actions.push({
        id: "edit-redeploy",
        label: "Edit & Redeploy",
        icon: "deploy",
        shortcut: "⌘⇧D",
        dividerBefore: true,
        action: () => {
          handlers.onEdit(single);
          handlers.onClose();
        },
      });
    }

    actions.push({
      id: "rename",
      label: "Rename",
      icon: "settings",
      shortcut: "↩",
      action: () => {
        handlers.onRename(single);
        handlers.onClose();
      },
    });

    actions.push({
      id: "duplicate",
      label: "Duplicate",
      icon: "add",
      shortcut: "⌘D",
      disabled: isHelm, // helm charts can't trivially be duped
      action: () => {
        if (!isHelm) handlers.onDuplicate(single);
        handlers.onClose();
      },
    });
  }

  // ── Delete (single or batch) ──
  actions.push({
    id: "delete",
    label: multi ? `Delete ${nodes.length} Fields` : "Delete",
    icon: "secret",
    shortcut: "⌫",
    danger: true,
    dividerBefore: true,
    action: () => {
      handlers.onDelete(nodes);
      handlers.onClose();
    },
  });

  return actions;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

function getFieldStatus(
  node: YamlNode,
  clusterFields: FieldStatus[],
): FieldStatus | null {
  return (
    clusterFields.find(
      (f) =>
        f.label.toLowerCase() === node.label.toLowerCase() &&
        (f.namespace === node.namespace || !node.namespace),
    ) ?? null
  );
}

type StatusLevel = "ok" | "warn" | "error" | "unknown";

function resolveStatusLevel(fs: FieldStatus | null): StatusLevel {
  if (!fs) return "unknown";
  if (fs.status === "green") return "ok";
  if (fs.status === "yellow") return "warn";
  if (fs.status === "red") return "error";
  return "unknown";
}

const STATUS_COLORS: Record<StatusLevel, string> = {
  ok: "var(--ctp-green)",
  warn: "var(--ctp-yellow)",
  error: "var(--ctp-red)",
  unknown: "var(--ctp-surface1)",
};

// ─── Presets (kept from original) ────────────────────────────────────────────

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
    desc: "Grafana",
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
  if (p.svc)
    files[`${p.folder}/${n}-service.yaml`] =
      `apiVersion: v1\nkind: Service\nmetadata:\n  name: ${n}\n  namespace: ${ns}\nspec:\n  selector:\n    app: ${n}\n  ports:\n    - port: ${port}\n      targetPort: ${port}\n`;
  if (p.storage)
    files[`${p.folder}/${n}-pvc.yaml`] =
      `apiVersion: v1\nkind: PersistentVolumeClaim\nmetadata:\n  name: ${n}-pvc\n  namespace: ${ns}\nspec:\n  accessModes: [ReadWriteOnce]\n  resources:\n    requests:\n      storage: ${p.storage}\n`;
  return files;
}

function buildHelmFiles(name: string, p: HelmPreset): Record<string, string> {
  return {
    [`infra/${name}/helm/Chart.yaml`]: `apiVersion: v2\nname: ${name}\ndescription: Endfield wrapper for ${p.chart}\ntype: application\nversion: 0.1.0\ndependencies:\n  - name: ${p.chart}\n    version: "${p.version}"\n    repository: "${p.repo}"\n`,
    [`infra/${name}/helm/values.yaml`]: p.values,
    [`infra/${name}/namespace.yaml`]: `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${p.ns}\n`,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Status dot with tooltip */
function StatusBadge({
  status,
  ready,
  total,
  restarts,
}: {
  status: StatusLevel;
  ready?: number;
  total?: number;
  restarts?: number;
}) {
  const [hov, setHov] = useState(false);
  const color = STATUS_COLORS[status];
  const tooltip =
    status === "ok"
      ? `Ready ${ready}/${total}`
      : status === "warn"
        ? `Degraded ${ready}/${total}${restarts ? ` · ${restarts} restarts` : ""}`
        : status === "error"
          ? `Not ready ${ready}/${total}`
          : "Cluster status unknown";

  return (
    <div
      style={{ position: "relative", display: "flex", alignItems: "center" }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
          boxShadow: status === "ok" ? `0 0 4px ${color}60` : undefined,
          animation: status === "warn" ? "ef-pulse-dot 2s infinite" : undefined,
        }}
      />
      {hov && (
        <div
          style={{
            position: "absolute",
            right: "calc(100% + 8px)",
            top: "50%",
            transform: "translateY(-50%)",
            background: "var(--bg-modal)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-md)",
            padding: "4px 8px",
            fontSize: 10,
            color: "var(--text-secondary)",
            fontFamily: "var(--font-mono)",
            whiteSpace: "nowrap",
            boxShadow: "var(--shadow-md)",
            zIndex: 9999,
            pointerEvents: "none",
          }}
        >
          {tooltip}
        </div>
      )}
    </div>
  );
}

/** Replica badge */
function ReplicaBadge({ ready, total }: { ready: number; total: number }) {
  const color =
    ready === total
      ? "var(--ctp-green)"
      : ready === 0
        ? "var(--ctp-red)"
        : "var(--ctp-yellow)";
  return (
    <div
      style={{
        fontSize: 9,
        fontFamily: "var(--font-mono)",
        color,
        background: `${color}18`,
        border: `1px solid ${color}30`,
        borderRadius: 4,
        padding: "1px 5px",
        lineHeight: 1.6,
        letterSpacing: "0.02em",
        flexShrink: 0,
      }}
    >
      {ready}/{total}
    </div>
  );
}

/** Group/section header row */
function GroupHeader({
  label,
  count,
  isExpanded,
  onToggle,
}: {
  label: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      role="button"
      aria-expanded={isExpanded}
      style={{
        height: ROW_HEIGHT,
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "0 10px 0 12px",
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
          transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
        }}
      >
        <ExplorerIcon name="chevronDown" size={10} strokeWidth={2.5} />
      </span>
      <span
        style={{
          flex: 1,
          fontSize: 10,
          color: "var(--text-faint)",
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          fontWeight: 600,
          fontFamily: "var(--font-ui)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 9,
          color: "var(--text-faint)",
          fontFamily: "var(--font-mono)",
          background: "var(--bg-elevated)",
          padding: "1px 5px",
          borderRadius: 99,
          lineHeight: 1.7,
        }}
      >
        {count}
      </span>
    </div>
  );
}

/** Single field row */
const ExplorerRow = React.memo(function ExplorerRow({
  node,
  isSelected,
  isRenaming,
  renameValue,
  fieldStatus,
  onSelect,
  onContextMenu,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onOpen,
}: {
  node: YamlNode;
  isSelected: boolean;
  isRenaming: boolean;
  renameValue: string;
  fieldStatus: FieldStatus | null;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onOpen: () => void;
}) {
  const [hov, setHov] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const iconName = resolveNodeIcon(node.type_id, node.label, node.source);
  const color = resolveNodeColor(node.type_id);
  const status = resolveStatusLevel(fieldStatus);
  const hasClusterData = fieldStatus !== null;

  useEffect(() => {
    if (isRenaming) renameRef.current?.focus();
  }, [isRenaming]);

  return (
    <div
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        height: ROW_HEIGHT,
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "0 10px 0 24px",
        cursor: "pointer",
        background: isSelected
          ? "var(--bg-sidebar-active)"
          : hov
            ? "var(--bg-sidebar-hover)"
            : "transparent",
        borderRadius: 6,
        margin: "0 4px",
        transition: "background 0.08s",
        position: "relative",
        userSelect: "none",
      }}
    >
      {/* Left accent line for selected */}
      {isSelected && (
        <div
          style={{
            position: "absolute",
            left: 4,
            top: "20%",
            bottom: "20%",
            width: 2,
            background: color,
            borderRadius: 2,
            opacity: 0.7,
          }}
        />
      )}

      {/* Icon */}
      <span
        style={{
          color: isSelected ? color : hov ? color + "cc" : "var(--text-faint)",
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          transition: "color 0.1s",
        }}
      >
        <ExplorerIcon name={iconName} size={13} strokeWidth={1.75} />
      </span>

      {/* Label */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {isRenaming ? (
          <input
            ref={renameRef}
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
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              width: "100%",
              outline: "none",
              padding: "1px 5px",
            }}
          />
        ) : (
          <div
            style={{
              fontSize: 11,
              color: isSelected
                ? "var(--text-primary)"
                : "var(--text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: isSelected ? 500 : 400,
              lineHeight: 1,
            }}
          >
            {node.label}
          </div>
        )}

        {/* Sub-label: kind + namespace */}
        {!isRenaming && (
          <div
            style={{
              marginTop: 2,
              fontSize: 9,
              color: "var(--text-faint)",
              fontFamily: "var(--font-mono)",
              display: "flex",
              alignItems: "center",
              gap: 4,
              overflow: "hidden",
            }}
          >
            <span style={{ opacity: 0.8 }}>{node.kind}</span>
            {node.namespace && (
              <>
                <span style={{ opacity: 0.3 }}>·</span>
                <span style={{ opacity: 0.6 }}>{node.namespace}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Right side badges */}
      {!isRenaming && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            flexShrink: 0,
          }}
        >
          {/* Helm badge */}
          {node.source === "helm" && (
            <span
              style={{
                color: "var(--node-infra)",
                display: "flex",
                alignItems: "center",
                opacity: 0.7,
              }}
            >
              <ExplorerIcon name="helmRelease" size={9} strokeWidth={1.5} />
            </span>
          )}

          {/* Replica count from cluster */}
          {hasClusterData && fieldStatus!.desired > 0 && (
            <ReplicaBadge
              ready={fieldStatus!.ready}
              total={fieldStatus!.desired}
            />
          )}

          {/* Replica count from yaml (fallback) */}
          {!hasClusterData && node.replicas != null && (
            <span
              style={{
                fontSize: 9,
                color: "var(--text-faint)",
                fontFamily: "var(--font-mono)",
                background: "var(--bg-elevated)",
                padding: "1px 5px",
                borderRadius: 4,
                lineHeight: 1.7,
              }}
            >
              ×{node.replicas}
            </span>
          )}

          {/* Status dot */}
          {hasClusterData && (
            <StatusBadge
              status={status}
              ready={fieldStatus!.ready}
              total={fieldStatus!.desired}
              restarts={fieldStatus!.pods.reduce((s, p) => s + p.restarts, 0)}
            />
          )}
        </div>
      )}
    </div>
  );
});

/** File tree node row */
function FileTreeRow({
  node,
  depth,
  isExpanded,
  isSelected,
  onToggle,
  onClick,
}: {
  node: FileTreeNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  const iconName: IconName = node.isDir
    ? isExpanded
      ? "folderOpen"
      : "folder"
    : node.isHelm
      ? "helmRelease"
      : "fileYaml";

  return (
    <div
      onClick={() => (node.isDir ? onToggle() : onClick())}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        height: 28,
        display: "flex",
        alignItems: "center",
        gap: 6,
        paddingLeft: 10 + depth * 14,
        paddingRight: 10,
        cursor: "pointer",
        background: isSelected
          ? "var(--bg-sidebar-active)"
          : hov
            ? "var(--bg-sidebar-hover)"
            : "transparent",
        borderRadius: 6,
        margin: "0 4px",
        transition: "background 0.08s",
        userSelect: "none",
      }}
    >
      {/* Expand arrow */}
      <span
        style={{
          width: 10,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          color: "var(--text-faint)",
          transition: "transform 0.12s",
          transform:
            node.isDir && isExpanded ? "rotate(90deg)" : "rotate(0deg)",
          opacity: node.isDir ? 1 : 0,
        }}
      >
        <ExplorerIcon name="chevronRight" size={10} strokeWidth={2.5} />
      </span>

      {/* Icon */}
      <span
        style={{
          color: isSelected
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
        <ExplorerIcon name={iconName} size={12} />
      </span>

      {/* Name */}
      <span
        style={{
          fontSize: 11,
          color: isSelected
            ? "var(--text-primary)"
            : node.isDir
              ? "var(--text-secondary)"
              : "var(--text-muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: isSelected ? 500 : 400,
        }}
      >
        {node.name}
      </span>
    </div>
  );
}

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
        return (
          <React.Fragment key={node.id}>
            <FileTreeRow
              node={node}
              depth={depth}
              isExpanded={isOpen}
              isSelected={selectedId === node.id}
              onToggle={() => onToggle(node.id)}
              onClick={() => onFileClick(node)}
            />
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

// ─── Context Menu ─────────────────────────────────────────────────────────────

function ExplorerContextMenu({
  state,
  actions,
  onClose,
}: {
  state: CtxMenuState;
  actions: CtxAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Stable ref so listeners don't re-register on every render
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const firstNode = state.nodes[0];
  // Guard: never render with empty nodes
  if (!firstNode) return null;

  useEffect(() => {
    // Arm after one frame — prevents the right-click that opened the menu
    // from immediately closing it via the mousedown listener
    let armed = false;
    const frame = requestAnimationFrame(() => {
      armed = true;
    });

    const down = (e: MouseEvent) => {
      if (!armed) return;
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, []); // intentionally empty — uses stable ref

  // Clamp position
  const menuW = 218;
  const menuH = actions.length * 28 + 52;
  const left = Math.min(state.x, window.innerWidth - menuW - 8);
  const top = Math.min(state.y, window.innerHeight - menuH - 8);

  const iconName = resolveNodeIcon(
    firstNode.type_id,
    firstNode.label,
    firstNode.source,
  );
  const color = resolveNodeColor(firstNode.type_id);

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
        animation: "ef-slidein 0.1s ease-out",
        fontFamily: "var(--font-ui)",
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div
        style={{
          padding: "7px 12px 6px",
          borderBottom: "1px solid var(--border-subtle)",
          marginBottom: 2,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            color,
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <ExplorerIcon name={iconName} size={13} strokeWidth={1.75} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: "var(--text-primary)",
              fontSize: 11,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {state.nodes.length > 1
              ? `${state.nodes.length} fields selected`
              : firstNode.label}
          </div>
          {state.nodes.length === 1 && (
            <div
              style={{
                color: "var(--text-faint)",
                fontSize: 9,
                fontFamily: "var(--font-mono)",
                marginTop: 1,
              }}
            >
              {firstNode.kind} · {firstNode.namespace}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      {actions.map((action) => (
        <React.Fragment key={action.id}>
          {action.dividerBefore && (
            <div
              style={{
                height: 1,
                background: "var(--border-subtle)",
                margin: "3px 0",
              }}
            />
          )}
          <ContextMenuRow action={action} />
        </React.Fragment>
      ))}
    </div>,
    document.body,
  );
}

function ContextMenuRow({ action }: { action: CtxAction }) {
  const [hov, setHov] = useState(false);
  const dangerColor = "var(--ctp-red)";

  return (
    <div
      onClick={action.disabled ? undefined : action.action}
      onMouseDown={(e) => e.stopPropagation()} // prevent outside-click listener from closing before action fires
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 10px 0 10px",
        height: 28,
        cursor: action.disabled ? "default" : "pointer",
        background:
          hov && !action.disabled
            ? action.danger
              ? "rgba(243,139,168,0.08)"
              : "var(--bg-sidebar-active)"
            : "transparent",
        color: action.disabled
          ? "var(--text-faint)"
          : action.danger
            ? dangerColor
            : hov
              ? "var(--text-primary)"
              : "var(--text-secondary)",
        fontSize: 11,
        transition: "background 0.08s, color 0.08s",
        borderRadius: "var(--radius-xs)",
        margin: "1px 4px",
        opacity: action.disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          opacity: action.danger ? 1 : 0.65,
        }}
      >
        <ExplorerIcon name={action.icon} size={12} strokeWidth={1.75} />
      </span>
      <span style={{ flex: 1 }}>{action.label}</span>
      {action.shortcut && (
        <span
          style={{
            fontSize: 9,
            color: "var(--text-faint)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.03em",
          }}
        >
          {action.shortcut}
        </span>
      )}
    </div>
  );
}

// ─── Add Field Modal ──────────────────────────────────────────────────────────

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

  const iStyle: React.CSSProperties = {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-sm)",
    padding: "5px 9px",
    color: "var(--text-primary)",
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    outline: "none",
    width: "100%",
    transition: "border-color 0.12s",
  };
  const lStyle: React.CSSProperties = {
    color: "var(--text-faint)",
    fontSize: 9,
    marginBottom: 4,
    fontFamily: "var(--font-mono)",
    letterSpacing: "0.07em",
    textTransform: "uppercase",
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
          width: 420,
          overflow: "hidden",
          boxShadow: "var(--shadow-modal)",
          animation: "ef-fadein 0.15s ease-out",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "12px 16px 10px",
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
              fontSize: 13,
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
              display: "flex",
              alignItems: "center",
            }}
          >
            <ExplorerIcon name="chevronRight" size={13} />
          </button>
        </div>

        {/* Mode tabs */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          {(["raw", "helm"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                padding: "8px 0",
                background: "none",
                border: "none",
                borderBottom: `2px solid ${mode === m ? "var(--accent)" : "transparent"}`,
                color: mode === m ? "var(--accent)" : "var(--text-muted)",
                fontSize: 10,
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
                size={11}
              />
              {m === "helm" ? "Helm Chart" : "Raw YAML"}
            </button>
          ))}
        </div>

        <div
          style={{
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 11,
          }}
        >
          <div>
            <div style={lStyle}>Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === "raw" ? "my-service" : "my-release"}
              style={iStyle}
            />
          </div>

          {mode === "raw" ? (
            <>
              <div>
                <div style={lStyle}>Preset</div>
                <select
                  value={rawKey}
                  onChange={(e) => {
                    setRawKey(e.target.value);
                    setPort(RAW_PRESETS[e.target.value].port);
                  }}
                  style={{ ...iStyle, cursor: "pointer" }}
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
                  <div style={lStyle}>Namespace</div>
                  <input
                    value={ns}
                    onChange={(e) => setNs(e.target.value)}
                    style={iStyle}
                  />
                </div>
                <div>
                  <div style={lStyle}>Port</div>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    style={iStyle}
                  />
                </div>
              </div>
              <div
                style={{
                  color: "var(--text-faint)",
                  fontSize: 9,
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
                <div style={lStyle}>Chart</div>
                <select
                  value={helmKey}
                  onChange={(e) => setHelmKey(e.target.value)}
                  style={{ ...iStyle, cursor: "pointer" }}
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
                  fontSize: 9,
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
                  : "var(--ctp-green)",
                fontSize: 11,
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
              padding: "7px 14px",
              background: "rgba(180,190,254,0.08)",
              border: "1px solid var(--border-accent)",
              borderRadius: "var(--radius-md)",
              color: "var(--accent-alt)",
              fontSize: 11,
              fontFamily: "var(--font-ui)",
              fontWeight: 500,
              cursor: busy ? "wait" : "pointer",
              marginTop: 2,
              transition: "var(--ease-fast)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
            onMouseEnter={(e) => {
              if (!busy)
                (e.currentTarget as HTMLElement).style.background =
                  "rgba(180,190,254,0.15)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                "rgba(180,190,254,0.08)";
            }}
          >
            <ExplorerIcon name="add" size={12} strokeWidth={2.5} />
            {busy ? "Creating…" : "Create Field"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function ToolbarBtn({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
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
        background: active
          ? "var(--bg-elevated)"
          : hov
            ? "var(--bg-sidebar-hover)"
            : "transparent",
        border: "none",
        borderRadius: 6,
        color: active
          ? "var(--accent)"
          : hov
            ? "var(--text-muted)"
            : "var(--text-faint)",
        width: 24,
        height: 24,
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

// ─── Toast notification ───────────────────────────────────────────────────────

interface ToastMsg {
  id: number;
  text: string;
  icon?: IconName;
}

let _toastId = 0;
let _setToasts: React.Dispatch<React.SetStateAction<ToastMsg[]>> | null = null;

function showToast(text: string, icon?: IconName) {
  const id = ++_toastId;
  _setToasts?.((prev) => [...prev.slice(-3), { id, text, icon }]);
  setTimeout(() => {
    _setToasts?.((prev) => prev.filter((t) => t.id !== id));
  }, 2200);
}

function ToastLayer() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  useEffect(() => {
    _setToasts = setToasts;
    return () => {
      _setToasts = null;
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 52,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        zIndex: 99999,
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            background: "var(--bg-modal)",
            backdropFilter: "var(--blur-md)",
            WebkitBackdropFilter: "var(--blur-md)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-lg)",
            padding: "6px 12px 6px 10px",
            fontSize: 11,
            color: "var(--text-secondary)",
            fontFamily: "var(--font-ui)",
            boxShadow: "var(--shadow-md)",
            animation: "ef-fadein 0.15s ease-out",
            whiteSpace: "nowrap",
          }}
        >
          {t.icon && (
            <span
              style={{
                color: "var(--accent)",
                display: "flex",
                alignItems: "center",
              }}
            >
              <ExplorerIcon name={t.icon} size={11} />
            </span>
          )}
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ─── Hotkeys hint panel ────────────────────────────────────────────────────────

const HOTKEYS = [
  { keys: ["⌘N"], label: "New field" },
  { keys: ["⌘D"], label: "Duplicate" },
  { keys: ["⌫"], label: "Delete selected" },
  { keys: ["↑", "↓"], label: "Navigate" },
  { keys: ["↩"], label: "Open" },
  { keys: ["⌘", "click"], label: "Multi-select" },
  { keys: ["⇧", "click"], label: "Range select" },
];

function HotkeysHint({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "var(--blur-sm)",
        WebkitBackdropFilter: "var(--blur-sm)",
        zIndex: 300,
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
          padding: "16px 20px 14px",
          width: 280,
          boxShadow: "var(--shadow-modal)",
          animation: "ef-fadein 0.15s ease-out",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-primary)",
              fontFamily: "var(--font-ui)",
            }}
          >
            Keyboard Shortcuts
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-faint)",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: "0 2px",
            }}
          >
            ×
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {HOTKEYS.map((hk, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "5px 0",
                borderBottom:
                  i < HOTKEYS.length - 1
                    ? "1px solid var(--border-subtle)"
                    : "none",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-ui)",
                }}
              >
                {hk.label}
              </span>
              <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                {hk.keys.map((k, ki) => (
                  <React.Fragment key={ki}>
                    {ki > 0 && (
                      <span style={{ fontSize: 9, color: "var(--text-faint)" }}>
                        +
                      </span>
                    )}
                    <kbd
                      style={{
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border-default)",
                        borderRadius: 4,
                        padding: "1px 5px",
                        fontSize: 10,
                        color: "var(--text-muted)",
                        fontFamily: "var(--font-mono)",
                        lineHeight: 1.6,
                        boxShadow: "0 1px 0 var(--border-strong)",
                        minWidth: 18,
                        textAlign: "center",
                      }}
                    >
                      {k}
                    </kbd>
                  </React.Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Error Boundary ────────────────────────────────────────────────────────────

class ExplorerErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 16,
            color: "var(--ctp-red)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            lineHeight: 1.6,
          }}
        >
          <div style={{ marginBottom: 6, fontWeight: 600 }}>Explorer error</div>
          <div style={{ color: "var(--text-faint)", wordBreak: "break-word" }}>
            {this.state.error}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: 10,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-secondary)",
              fontSize: 10,
              cursor: "pointer",
              padding: "4px 10px",
              fontFamily: "var(--font-mono)",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function ExplorerPanel() {
  const nodes = useIDEStore((s) => s.nodes);
  const projectPath = useIDEStore((s) => s.projectPath);
  const clusterStatus = useIDEStore((s) => s.clusterStatus);
  const addNode = useIDEStore((s) => s.addNode);
  const renameNode = useIDEStore((s) => s.renameNode);
  const removeNode = useIDEStore((s) => s.removeNode);
  const openTab = useIDEStore((s) => s.openTab);
  const setSelected = useIDEStore((s) => s.setSelectedEntity);
  const selected = useIDEStore((s) => s.selectedEntity);

  // ── Explorer state ──
  const [state, dispatch] = useReducer(explorerReducer, {
    tab: "fields",
    groupMode: "type",
    search: "",
    expandedGroups: new Set([
      "type:gateway",
      "type:infra",
      "type:monitoring",
      "type:service",
      "type:database",
      "type:cache",
      "type:queue",
      "type:default",
    ]),
    selectedIds: new Set<string>(),
    lastClickedId: null,
    renamingId: null,
    renameValue: "",
    scrollTop: 0,
    containerHeight: 400,
  });

  // ── Local UI state ──
  const [showAdd, setShowAdd] = useState(false);
  const [showHotkeys, setShowHotkeys] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<YamlNode[] | null>(null);
  const [editTarget, setEditTarget] = useState<YamlNode | null>(null);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [expandedFileFolders, setExpandedFileFolders] = useState<Set<string>>(
    new Set(),
  );
  const [searchFocus, setSearchFocus] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── File scan ──
  const rescan = useCallback(() => {
    if (!projectPath) return;
    scanProjectFiles(projectPath)
      .then(setProjectFiles)
      .catch(() => setProjectFiles([]));
  }, [projectPath]);

  useEffect(() => {
    rescan();
  }, [rescan, nodes]);

  useEffect(() => {
    if (!projectPath) return;
    let unlisten: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    listen("yaml-file-changed", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(rescan, 300);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
      if (timer) clearTimeout(timer);
    };
  }, [projectPath, rescan]);

  // ── File tree ──
  const fileTree = useMemo(
    () => (projectPath ? buildFileTree(projectFiles, projectPath) : []),
    [projectFiles, projectPath],
  );

  useEffect(() => {
    if (fileTree.length > 0 && expandedFileFolders.size === 0) {
      setExpandedFileFolders(new Set(fileTree.map((n) => n.id)));
    }
  }, [fileTree.length]);

  const toggleFileFolder = (id: string) =>
    setExpandedFileFolders((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });

  // ── Field filtering + grouping ──
  const q = state.search.toLowerCase();
  const filteredNodes = useMemo(
    () =>
      nodes.filter(
        (n) =>
          !q ||
          n.label.toLowerCase().includes(q) ||
          n.namespace?.toLowerCase().includes(q) ||
          n.kind?.toLowerCase().includes(q),
      ),
    [nodes, q],
  );

  const groups = useMemo(() => {
    if (state.groupMode === "namespace") return groupByNamespace(filteredNodes);
    if (state.groupMode === "type") return groupByType(filteredNodes);
    return groupFlat(filteredNodes);
  }, [filteredNodes, state.groupMode]);

  // ── Flat virtualized list ──
  const flatItems = useMemo(
    () => buildFlatList(groups, state.expandedGroups, false),
    [groups, state.expandedGroups],
  );

  const allNodeIds = useMemo(
    () =>
      flatItems
        .filter((i) => i.kind === "node")
        .map(
          (i) =>
            (i as { kind: "node"; node: YamlNode; groupId: string }).node.id,
        ),
    [flatItems],
  );

  // ── Virtualization ──
  const visibleItems = useMemo(() => {
    if (flatItems.length < 80)
      return { start: 0, end: flatItems.length, items: flatItems };
    const start = Math.max(
      0,
      Math.floor(state.scrollTop / ROW_HEIGHT) - OVERSCAN,
    );
    const end = Math.min(
      flatItems.length,
      Math.ceil((state.scrollTop + state.containerHeight) / ROW_HEIGHT) +
        OVERSCAN,
    );
    return { start, end, items: flatItems.slice(start, end) };
  }, [flatItems, state.scrollTop, state.containerHeight]);

  // ── Resize observer ──
  useEffect(() => {
    if (!listRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 400;
      dispatch({ type: "SET_HEIGHT", h });
    });
    ro.observe(listRef.current);
    return () => ro.disconnect();
  }, []);

  const clusterFields = clusterStatus?.fields ?? [];

  // ── Keyboard nav ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (state.renamingId) return;
      const focused = document.activeElement;
      if (
        focused &&
        focused !== document.body &&
        !containerRef.current?.contains(focused)
      )
        return;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (state.selectedIds.size > 0 && state.tab === "fields") {
          e.preventDefault();
          const targets = nodes.filter((n) => state.selectedIds.has(n.id));
          if (targets.length) setDeleteTargets(targets);
        }
      }
      if (e.metaKey && e.key === "n") {
        e.preventDefault();
        if (projectPath) setShowAdd(true);
      }
      if (e.metaKey && e.key === "d") {
        e.preventDefault();
        // duplicate first selected
        const first = nodes.find(
          (n) => state.selectedIds.has(n.id) && n.source !== "helm",
        );
        if (first) handleDuplicate(first);
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (allNodeIds.length === 0) return;
        const currentIdx = state.lastClickedId
          ? allNodeIds.indexOf(state.lastClickedId)
          : -1;
        const nextIdx =
          e.key === "ArrowDown"
            ? Math.min(allNodeIds.length - 1, currentIdx + 1)
            : Math.max(0, currentIdx - 1);
        const nextId = allNodeIds[nextIdx];
        dispatch({
          type: "SELECT",
          id: nextId,
          multi: false,
          range: false,
          allIds: allNodeIds,
        });
      }
      if (e.key === "Enter" && state.lastClickedId) {
        const node = nodes.find((n) => n.id === state.lastClickedId);
        if (node) handleOpenNode(node);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    state.selectedIds,
    state.lastClickedId,
    state.renamingId,
    allNodeIds,
    nodes,
    projectPath,
    state.tab,
  ]);

  // ── Handlers ──
  const handleNodeSelect = useCallback(
    (e: React.MouseEvent, node: YamlNode) => {
      dispatch({
        type: "SELECT",
        id: node.id,
        multi: e.metaKey || e.ctrlKey,
        range: e.shiftKey,
        allIds: allNodeIds,
      });
      setSelected({
        type: "field",
        id: node.id,
        label: node.label,
        filePath: node.file_path,
        meta: {
          kind: node.kind,
          typeId: node.type_id,
          namespace: node.namespace,
          source: node.source,
        },
      });
    },
    [allNodeIds, setSelected],
  );

  const handleOpenNode = useCallback(
    (node: YamlNode) => {
      if (!node.file_path) return;
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
    },
    [openTab],
  );

  const handleFileClick = useCallback(
    (ftNode: FileTreeNode) => {
      setSelected({
        type: "file",
        id: ftNode.id,
        label: ftNode.name,
        filePath: ftNode.path,
      });
      openTab(
        {
          id: `file-${ftNode.path}`,
          title: ftNode.name,
          contentType: "file",
          filePath: ftNode.path,
          icon: "fileYaml",
        },
        "center",
      );
    },
    [setSelected, openTab],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: YamlNode) => {
      e.preventDefault();
      e.stopPropagation();
      const affectedIds = state.selectedIds.has(node.id)
        ? state.selectedIds
        : new Set([node.id]);
      const affected = nodes.filter((n) => affectedIds.has(n.id));
      setCtxMenu({ x: e.clientX, y: e.clientY, nodes: affected });
    },
    [state.selectedIds, nodes],
  );

  const handleRename = useCallback((node: YamlNode) => {
    dispatch({ type: "START_RENAME", id: node.id, current: node.label });
  }, []);

  const handleRenameCommit = useCallback(() => {
    if (state.renamingId && state.renameValue.trim()) {
      renameNode(state.renamingId, state.renameValue.trim());
    }
    dispatch({ type: "COMMIT_RENAME" });
  }, [state.renamingId, state.renameValue, renameNode]);

  const handleDuplicate = useCallback(
    (node: YamlNode) => {
      if (node.source === "helm") return;
      addNode({
        ...node,
        id: genId("node"),
        label: `${node.label}-copy`,
        x: node.x + 20,
        y: node.y + 20,
      });
    },
    [addNode],
  );

  const handleDelete = useCallback((targets: YamlNode[]) => {
    setDeleteTargets(targets);
  }, []);

  const handleLogs = useCallback((node: YamlNode) => {
    executeCommand("field.logs", { node });
  }, []);

  const handleCopyName = useCallback((node: YamlNode) => {
    navigator.clipboard.writeText(node.label).catch(() => {});
    showToast(`Copied "${node.label}"`, "configmap");
  }, []);

  const handleRevealInExplorer = useCallback((node: YamlNode) => {
    executeCommand("field.openInExplorer", { node });
  }, []);

  // Build context actions
  const ctxActions = useMemo(() => {
    if (!ctxMenu) return [];
    return buildContextActions(ctxMenu.nodes, {
      onRename: handleRename,
      onEdit: (n) => setEditTarget(n),
      onDelete: handleDelete,
      onDuplicate: handleDuplicate,
      onLogs: handleLogs,
      onOpenYaml: (n) => executeCommand("field.openYaml", { node: n }),
      onRevealInExplorer: handleRevealInExplorer,
      onProperties: (n) => executeCommand("field.properties", { node: n }),
      onCopyName: handleCopyName,
      onClose: () => setCtxMenu(null),
    });
  }, [
    ctxMenu,
    handleRename,
    handleDelete,
    handleDuplicate,
    handleLogs,
    handleRevealInExplorer,
    handleCopyName,
  ]);

  const emptyState = nodes.length === 0;

  return (
    <div
      ref={containerRef}
      onKeyDown={(e) => {
        // Prevent bubbling for arrow keys when focused inside
        if (["ArrowUp", "ArrowDown", "Enter"].includes(e.key))
          e.stopPropagation();
      }}
      tabIndex={-1}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg-sidebar)",
        fontFamily: "var(--font-ui)",
        fontSize: 11,
        color: "var(--text-secondary)",
        outline: "none",
      }}
    >
      {/* ── Tab bar ── */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        {(["fields", "files"] as const).map((t) => (
          <button
            key={t}
            onClick={() => dispatch({ type: "SET_TAB", tab: t })}
            style={{
              flex: 1,
              padding: "7px 0",
              background: state.tab === t ? "transparent" : "transparent",
              border: "none",
              borderBottom: `1.5px solid ${state.tab === t ? "var(--accent)" : "transparent"}`,
              color: state.tab === t ? "var(--accent)" : "var(--text-faint)",
              fontSize: 10,
              cursor: "pointer",
              fontFamily: "var(--font-ui)",
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              fontWeight: state.tab === t ? 600 : 400,
              transition: "color 0.1s, border-color 0.1s",
            }}
          >
            {t === "fields" ? "Fields" : "Files"}
          </button>
        ))}
      </div>

      {/* ── Toolbar ── */}
      <div
        style={{
          padding: "5px 6px",
          flexShrink: 0,
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          gap: 3,
          alignItems: "center",
        }}
      >
        {/* Search */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 5,
            background: searchFocus
              ? "var(--bg-elevated)"
              : "var(--bg-sidebar-hover)",
            border: `1px solid ${searchFocus ? "var(--border-accent)" : "transparent"}`,
            borderRadius: 6,
            padding: "3px 7px",
            transition: "all 0.12s",
          }}
        >
          <span
            style={{
              color: "var(--text-faint)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <ExplorerIcon name="search" size={10} strokeWidth={2} />
          </span>
          <input
            value={state.search}
            onChange={(e) =>
              dispatch({ type: "SET_SEARCH", q: e.target.value })
            }
            onFocus={() => setSearchFocus(true)}
            onBlur={() => setSearchFocus(false)}
            placeholder={state.tab === "files" ? "Search files…" : "Filter…"}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: "var(--text-secondary)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
            }}
          />
          {state.search && (
            <button
              onClick={() => dispatch({ type: "SET_SEARCH", q: "" })}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-faint)",
                cursor: "pointer",
                padding: 0,
                display: "flex",
                alignItems: "center",
                lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
        </div>

        {/* Group mode (fields tab only) */}
        {state.tab === "fields" && (
          <>
            <ToolbarBtn
              title="Group by Type"
              active={state.groupMode === "type"}
              onClick={() => dispatch({ type: "SET_GROUP_MODE", mode: "type" })}
            >
              <ExplorerIcon name="cluster" size={11} />
            </ToolbarBtn>
            <ToolbarBtn
              title="Group by Namespace"
              active={state.groupMode === "namespace"}
              onClick={() =>
                dispatch({ type: "SET_GROUP_MODE", mode: "namespace" })
              }
            >
              <ExplorerIcon name="namespace" size={11} />
            </ToolbarBtn>
            <ToolbarBtn
              title="Flat list"
              active={state.groupMode === "flat"}
              onClick={() => dispatch({ type: "SET_GROUP_MODE", mode: "flat" })}
            >
              <ExplorerIcon name="logs" size={11} />
            </ToolbarBtn>
          </>
        )}

        {/* Add field */}
        {state.tab === "fields" && projectPath && (
          <ToolbarBtn title="Add Field (⌘N)" onClick={() => setShowAdd(true)}>
            <ExplorerIcon name="add" size={12} strokeWidth={2.5} />
          </ToolbarBtn>
        )}

        {/* Deploy */}
        {projectPath && (
          <ToolbarBtn
            title="Deploy Image"
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
            <ExplorerIcon name="deploy" size={11} strokeWidth={2} />
          </ToolbarBtn>
        )}

        {/* Hotkeys hint */}
        <ToolbarBtn
          title="Keyboard shortcuts (?)"
          onClick={() => setShowHotkeys(true)}
        >
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              lineHeight: 1,
              letterSpacing: 0,
            }}
          >
            ?
          </span>
        </ToolbarBtn>
      </div>

      {/* ── Content ── */}
      {state.tab === "files" ? (
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0 8px" }}>
          {!projectPath || fileTree.length === 0 ? (
            <EmptyPlaceholder icon="folder" label="No project open" />
          ) : (
            <FileTreeView
              nodes={fileTree}
              depth={0}
              expanded={expandedFileFolders}
              onToggle={toggleFileFolder}
              selectedId={selected?.type === "file" ? selected.id : null}
              onFileClick={handleFileClick}
            />
          )}
        </div>
      ) : (
        <>
          {/* Batch selection bar */}
          {state.selectedIds.size > 1 && (
            <div
              style={{
                padding: "5px 10px",
                background: "rgba(180,190,254,0.06)",
                borderBottom: "1px solid var(--border-subtle)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  flex: 1,
                  fontSize: 10,
                  color: "var(--accent)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {state.selectedIds.size} selected
              </span>
              <button
                onClick={() => {
                  const targets = nodes.filter((n) =>
                    state.selectedIds.has(n.id),
                  );
                  if (targets.length) setDeleteTargets(targets);
                }}
                style={{
                  background: "rgba(243,139,168,0.08)",
                  border: "1px solid rgba(243,139,168,0.2)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--ctp-red)",
                  fontSize: 10,
                  cursor: "pointer",
                  padding: "2px 8px",
                  fontFamily: "var(--font-mono)",
                }}
              >
                Delete {state.selectedIds.size}
              </button>
              <button
                onClick={() => dispatch({ type: "CLEAR_SELECTION" })}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-faint)",
                  cursor: "pointer",
                  fontSize: 11,
                  padding: "0 2px",
                }}
              >
                ×
              </button>
            </div>
          )}

          {/* Virtualized field list */}
          <div
            ref={listRef}
            onScroll={(e) =>
              dispatch({ type: "SET_SCROLL", top: e.currentTarget.scrollTop })
            }
            onClick={(e) => {
              if (e.target === e.currentTarget)
                dispatch({ type: "CLEAR_SELECTION" });
            }}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "4px 0 8px",
              position: "relative",
            }}
          >
            {emptyState ? (
              <EmptyPlaceholder
                icon="service"
                label={projectPath ? "No fields in project" : "No project open"}
              />
            ) : filteredNodes.length === 0 && state.search ? (
              <EmptyPlaceholder
                icon="search"
                label={`No results for "${state.search}"`}
              />
            ) : (
              <>
                {/* Top spacer for virtualization */}
                {flatItems.length >= 80 && (
                  <div style={{ height: visibleItems.start * ROW_HEIGHT }} />
                )}

                {visibleItems.items.map((item, idx) => {
                  if (item.kind === "group-header") {
                    return (
                      <GroupHeader
                        key={item.group.id}
                        label={item.group.label}
                        count={item.group.nodes.length}
                        isExpanded={item.isExpanded}
                        onToggle={() =>
                          dispatch({ type: "TOGGLE_GROUP", id: item.group.id })
                        }
                      />
                    );
                  }
                  const { node } = item;
                  const fs = getFieldStatus(node, clusterFields);
                  return (
                    <ExplorerRow
                      key={node.id}
                      node={node}
                      isSelected={state.selectedIds.has(node.id)}
                      isRenaming={state.renamingId === node.id}
                      renameValue={
                        state.renamingId === node.id ? state.renameValue : ""
                      }
                      fieldStatus={fs}
                      onSelect={(e) => handleNodeSelect(e, node)}
                      onContextMenu={(e) => handleContextMenu(e, node)}
                      onRenameChange={(v) =>
                        dispatch({ type: "SET_RENAME_VALUE", v })
                      }
                      onRenameCommit={handleRenameCommit}
                      onRenameCancel={() => dispatch({ type: "CANCEL_RENAME" })}
                      onOpen={() => handleOpenNode(node)}
                    />
                  );
                })}

                {/* Bottom spacer for virtualization */}
                {flatItems.length >= 80 && (
                  <div
                    style={{
                      height:
                        (flatItems.length - visibleItems.end) * ROW_HEIGHT,
                    }}
                  />
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ── Modals & overlays ── */}
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

      {ctxMenu && (
        <ExplorerContextMenu
          state={ctxMenu}
          actions={ctxActions}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {deleteTargets && deleteTargets.length === 1 && (
        <DeleteConfirmDialog
          node={deleteTargets[0]}
          onClose={() => {
            setDeleteTargets(null);
            dispatch({ type: "CLEAR_SELECTION" });
          }}
        />
      )}

      {/* Batch delete — execute directly for multi */}
      {deleteTargets && deleteTargets.length > 1 && (
        <BatchDeleteDialog
          nodes={deleteTargets}
          onConfirm={() => {
            deleteTargets.forEach((n) => {
              executeCommand("field.delete", { node: n });
            });
            setDeleteTargets(null);
            dispatch({ type: "CLEAR_SELECTION" });
          }}
          onClose={() => {
            setDeleteTargets(null);
            dispatch({ type: "CLEAR_SELECTION" });
          }}
        />
      )}

      {editTarget && (
        <EditFieldModal node={editTarget} onClose={() => setEditTarget(null)} />
      )}

      {showHotkeys && <HotkeysHint onClose={() => setShowHotkeys(false)} />}
      <ToastLayer />
    </div>
  );
}

// ─── Exported wrapper with error boundary ────────────────────────────────────

export { ExplorerPanel as ExplorerPanelInner };

// Re-export wrapped version as the default export used by the IDE
const _OriginalExplorerPanel = ExplorerPanel;
export function ExplorerPanelSafe() {
  return (
    <ExplorerErrorBoundary>
      <_OriginalExplorerPanel />
    </ExplorerErrorBoundary>
  );
}

// ─── Empty placeholder ────────────────────────────────────────────────────────

function EmptyPlaceholder({ icon, label }: { icon: IconName; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "50%",
        minHeight: 120,
        color: "var(--text-faint)",
        gap: 10,
        padding: "0 24px",
        textAlign: "center",
      }}
    >
      <span style={{ opacity: 0.25 }}>
        <ExplorerIcon name={icon} size={26} strokeWidth={1.2} />
      </span>
      <span
        style={{
          fontSize: 10,
          opacity: 0.45,
          lineHeight: 1.5,
          fontFamily: "var(--font-mono)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ─── Batch delete dialog ──────────────────────────────────────────────────────

function BatchDeleteDialog({
  nodes,
  onConfirm,
  onClose,
}: {
  nodes: YamlNode[];
  onConfirm: () => void;
  onClose: () => void;
}) {
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
          width: 380,
          overflow: "hidden",
          boxShadow: "var(--shadow-modal)",
          animation: "ef-fadein 0.15s ease-out",
          padding: "20px 20px 16px",
        }}
      >
        <div
          style={{
            color: "var(--text-primary)",
            fontWeight: 500,
            fontSize: 13,
            marginBottom: 8,
          }}
        >
          Delete {nodes.length} fields?
        </div>
        <div
          style={{
            color: "var(--text-faint)",
            fontSize: 11,
            lineHeight: 1.6,
            marginBottom: 14,
            fontFamily: "var(--font-mono)",
          }}
        >
          {nodes.map((n) => n.label).join(", ")}
        </div>
        <div
          style={{
            color: "var(--ctp-yellow)",
            fontSize: 10,
            marginBottom: 16,
            fontFamily: "var(--font-mono)",
          }}
        >
          This will remove YAML files and cluster resources. This action cannot
          be undone.
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-md)",
              color: "var(--text-secondary)",
              fontSize: 11,
              cursor: "pointer",
              padding: "6px 14px",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: "rgba(243,139,168,0.12)",
              border: "1px solid rgba(243,139,168,0.25)",
              borderRadius: "var(--radius-md)",
              color: "var(--ctp-red)",
              fontSize: 11,
              cursor: "pointer",
              padding: "6px 14px",
              fontWeight: 500,
            }}
          >
            Delete {nodes.length}
          </button>
        </div>
      </div>
    </div>
  );
}
