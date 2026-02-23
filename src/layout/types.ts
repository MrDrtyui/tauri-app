// ─── Tab Content Types ────────────────────────────────────────────────────────

export type TabContentType =
  | "file"
  | "graph"
  | "clusterDiff"
  | "clusterLogs"
  | "inspector"
  | "explorer"
  | "welcome"
  | "deployImage";

export interface Tab {
  id: string;
  title: string;
  contentType: TabContentType;
  /** For "file" tabs: the file path */
  filePath?: string;
  /** For "graph" tabs: optional graph id */
  graphId?: string;
  isDirty?: boolean;
  icon?: string;
}

// ─── Layout Node Types ────────────────────────────────────────────────────────

export type SplitDirection = "horizontal" | "vertical";
export type DockSlot = "left" | "center" | "right" | "bottom";
export type DropPosition = "center" | "top" | "bottom" | "left" | "right";

export interface TabGroupNode {
  type: "tabgroup";
  id: string;
  tabs: Tab[];
  activeTabId: string | null;
}

export interface SplitNode {
  type: "split";
  id: string;
  direction: SplitDirection;
  /** 0..1, ratio of first child */
  splitRatio: number;
  first: LayoutNode;
  second: LayoutNode;
}

export type LayoutNode = TabGroupNode | SplitNode;

export interface DockArea {
  slot: DockSlot;
  /** Size in px (width for left/right, height for bottom) */
  size: number;
  visible: boolean;
  root: LayoutNode | null;
}

// ─── Workspace Layout (serializable) ─────────────────────────────────────────

export interface WorkspaceLayout {
  version: 1;
  areas: DockArea[];
}

// ─── Selection / Entity ───────────────────────────────────────────────────────

export type EntityType = "file" | "field" | "graphNode" | "none";

export interface SelectedEntity {
  type: EntityType;
  id: string;
  label: string;
  /** file path if applicable */
  filePath?: string;
  /** extra metadata */
  meta?: Record<string, unknown>;
}

// ─── Drag State ───────────────────────────────────────────────────────────────

export interface DragState {
  isDragging: boolean;
  tab: Tab | null;
  sourceGroupId: string | null;
  /** Current mouse position */
  x: number;
  y: number;
}
