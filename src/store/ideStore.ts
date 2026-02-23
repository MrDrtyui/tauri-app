import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import {
  DockArea,
  DockSlot,
  DropPosition,
  LayoutNode,
  SelectedEntity,
  Tab,
  TabGroupNode,
  DragState,
  WorkspaceLayout,
} from "../layout/types";
import {
  genId,
  addTabToGroup,
  removeTabFromGroup,
  replaceNode,
  removeGroup,
  collectGroups,
  findTabLocation,
  findGroupLocation,
  updateArea,
  dropPositionToSplit,
  splitGroupNode,
} from "../layout/utils";
import { DEFAULT_LAYOUT, GRAPH_ONLY_LAYOUT } from "../mock/defaultLayout";
import {
  YamlNode,
  ClusterStatus,
  FieldLayoutEntry,
  ScanResult,
  applyLayoutToNodes,
  loadEndfieldLayout,
  saveEndfieldLayout,
  getClusterStatus,
} from "./tauriStore";

// ─── Store interface ──────────────────────────────────────────────────────────

interface IDEStore {
  areas: DockArea[];
  selectedEntity: SelectedEntity | null;
  dragState: DragState;

  // ── Project / nodes ───────────────────────────────────────────────────────────
  projectPath: string | null;
  nodes: YamlNode[];
  clusterStatus: ClusterStatus | null;

  setProject: (result: ScanResult) => Promise<void>;
  closeProject: () => void;
  updateNodePosition: (id: string, x: number, y: number) => void;
  addNode: (node: YamlNode) => void;
  removeNode: (id: string) => void;
  renameNode: (id: string, newName: string) => void;
  refreshClusterStatus: () => Promise<void>;

  // ── Tab actions ──────────────────────────────────────────────────────────────
  openTab: (tab: Tab, preferSlot?: DockSlot) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (groupId: string, tabId: string) => void;
  markTabDirty: (tabId: string, dirty: boolean) => void;

  // ── Move / split / dock ──────────────────────────────────────────────────────
  moveTab: (tabId: string, targetGroupId: string) => void;
  dropTab: (tabId: string, targetGroupId: string, position: DropPosition) => void;

  // ── Area resize ──────────────────────────────────────────────────────────────
  setAreaSize: (slot: DockSlot, size: number) => void;
  setAreaVisible: (slot: DockSlot, visible: boolean) => void;
  setSplitRatio: (nodeId: string, ratio: number) => void;

  // ── Selection ────────────────────────────────────────────────────────────────
  setSelectedEntity: (entity: SelectedEntity | null) => void;

  // ── Drag ─────────────────────────────────────────────────────────────────────
  startDrag: (tab: Tab, sourceGroupId: string) => void;
  updateDragPos: (x: number, y: number) => void;
  endDrag: () => void;

