import React from "react";
import { Tab } from "../layout/types";
import { ExplorerPanel }    from "../panels/ExplorerPanel";
import { EditorPanel }      from "../panels/EditorPanel";
import { GraphPanel }       from "../panels/GraphPanel";
import { InspectorPanel }   from "../panels/InspectorPanel";
import { ClusterDiffPanel } from "../panels/ClusterDiffPanel";
import { ClusterLogsPanel } from "../panels/ClusterLogsPanel";
import { WelcomePanel }     from "../panels/WelcomePanel";
import { DeployImagePanel } from "../panels/DeployImagePanel";

interface PanelRendererProps {
  tab: Tab;
  groupId: string;
}

export function PanelRenderer({ tab, groupId }: PanelRendererProps) {
  switch (tab.contentType) {
    case "explorer":    return <ExplorerPanel />;
    case "file":        return <EditorPanel tab={tab} groupId={groupId} />;
    case "graph":       return <GraphPanel />;
    case "inspector":   return <InspectorPanel />;
    case "clusterDiff": return <ClusterDiffPanel />;
    case "clusterLogs": return <ClusterLogsPanel />;
    case "welcome":     return <WelcomePanel />;
    case "deployImage": return <DeployImagePanel />;
    default:
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "var(--text-faint)",
            fontSize: "var(--font-size-sm)",
            fontFamily: "var(--font-ui)",
          }}
        >
          Unknown panel: {tab.contentType}
        </div>
      );
  }
}
