/**
 * ExplorerIcons — centralized infrastructure-aware icon registry.
 * All icons are Lucide thin-stroke SVGs. Zero emoji.
 */

import React from "react";
import {
  // Cluster
  Server,
  Box,
  Cpu,
  Layers,
  SquareStack,
  // Kubernetes
  Rocket,
  Database,
  Globe,
  FileCode,
  Lock,
  HardDrive,
  Network,
  Repeat,
  // Helm
  Package,
  Archive,
  // Infra services
  Activity,
  Search,
  LineChart,
  Gauge,
  Timer,
  FileText,
  ShieldCheck,
  // Dev / misc
  Terminal,
  BarChart3,
  Settings,
  Puzzle,
  Folder,
  FolderOpen,
  File,
  ChevronRight,
  ChevronDown,
  Plus,
  Zap,
  RefreshCw,
} from "lucide-react";

export type IconName =
  // cluster
  | "cluster"
  | "namespace"
  | "node"
  | "pod"
  | "container"
  // kubernetes
  | "deployment"
  | "statefulset"
  | "daemonset"
  | "service"
  | "ingress"
  | "configmap"
  | "secret"
  | "persistentvolume"
  // helm
  | "helmRelease"
  | "chart"
  // infra
  | "redis"
  | "kafka"
  | "postgres"
  | "clickhouse"
  | "minio"
  | "opensearch"
  | "prometheus"
  | "grafana"
  | "tempo"
  | "loki"
  | "keycloak"
  // type_id buckets
  | "gateway"
  | "cache"
  | "queue"
  | "monitoring"
  | "infra"
  // dev
  | "logs"
  | "events"
  | "metrics"
  | "settings"
  | "extensions"
  | "search"
  // file tree
  | "folder"
  | "folderOpen"
  | "file"
  | "fileYaml"
  | "fileHelm"
  // ui
  | "chevronRight"
  | "chevronDown"
  | "add"
  | "deploy"
  | "refresh"
  // fallback
  | "default";

type LucideComponent = React.ComponentType<{
  size?: number;
  strokeWidth?: number;
  style?: React.CSSProperties;
}>;

export const ICON_MAP: Record<IconName, LucideComponent> = {
  // Cluster
  cluster: Server,
  namespace: Box,
  node: Cpu,
  pod: Box,
  container: SquareStack,

  // Kubernetes
  deployment: Rocket,
  statefulset: Database,
  daemonset: Layers,
  service: Network,
  ingress: Globe,
  configmap: FileCode,
  secret: Lock,
  persistentvolume: HardDrive,

  // Helm
  helmRelease: Package,
  chart: Archive,

  // Named infra services
  redis: Database,
  kafka: Activity,
  postgres: Database,
  clickhouse: Database,
  minio: HardDrive,
  opensearch: Search,
  prometheus: LineChart,
  grafana: Gauge,
  tempo: Timer,
  loki: FileText,
  keycloak: ShieldCheck,

  // type_id buckets (used by YamlNode.type_id)
  gateway: Globe,
  cache: Zap,
  queue: Activity,
  monitoring: Gauge,
  infra: Package,

  // Dev
  logs: Terminal,
  events: Activity,
  metrics: BarChart3,
  settings: Settings,
  extensions: Puzzle,
  search: Search,

  // File tree
  folder: Folder,
  folderOpen: FolderOpen,
  file: File,
  fileYaml: FileCode,
  fileHelm: Package,

  // UI helpers
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  add: Plus,
  deploy: Rocket,
  refresh: RefreshCw,

  // Fallback
  default: Repeat,
};

interface ExplorerIconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  style?: React.CSSProperties;
  className?: string;
}

export function ExplorerIcon({
  name,
  size = 14,
  strokeWidth = 1.75,
  style,
}: ExplorerIconProps) {
  const IconComponent = ICON_MAP[name] ?? ICON_MAP.default;
  return (
    <IconComponent
      size={size}
      strokeWidth={strokeWidth}
      style={{ flexShrink: 0, ...style }}
    />
  );
}

// ── Maps for dynamic resolution ──────────────────────────────────

/**
 * Resolves icon name from YamlNode.type_id.
 * Falls back through label matching, then "default".
 */
export function resolveNodeIcon(
  typeId: string,
  label?: string,
  source?: string,
): IconName {
  // Helm releases always get the helm icon
  if (source === "helm") return "helmRelease";

  // Direct type_id match
  const direct = typeId as IconName;
  if (direct in ICON_MAP) return direct;

  // Label-based heuristics for named services
  if (label) {
    const l = label.toLowerCase();
    if (l.includes("redis")) return "redis";
    if (l.includes("kafka")) return "kafka";
    if (l.includes("postgres")) return "postgres";
    if (l.includes("clickhouse")) return "clickhouse";
    if (l.includes("minio")) return "minio";
    if (l.includes("opensearch")) return "opensearch";
    if (l.includes("prometheus")) return "prometheus";
    if (l.includes("grafana")) return "grafana";
    if (l.includes("tempo")) return "tempo";
    if (l.includes("loki")) return "loki";
    if (l.includes("keycloak")) return "keycloak";
    if (l.includes("nginx") || l.includes("ingress") || l.includes("traefik"))
      return "gateway";
  }

  return "default";
}

/**
 * Color tokens for each type_id group.
 */
export const NODE_COLOR: Record<string, string> = {
  gateway: "var(--node-gateway)",
  service: "var(--node-service)",
  database: "var(--node-database)",
  cache: "var(--node-cache)",
  queue: "var(--node-queue)",
  monitoring: "var(--node-monitoring)",
  infra: "var(--node-infra)",
  default: "var(--text-muted)",
};

export function resolveNodeColor(typeId: string): string {
  return NODE_COLOR[typeId] ?? NODE_COLOR.default;
}