  // ── Serialization ────────────────────────────────────────────────────────────
  serializeLayout: () => WorkspaceLayout;
  restoreLayout: (layout: WorkspaceLayout) => void;
  resetLayout: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function updateGroupInAreas(
  areas: DockArea[],
  groupId: string,
  updater: (g: TabGroupNode) => TabGroupNode
): DockArea[] {
  return areas.map((area) => {
    if (!area.root) return area;
    const group = findGroupInTree(area.root, groupId);
    if (!group) return area;
    const updated = updater(group);
    return { ...area, root: replaceNode(area.root, groupId, updated) };
  });
}

function findGroupInTree(
  root: LayoutNode,
  id: string
): TabGroupNode | null {
  if (root.type === "tabgroup") return root.id === id ? root : null;
  return findGroupInTree(root.first, id) || findGroupInTree(root.second, id);
}

function setSplitRatioInTree(
  root: LayoutNode,
  nodeId: string,
  ratio: number
): LayoutNode {
  if (root.type === "tabgroup") return root;
  if (root.id === nodeId) return { ...root, splitRatio: ratio };
  return {
    ...root,
    first: setSplitRatioInTree(root.first, nodeId, ratio),
    second: setSplitRatioInTree(root.second, nodeId, ratio),
  };
}

/** Get or create the primary center TabGroup */
function getOrCreateCenterGroup(areas: DockArea[]): {
  areas: DockArea[];
  groupId: string;
} {
  const center = areas.find((a) => a.slot === "center");
  if (center?.root) {
    const groups = collectGroups(center.root);
    if (groups.length > 0) return { areas, groupId: groups[0].id };
  }
  const newGroup: TabGroupNode = {
    type: "tabgroup",
    id: genId("tg"),
    tabs: [],
    activeTabId: null,
  };
  const updated = areas.map((a) =>
    a.slot === "center" ? { ...a, root: newGroup } : a
  );
  return { areas: updated, groupId: newGroup.id };
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useIDEStore = create<IDEStore>()(
  subscribeWithSelector((set, get) => ({
    areas: DEFAULT_LAYOUT.areas,
    selectedEntity: null,
    dragState: {
      isDragging: false,
      tab: null,
      sourceGroupId: null,
      x: 0,
      y: 0,
    },

    // ── Project / nodes ───────────────────────────────────────────────────────
    projectPath: null,
    nodes: [],
    clusterStatus: null,

    setProject: async (result: ScanResult) => {
      const layout = await loadEndfieldLayout(result.project_path);
      const nodes = applyLayoutToNodes(result.nodes, layout);
      // Open project with graph-only view — user opens panels via View menu
      set({ projectPath: result.project_path, nodes, areas: GRAPH_ONLY_LAYOUT.areas });
    },

    closeProject: () => {
      set({ projectPath: null, nodes: [], clusterStatus: null });
    },

    updateNodePosition: (id: string, x: number, y: number) => {
      set((state) => {
        const nodes = state.nodes.map((n) => (n.id === id ? { ...n, x, y } : n));
        // Fire-and-forget save to .endfield
        if (state.projectPath) {
          const fields: FieldLayoutEntry[] = nodes.map((n) => ({
            id: n.id,
            label: n.label,
            x: n.x,
            y: n.y,
          }));
          saveEndfieldLayout(state.projectPath, fields).catch(() => {});
        }
        return { nodes };
      });
    },

    addNode: (node: YamlNode) => {
      set((state) => {
        const nodes = [...state.nodes, node];
        if (state.projectPath) {
          const fields: FieldLayoutEntry[] = nodes.map((n) => ({
            id: n.id,
            label: n.label,
            x: n.x,
            y: n.y,
          }));
          saveEndfieldLayout(state.projectPath, fields).catch(() => {});
        }
        return { nodes };
      });
    },

    removeNode: (id: string) => {
      set((state) => ({ nodes: state.nodes.filter((n) => n.id !== id) }));
    },

    renameNode: (id: string, newName: string) => {
      set((state) => ({
        nodes: state.nodes.map((n) => n.id === id ? { ...n, label: newName } : n),
      }));
    },

    refreshClusterStatus: async () => {
      try {
        const status = await getClusterStatus();
        set({ clusterStatus: status });
      } catch {}
    },

    // ── openTab ───────────────────────────────────────────────────────────────
    openTab: (tab, preferSlot = "center") => {
      const { areas } = get();

      // Check if tab already open somewhere
      const existing = findTabLocation(areas, tab.id);
      if (existing) {
        // Just activate it
        set({
          areas: updateGroupInAreas(areas, existing.group.id, (g) => ({
            ...g,
            activeTabId: tab.id,
          })),
        });
        return;
      }

      // Find target slot
      const targetArea = areas.find((a) => a.slot === preferSlot);
      if (targetArea?.root) {
        const groups = collectGroups(targetArea.root);
        if (groups.length > 0) {
          const targetGroup = groups[0];
          set({
            areas: updateGroupInAreas(areas, targetGroup.id, (g) =>
              addTabToGroup(g, tab)
            ),
          });
          return;
        }
      }

      // Create new group in slot
      const newGroup: TabGroupNode = {
        type: "tabgroup",
        id: genId("tg"),
        tabs: [tab],
        activeTabId: tab.id,
      };
      set({
        areas: areas.map((a) =>
          a.slot === preferSlot ? { ...a, root: newGroup, visible: true } : a
        ),
      });
    },

    // ── closeTab ──────────────────────────────────────────────────────────────
    closeTab: (tabId) => {
      let { areas } = get();
      const loc = findTabLocation(areas, tabId);
      if (!loc) return;

      const updatedGroup = removeTabFromGroup(loc.group, tabId);

      if (updatedGroup.tabs.length === 0) {
        // Remove empty group from tree
        areas = areas.map((a) => {
          if (a.slot !== loc.area.slot || !a.root) return a;
          const newRoot = removeGroup(a.root, loc.group.id);
          return { ...a, root: newRoot };
        });
      } else {
        areas = updateGroupInAreas(areas, loc.group.id, () => updatedGroup);
      }

      set({ areas });
    },

    // ── setActiveTab ──────────────────────────────────────────────────────────
    setActiveTab: (groupId, tabId) => {
      set({
        areas: updateGroupInAreas(get().areas, groupId, (g) => ({
          ...g,
          activeTabId: tabId,
        })),
      });
    },

    // ── markTabDirty ──────────────────────────────────────────────────────────
    markTabDirty: (tabId, dirty) => {
      set({
        areas: get().areas.map((area) => {
          if (!area.root) return area;
          const groups = collectGroups(area.root);
          const hasTab = groups.some((g) => g.tabs.some((t) => t.id === tabId));
          if (!hasTab) return area;
          return {
            ...area,
            root: mapGroupsInTree(area.root, (g) => ({
              ...g,
              tabs: g.tabs.map((t) =>
                t.id === tabId ? { ...t, isDirty: dirty } : t
              ),
            })),
          };
        }),
      });
    },

    // ── moveTab (center drop) ─────────────────────────────────────────────────
    moveTab: (tabId, targetGroupId) => {
      let { areas } = get();
      const loc = findTabLocation(areas, tabId);
      if (!loc) return;
      if (loc.group.id === targetGroupId) return;

      const tab = loc.group.tabs.find((t) => t.id === tabId)!;

      // Remove from source
      const updatedSource = removeTabFromGroup(loc.group, tabId);
      if (updatedSource.tabs.length === 0) {
        areas = areas.map((a) => {
          if (a.slot !== loc.area.slot || !a.root) return a;
          const newRoot = removeGroup(a.root, loc.group.id);
          return { ...a, root: newRoot };
        });
      } else {
        areas = updateGroupInAreas(areas, loc.group.id, () => updatedSource);
      }

      // Add to target
      areas = updateGroupInAreas(areas, targetGroupId, (g) =>
        addTabToGroup(g, tab)
      );

      set({ areas });
    },

    // ── dropTab (with split support) ──────────────────────────────────────────
    dropTab: (tabId, targetGroupId, position) => {
      if (position === "center") {
        get().moveTab(tabId, targetGroupId);
        return;
      }

      let { areas } = get();
      const loc = findTabLocation(areas, tabId);
      if (!loc) return;
      const tab = loc.group.tabs.find((t) => t.id === tabId)!;

      // Remove tab from source group
      const updatedSource = removeTabFromGroup(loc.group, tabId);
      if (updatedSource.tabs.length === 0) {
        areas = areas.map((a) => {
          if (a.slot !== loc.area.slot || !a.root) return a;
          const newRoot = removeGroup(a.root, loc.group.id);
          return { ...a, root: newRoot };
        });
      } else {
        areas = updateGroupInAreas(areas, loc.group.id, () => updatedSource);
      }

      // Find target group and split it
      const targetLoc = findGroupLocation(areas, targetGroupId);
      if (!targetLoc) { set({ areas }); return; }

      const splitInfo = dropPositionToSplit(position)!;
      const newSplit = splitGroupNode(
        targetLoc.group,
        splitInfo.direction,
        splitInfo.newGroupFirst,
        tab
      );

      areas = areas.map((a) => {
        if (a.slot !== targetLoc.area.slot || !a.root) return a;
        return { ...a, root: replaceNode(a.root, targetGroupId, newSplit) };
      });

      set({ areas });
    },

    // ── Area resize ───────────────────────────────────────────────────────────
    setAreaSize: (slot, size) => {
      set({ areas: updateArea(get().areas, slot, (a) => ({ ...a, size })) });
    },

    setAreaVisible: (slot, visible) => {
      set({ areas: updateArea(get().areas, slot, (a) => ({ ...a, visible })) });
    },

    setSplitRatio: (nodeId, ratio) => {
      set({
        areas: get().areas.map((area) => {
          if (!area.root) return area;
          return { ...area, root: setSplitRatioInTree(area.root, nodeId, ratio) };
        }),
      });
    },

    // ── Selection ─────────────────────────────────────────────────────────────
    setSelectedEntity: (entity) => set({ selectedEntity: entity }),

    // ── Drag ──────────────────────────────────────────────────────────────────
    startDrag: (tab, sourceGroupId) => {
      set({
        dragState: {
          isDragging: true,
          tab,
          sourceGroupId,
          x: 0,
          y: 0,
        },
      });
    },

    updateDragPos: (x, y) => {
      set((s) => ({ dragState: { ...s.dragState, x, y } }));
    },

    endDrag: () => {
      set({
        dragState: {
          isDragging: false,
          tab: null,
          sourceGroupId: null,
          x: 0,
          y: 0,
        },
      });
    },

    // ── Serialization ──────────────────────────────────────────────────────────
    serializeLayout: () => ({
      version: 1,
      areas: get().areas,
    }),

    restoreLayout: (layout) => {
      if (layout.version === 1) {
        set({ areas: layout.areas });
      }
    },

    resetLayout: () => {
      set({ areas: DEFAULT_LAYOUT.areas });
    },
  }))
);

// ─── Tree mapper helper ───────────────────────────────────────────────────────

function mapGroupsInTree(
  root: LayoutNode,
  fn: (g: TabGroupNode) => TabGroupNode
): LayoutNode {
  if (root.type === "tabgroup") return fn(root);
  return {
    ...root,
    first: mapGroupsInTree(root.first, fn),
    second: mapGroupsInTree(root.second, fn),
  };
}
