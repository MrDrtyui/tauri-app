/**
 * AppIcon — the ONLY icon component used across the entire Endfield application.
 *
 * Rules:
 *  - Zero emoji in any file. Use <AppIcon name="..." /> instead.
 *  - All icon names are semantic (NOT visual descriptions).
 *  - One import point. Do not import lucide icons directly in UI components.
 *  - Colors via design tokens only — never hardcoded.
 */

import React from "react";
import {
  // Cluster / Kubernetes
  Server,
  Box,
  Cpu,
  Layers,
  SquareStack,
  Rocket,
  Database,
  Globe,
  FileCode,
  Lock,
  HardDrive,
  Network,
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
  Zap,
  Radio,
  RefreshCw,
  // Dev / UI
  Terminal,
  BarChart3,
  Settings,
  Puzzle,
  Folder,
  FolderOpen,
  File,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Plus,
  Minus,
  X,
  Check,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  Eye,
  EyeOff,
  Edit2,
  Trash2,
  Copy,
  ExternalLink,
  ArrowRight,
  ArrowLeft,
  RotateCcw,
  Play,
  Pause,
  Square,
  MoreHorizontal,
  MoreVertical,
  SlidersHorizontal,
  Maximize2,
  Minimize2,
  GitBranch,
  GitCompare,
  GitMerge,
  Upload,
  Download,
  FolderOpen as FolderOpenIcon,
  Layers as LayersIcon,
  Layout,
  Cpu as CpuIcon,
  MonitorCheck,
  type LucideIcon,
} from "lucide-react";

// ─── Registry ─────────────────────────────────────────────────────

export type AppIconName =
  // ── Kubernetes / cluster
  | "cluster"
  | "namespace"
  | "node"
  | "pod"
  | "container"
  | "deployment"
  | "statefulset"
  | "daemonset"
  | "service"
  | "ingress"
  | "configmap"
  | "secret"
  | "persistentVolume"
  // ── Helm
  | "helm"
  | "helmRelease"
  | "chart"
  // ── Infra type buckets (YamlNode.type_id)
  | "gateway"
  | "serviceType"
  | "database"
  | "cache"
  | "queue"
  | "monitoring"
  | "infra"
  // ── Named infra services
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
  // ── File tree
  | "folder"
  | "folderOpen"
  | "file"
  | "fileYaml"
  | "fileHelm"
  // ── Dev panels
  | "logs"
  | "diff"
  | "events"
  | "metrics"
  | "terminal"
  | "graph"
  | "explorer"
  | "inspector"
  | "settings"
  | "extensions"
  | "search"
  | "deploy"
  | "deployImage"
  | "welcome"
  // ── Actions
  | "add"
  | "remove"
  | "close"
  | "confirm"
  | "edit"
  | "rename"
  | "delete"
  | "copy"
  | "openExternal"
  | "refresh"
  | "reset"
  | "openYaml"
  | "openInExplorer"
  | "properties"
  | "play"
  | "pause"
  | "stop"
  | "upload"
  | "download"
  | "expand"
  | "collapse"
  | "maximize"
  | "minimize"
  // ── Navigation
  | "chevronRight"
  | "chevronDown"
  | "chevronLeft"
  | "chevronUp"
  | "arrowRight"
  | "arrowLeft"
  | "back"
  // ── Status
  | "success"
  | "warning"
  | "error"
  | "info"
  | "statusDot"
  // ── UI chrome
  | "menu"
  | "more"
  | "moreVertical"
  | "sliders"
  | "layout"
  // ── Misc
  | "fitView"
  | "gitBranch"
  | "gitDiff"
  | "gitMerge"
  | "default";

