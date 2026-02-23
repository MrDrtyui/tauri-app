/**
 * Command system — all IDE actions go through here.
 * Allows future Command Palette integration.
 */
import { useIDEStore } from "../store/ideStore";
import { YamlNode } from "../store/tauriStore";

export type CommandId =
  | "field.openYaml"
  | "field.openInExplorer"
  | "field.properties"
  | "field.logs"
  | "field.diff"
  | "field.rename"
  | "field.delete";

export interface CommandPayload {
  node: YamlNode;
  /** Optional new name for rename */
  newName?: string;
}

export function executeCommand(id: CommandId, payload: CommandPayload) {
  const store = useIDEStore.getState();
  const { node } = payload;

  switch (id) {
    case "field.openInExplorer": {
      // Make sure explorer is visible and select the node
      store.setAreaVisible("left", true);
      store.setSelectedEntity({
        type: "field",
        id: node.id,
        label: node.label,
        filePath: node.file_path,
        meta: { kind: node.kind, typeId: node.type_id, namespace: node.namespace, source: node.source },
      });
      break;
    }

    case "field.openYaml": {
      const filePath = node.file_path;
      if (filePath) {
        store.openTab(
          {
            id: `file-${filePath}`,
            title: filePath.split("/").pop() ?? node.label,
            contentType: "file",
            filePath,
            icon: filePath.includes("Chart.yaml") ? "⛵" : "📄",
          },
          "center"
        );
      } else {
        // Create placeholder tab for nodes without a file
        store.openTab(
          {
            id: `file-placeholder-${node.id}`,
            title: `${node.label}.yaml`,
            contentType: "file",
            filePath: undefined,
            icon: "📄",
          },
          "center"
        );
      }
      break;
    }

    case "field.properties": {
      store.setSelectedEntity({
        type: "field",
        id: node.id,
        label: node.label,
        filePath: node.file_path,
        meta: {
          kind: node.kind,
          typeId: node.type_id,
          namespace: node.namespace,
          source: node.source,
          replicas: node.replicas,
          image: node.image,
        },
      });
      // Ensure inspector is visible
      store.setAreaVisible("right", true);
      break;
    }

    case "field.logs": {
      store.openTab(
        {
          id: "tab-logs",
          title: "Logs",
          contentType: "clusterLogs",
          icon: "≡",
        },
        "bottom"
      );
      store.setAreaVisible("bottom", true);
      break;
    }

    case "field.diff": {
      store.openTab(
        {
          id: "tab-diff",
          title: "Cluster Diff",
          contentType: "clusterDiff",
          icon: "⊞",
        },
        "bottom"
      );
      store.setAreaVisible("bottom", true);
      break;
    }

    case "field.rename": {
      if (payload.newName && payload.newName.trim()) {
        store.renameNode(node.id, payload.newName.trim());
      }
      break;
    }

    case "field.delete": {
      // Close all tabs associated with this node
      const state = useIDEStore.getState();
      const filePath = node.file_path;
      if (filePath) {
        const tabId = `file-${filePath}`;
        state.closeTab(tabId);
      }
      state.closeTab(`file-placeholder-${node.id}`);
      // Deselect if this node was selected
      const sel = state.selectedEntity;
      if (sel && (sel.id === node.id || sel.filePath === node.file_path)) {
        state.setSelectedEntity(null);
      }
      store.removeNode(node.id);
      break;
    }
  }
}
