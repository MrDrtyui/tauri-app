import {
  LayoutNode,
  TabGroupNode,
  SplitNode,
  SplitDirection,
  DockArea,
  Tab,
  DropPosition,
} from "./types";

// ─── ID generation ────────────────────────────────────────────────────────────

let _idCounter = 0;
export function genId(prefix = "id"): string {
  return `${prefix}_${Date.now()}_${++_idCounter}`;
}

// ─── Tree traversal ───────────────────────────────────────────────────────────

/** Find a TabGroupNode by id anywhere in the tree */
export function findGroup(
  root: LayoutNode | null,
  groupId: string
): TabGroupNode | null {
  if (!root) return null;
  if (root.type === "tabgroup") return root.id === groupId ? root : null;
  return findGroup(root.first, groupId) || findGroup(root.second, groupId);
}

/** Replace a node by id, returning new tree */
export function replaceNode(
  root: LayoutNode,
  targetId: string,
  replacement: LayoutNode
): LayoutNode {
  if (root.id === targetId) return replacement;
  if (root.type === "tabgroup") return root;
  return {
    ...root,
    first: replaceNode(root.first, targetId, replacement),
    second: replaceNode(root.second, targetId, replacement),
  };
}

/** Remove a TabGroup by id. Returns null if tree becomes empty. */
export function removeGroup(
  root: LayoutNode,
  groupId: string
): LayoutNode | null {
  if (root.type === "tabgroup") {
    return root.id === groupId ? null : root;
  }
  const newFirst = removeGroup(root.first, groupId);
  const newSecond = removeGroup(root.second, groupId);
  if (!newFirst && !newSecond) return null;
  if (!newFirst) return newSecond;
  if (!newSecond) return newFirst;
  return { ...root, first: newFirst, second: newSecond };
}

/** Collect all TabGroupNodes in order */
export function collectGroups(root: LayoutNode | null): TabGroupNode[] {
  if (!root) return [];
  if (root.type === "tabgroup") return [root];
  return [...collectGroups(root.first), ...collectGroups(root.second)];
}

// ─── Tab operations ───────────────────────────────────────────────────────────

export function addTabToGroup(group: TabGroupNode, tab: Tab): TabGroupNode {
  const exists = group.tabs.find((t) => t.id === tab.id);
  if (exists) return { ...group, activeTabId: tab.id };
  return { ...group, tabs: [...group.tabs, tab], activeTabId: tab.id };
}

export function removeTabFromGroup(
  group: TabGroupNode,
  tabId: string
): TabGroupNode {
  const tabs = group.tabs.filter((t) => t.id !== tabId);
  let activeTabId = group.activeTabId;
  if (activeTabId === tabId) {
    const idx = group.tabs.findIndex((t) => t.id === tabId);
    activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
  }
  return { ...group, tabs, activeTabId };
}

// ─── Split operation ──────────────────────────────────────────────────────────

/** Split a TabGroup: existing stays on one side, new group on other side */
export function splitGroupNode(
  group: TabGroupNode,
  direction: SplitDirection,
  newGroupFirst: boolean,
  newTab?: Tab
): SplitNode {
  const newGroup: TabGroupNode = {
    type: "tabgroup",
    id: genId("tg"),
    tabs: newTab ? [newTab] : [],
    activeTabId: newTab?.id ?? null,
  };
  return {
    type: "split",
    id: genId("split"),
    direction,
    splitRatio: 0.5,
    first: newGroupFirst ? newGroup : group,
    second: newGroupFirst ? group : newGroup,
  };
}

/** Map drop position to split direction and side */
export function dropPositionToSplit(pos: DropPosition): {
  direction: SplitDirection;
  newGroupFirst: boolean;
} | null {
  switch (pos) {
    case "top":
      return { direction: "vertical", newGroupFirst: true };
    case "bottom":
      return { direction: "vertical", newGroupFirst: false };
    case "left":
      return { direction: "horizontal", newGroupFirst: true };
    case "right":
      return { direction: "horizontal", newGroupFirst: false };
    default:
      return null;
  }
}

// ─── Area helpers ─────────────────────────────────────────────────────────────

export function updateArea(
  areas: DockArea[],
  slot: string,
  updater: (area: DockArea) => DockArea
): DockArea[] {
  return areas.map((a) => (a.slot === slot ? updater(a) : a));
}

/** Find which area + group contains a tab */
export function findTabLocation(
  areas: DockArea[],
  tabId: string
): { area: DockArea; group: TabGroupNode } | null {
  for (const area of areas) {
    if (!area.root) continue;
    const groups = collectGroups(area.root);
    for (const group of groups) {
      if (group.tabs.some((t) => t.id === tabId)) {
        return { area, group };
      }
    }
  }
  return null;
}

/** Find which area + group has the given groupId */
export function findGroupLocation(
  areas: DockArea[],
  groupId: string
): { area: DockArea; group: TabGroupNode } | null {
  for (const area of areas) {
    if (!area.root) continue;
    const group = findGroup(area.root, groupId);
    if (group) return { area, group };
  }
  return null;
}
