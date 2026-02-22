import { WorkspaceLayout, TabGroupNode } from "../layout/types";

// ─── Default TabGroups ────────────────────────────────────────────────────────

const explorerGroup: TabGroupNode = {
  type: "tabgroup",
  id: "tg-explorer",
  tabs: [
    {
      id: "tab-explorer",
      title: "Explorer",
      contentType: "explorer",
      icon: "📁",
    },
  ],
  activeTabId: "tab-explorer",
};

const centerGroup: TabGroupNode = {
  type: "tabgroup",
  id: "tg-center",
  tabs: [
    {
      id: "tab-welcome",
      title: "Welcome",
      contentType: "welcome",
      icon: "✦",
    },
    {
      id: "tab-graph",
      title: "Graph",
      contentType: "graph",
      icon: "⬡",
    },
  ],
  activeTabId: "tab-graph",
};

const inspectorGroup: TabGroupNode = {
  type: "tabgroup",
  id: "tg-inspector",
  tabs: [
    {
      id: "tab-inspector",
      title: "Inspector",
      contentType: "inspector",
      icon: "◈",
    },
  ],
  activeTabId: "tab-inspector",
};

const bottomGroup: TabGroupNode = {
  type: "tabgroup",
  id: "tg-bottom",
  tabs: [
    {
      id: "tab-diff",
      title: "Cluster Diff",
      contentType: "clusterDiff",
      icon: "⊞",
    },
    {
      id: "tab-logs",
      title: "Logs",
      contentType: "clusterLogs",
      icon: "≡",
    },
  ],
  activeTabId: "tab-diff",
};

// ─── Default workspace layout ─────────────────────────────────────────────────

export const DEFAULT_LAYOUT: WorkspaceLayout = {
  version: 1,
  areas: [
    {
      slot: "left",
      size: 260,
      visible: true,
      root: explorerGroup,
    },
    {
      slot: "center",
      size: 0, // fills remaining space
      visible: true,
      root: centerGroup,
    },
    {
      slot: "right",
      size: 300,
      visible: true,
      root: inspectorGroup,
    },
    {
      slot: "bottom",
      size: 220,
      visible: true,
      root: bottomGroup,
    },
  ],
};

// ─── Example serialized layout (for docs / README) ───────────────────────────

export const EXAMPLE_LAYOUT_JSON = {
  version: 1,
  areas: [
    {
      slot: "left",
      size: 260,
      visible: true,
      root: {
        type: "tabgroup",
        id: "tg-explorer",
        tabs: [{ id: "tab-explorer", title: "Explorer", contentType: "explorer" }],
        activeTabId: "tab-explorer",
      },
    },
    {
      slot: "center",
      size: 0,
      visible: true,
      root: {
        type: "split",
        id: "split-center-1",
        direction: "horizontal",
        splitRatio: 0.55,
        first: {
          type: "tabgroup",
          id: "tg-center-editor",
          tabs: [
            { id: "tab-file-1", title: "auth-deployment.yaml", contentType: "file", filePath: "/infra/apps/auth-deployment.yaml" },
            { id: "tab-file-2", title: "postgres-statefulset.yaml", contentType: "file", filePath: "/infra/databases/postgres-statefulset.yaml" },
          ],
          activeTabId: "tab-file-1",
        },
        second: {
          type: "tabgroup",
          id: "tg-center-graph",
          tabs: [{ id: "tab-graph", title: "Graph", contentType: "graph" }],
          activeTabId: "tab-graph",
        },
      },
    },
    {
      slot: "right",
      size: 300,
      visible: true,
      root: {
        type: "tabgroup",
        id: "tg-inspector",
        tabs: [{ id: "tab-inspector", title: "Inspector", contentType: "inspector" }],
        activeTabId: "tab-inspector",
      },
    },
    {
      slot: "bottom",
      size: 220,
      visible: true,
      root: {
        type: "tabgroup",
        id: "tg-bottom",
        tabs: [
          { id: "tab-diff", title: "Cluster Diff", contentType: "clusterDiff" },
          { id: "tab-logs", title: "Logs", contentType: "clusterLogs" },
        ],
        activeTabId: "tab-diff",
      },
    },
  ],
};