const REGISTRY: Record<AppIconName, LucideIcon> = {
  // Kubernetes / cluster
  cluster: Server,
  namespace: Box,
  node: Cpu,
  pod: Box,
  container: SquareStack,
  deployment: Rocket,
  statefulset: Database,
  daemonset: Layers,
  service: Network,
  ingress: Globe,
  configmap: FileCode,
  secret: Lock,
  persistentVolume: HardDrive,

  // Helm
  helm: Package,
  helmRelease: Package,
  chart: Archive,

  // Infra type buckets
  gateway: Globe,
  serviceType: Network,
  database: Database,
  cache: Zap,
  queue: Activity,
  monitoring: Gauge,
  infra: Package,

  // Named infra services
  redis: Zap,
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

  // File tree
  folder: Folder,
  folderOpen: FolderOpen,
  file: File,
  fileYaml: FileCode,
  fileHelm: Package,

  // Dev panels
  logs: Terminal,
  diff: GitCompare,
  events: Activity,
  metrics: BarChart3,
  terminal: Terminal,
  graph: Network,
  explorer: Folder,
  inspector: SlidersHorizontal,
  settings: Settings,
  extensions: Puzzle,
  search: Search,
  deploy: Rocket,
  deployImage: Upload,
  welcome: Layout,

  // Actions
  add: Plus,
  remove: Minus,
  close: X,
  confirm: Check,
  edit: Edit2,
  rename: Edit2,
  delete: Trash2,
  copy: Copy,
  openExternal: ExternalLink,
  refresh: RefreshCw,
  reset: RotateCcw,
  openYaml: FileCode,
  openInExplorer: Folder,
  properties: SlidersHorizontal,
  play: Play,
  pause: Pause,
  stop: Square,
  upload: Upload,
  download: Download,
  expand: ChevronDown,
  collapse: ChevronRight,
  maximize: Maximize2,
  minimize: Minimize2,

  // Navigation
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronUp: ChevronUp,
  arrowRight: ArrowRight,
  arrowLeft: ArrowLeft,
  back: ChevronLeft,

  // Status
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
  info: Info,
  statusDot: MonitorCheck,

  // UI chrome
  menu: MoreHorizontal,
  more: MoreHorizontal,
  moreVertical: MoreVertical,
  sliders: SlidersHorizontal,
  layout: Layout,

  // Misc
  fitView: Maximize2,
  gitBranch: GitBranch,
  gitDiff: GitCompare,
  gitMerge: GitMerge,

  default: Radio,
};

// ─── Status color tokens ──────────────────────────────────────────

export const STATUS_COLOR: Record<string, string> = {
  success: "var(--status-ok)",
  warning: "var(--status-warn)",
  error: "var(--status-error)",
  info: "var(--accent)",
  muted: "var(--text-muted)",
  faint: "var(--text-faint)",
  accent: "var(--accent)",
  default: "var(--text-muted)",
};

// ─── Node type → icon name ────────────────────────────────────────

export function resolveNodeIconName(
  typeId: string,
  label?: string,
  source?: string,
): AppIconName {
  if (source === "helm") return "helmRelease";
  const direct = typeId as AppIconName;
  if (direct in REGISTRY) return direct;
  if (label) {
    const l = label.toLowerCase();
    if (l.includes("redis")) return "redis";
    if (l.includes("kafka") || l.includes("redpanda")) return "kafka";
    if (l.includes("postgres")) return "postgres";
    if (l.includes("clickhouse")) return "clickhouse";
    if (l.includes("minio")) return "minio";
    if (l.includes("opensearch") || l.includes("elastic")) return "opensearch";
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

// ─── AppIcon component ────────────────────────────────────────────

export interface AppIconProps {
  name: AppIconName;
  size?: number;
  strokeWidth?: number;
  color?: string; // CSS color or token string
  style?: React.CSSProperties;
}

export function AppIcon({
  name,
  size = 14,
  strokeWidth = 1.75,
  color,
  style,
}: AppIconProps) {
  const Icon = REGISTRY[name] ?? REGISTRY.default;
  return (
    <Icon
      size={size}
      strokeWidth={strokeWidth}
      style={{ flexShrink: 0, color, ...style }}
    />
  );
}

// ─── Convenience: content-type to icon name ───────────────────────

export const CONTENT_TYPE_ICON: Record<string, AppIconName> = {
  explorer: "explorer",
  file: "fileYaml",
  graph: "graph",
  inspector: "inspector",
  clusterDiff: "diff",
  clusterLogs: "logs",
  welcome: "welcome",
  deployImage: "deployImage",
};

export function contentTypeIcon(ct: string): AppIconName {
  return CONTENT_TYPE_ICON[ct] ?? "file";
}

// ─── Node color resolver ──────────────────────────────────────────

export function resolveNodeColor(typeId: string, source?: string): string {
  if (source === "helm") return "var(--ctp-mauve)";
  switch (typeId) {
    case "gateway":
      return "var(--ctp-blue)";
    case "database":
      return "var(--ctp-peach)";
    case "cache":
      return "var(--ctp-yellow)";
    case "queue":
      return "var(--ctp-teal)";
    case "monitoring":
      return "var(--ctp-green)";
    case "infra":
      return "var(--ctp-lavender)";
    case "service":
    default:
      return "var(--ctp-sapphire)";
  }
}
