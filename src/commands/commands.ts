/**
 * Command system — all IDE actions go through here.
 * Allows future Command Palette integration.
 */
import { useIDEStore } from "../store/ideStore";
import {
  YamlNode,
  deleteFieldFiles,
  removeResource,
} from "../store/tauriStore";

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
        },
      });
      // openTab handles both: re-activating existing tab AND re-opening after close
      store.openTab(
        {
          id: "tab-explorer",
          title: "Explorer",
          contentType: "explorer",
          icon: "explorer",
        },
        "left",
      );
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
            icon: filePath.includes("Chart.yaml") ? "helmRelease" : "fileYaml",
          },
          "center",
        );
      } else {
        // Create placeholder tab for nodes without a file
        store.openTab(
          {
            id: `file-placeholder-${node.id}`,
            title: `${node.label}.yaml`,
            contentType: "file",
            filePath: undefined,
            icon: "fileYaml",
          },
          "center",
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
      // openTab handles both: re-activating existing tab AND re-opening after close
      store.openTab(
        {
          id: "tab-inspector",
          title: "Properties",
          contentType: "inspector",
          icon: "inspector",
        },
        "right",
      );
      break;
    }

    case "field.logs": {
      store.openTab(
        {
          id: "tab-logs",
          title: "Logs",
          contentType: "clusterLogs",
          icon: "clusterLogs",
        },
        "bottom",
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
          icon: "clusterDiff",
        },
        "bottom",
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
      const filePath = node.file_path;
      const namespace = node.namespace ?? "default";

      // 1. Remove from cluster (kubectl delete -f / helm uninstall)
      if (filePath) {
        // For helm nodes the resourceDir is the parent of /helm/
        // For raw nodes it's the directory containing the yaml file
        const resourceDir = filePath.includes("/helm/")
          ? filePath.substring(0, filePath.lastIndexOf("/helm/") + 1)
          : filePath.substring(0, filePath.lastIndexOf("/") + 1);

        removeResource(
          node.id,
          node.source,
          resourceDir,
          namespace,
          node.helm?.release_name,
        ).catch((err) => console.error("[delete] removeResource failed:", err));
      }

      // 2. Delete files from disk
      if (filePath) {
        // For helm: delete the whole component dir (parent of /helm/)
        // For raw: delete just the yaml file
        const filesToDelete = filePath.includes("/helm/")
          ? [filePath.substring(0, filePath.lastIndexOf("/helm/") + 1)]
          : [filePath];

        deleteFieldFiles(filesToDelete, namespace).catch((err) =>
          console.error("[delete] deleteFieldFiles failed:", err),
        );
      }

      // 3. Close open tabs for this node
      if (filePath) store.closeTab(`file-${filePath}`);
      store.closeTab(`file-placeholder-${node.id}`);

      // 4. Deselect if this node was selected
      const sel = store.selectedEntity;
      if (sel && (sel.id === node.id || sel.filePath === node.file_path)) {
        store.setSelectedEntity(null);
      }

      // 5. Remove from IDE store
      store.removeNode(node.id);
      break;
    }
  }
}
