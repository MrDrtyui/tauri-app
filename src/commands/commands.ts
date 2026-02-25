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
      // Resolve which pod to show:
      // - raw node: find exact cluster field by label, pick first pod
      // - helm node: match workloads by release name, pick first pod across all workloads
      const clusterStatus = store.clusterStatus;
      const clusterFields = clusterStatus?.fields ?? [];

      let targetPod: { name: string; namespace: string } | null = null;

      if (node) {
        if (node.source === "helm") {
          const releaseName = (
            node.helm?.release_name ?? node.label
          ).toLowerCase();
          const helmFields = clusterFields.filter((f) => {
            const n = f.label.toLowerCase();
            return (
              n === releaseName ||
              n.startsWith(releaseName + "-") ||
              n.startsWith(releaseName + "_") ||
              releaseName.startsWith(n + "-") ||
              releaseName.startsWith(n + "_") ||
              n.includes(releaseName) ||
              releaseName.includes(n)
            );
          });
          // Pick first running pod from any workload
          for (const f of helmFields) {
            const running =
              f.pods.find((p) => p.phase === "Running") ?? f.pods[0];
            if (running) {
              targetPod = { name: running.name, namespace: running.namespace };
              break;
            }
          }
        } else {
          const field = clusterFields.find((f) => f.label === node.label);
          if (field) {
            const running =
              field.pods.find((p) => p.phase === "Running") ?? field.pods[0];
            if (running)
              targetPod = { name: running.name, namespace: running.namespace };
          }
        }
      }

      if (targetPod) store.setSelectedLogPod(targetPod);

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

      // 1. Close open tabs and deselect immediately
      if (filePath) store.closeTab(`file-${filePath}`);
      store.closeTab(`file-placeholder-${node.id}`);
      const sel = store.selectedEntity;
      if (sel && (sel.id === node.id || sel.filePath === node.file_path)) {
        store.setSelectedEntity(null);
      }

      // 2. Remove from IDE store (optimistic UI)
      store.removeNode(node.id);

      if (!filePath) break;

      // For helm: file_path = "/project/infra/nginx/helm/Chart.yaml"
      //   → componentDir = "/project/infra/nginx"  (delete entire component dir)
      // For raw: file_path = "/project/apps/mongodbasdfaaaaa/deployment.yaml"
      //   → parentDir = "/project/apps/mongodbasdfaaaaa" (delete entire service dir)
      //   A service folder may contain deployment.yaml, service.yaml, configmap.yaml etc.
      const isHelm = node.source === "helm";
      const parentDir = filePath.substring(0, filePath.lastIndexOf("/"));
      const componentDir = isHelm
        ? filePath.substring(0, filePath.lastIndexOf("/helm/"))
        : parentDir;
      const resourceDir = componentDir;
      const filesToDelete = [componentDir];

      console.log("[delete] node:", node.id, "source:", node.source);
      console.log("[delete] filesToDelete:", filesToDelete);
      console.log("[delete] resourceDir:", resourceDir);

      // 3. Delete files from disk
      deleteFieldFiles(filesToDelete, namespace)
        .then((result) => {
          console.log(
            "[delete] deleteFieldFiles result:",
            JSON.stringify(result),
          );
          if (result.file_errors?.length) {
            console.error("[delete] file errors:", result.file_errors);
          }
          if (result.missing_files?.length) {
            console.warn("[delete] missing files:", result.missing_files);
          }
        })
        .catch((err) =>
          console.error("[delete] deleteFieldFiles FAILED:", err),
        );

      // 4. Remove from cluster
      removeResource(
        node.id,
        node.source,
        resourceDir,
        namespace,
        node.helm?.release_name ?? null,
      )
        .then((result) => {
          console.log(
            "[delete] removeResource result:",
            JSON.stringify(result),
          );
          if (!result.success) {
            console.warn("[delete] cluster removal errors:", result.stderr);
          }
        })
        .catch((err) => console.error("[delete] removeResource FAILED:", err));

      break;
    }
  }
}
