import React, { useEffect } from "react";
import { DockLayout } from "./layout/DockLayout";
import { useIDEStore } from "./store/ideStore";
import { ProjectSelector } from "./screens/ProjectSelector";

const GLOBAL_STYLES = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body, #root {
    width: 100%; height: 100%; overflow: hidden;
    background: var(--bg-app);
    font-family: var(--font-ui);
    color: var(--text-primary);
    -webkit-font-smoothing: antialiased;
  }

  /* Dock layout — disable text selection during drag */
  .dock-layout, .dock-layout * { user-select: none; -webkit-user-select: none; }
  .dock-layout input, .dock-layout textarea { user-select: text; -webkit-user-select: text; }
`;

export default function App() {
  const projectPath = useIDEStore((s) => s.projectPath);
  const refreshClusterStatus = useIDEStore((s) => s.refreshClusterStatus);

  useEffect(() => {
    if (!projectPath) return;
    refreshClusterStatus();
    const id = setInterval(refreshClusterStatus, 10_000);
    return () => clearInterval(id);
  }, [projectPath, refreshClusterStatus]);

  return (
    <>
      <style>{GLOBAL_STYLES}</style>

      {!projectPath ? (
        <ProjectSelector />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100vh",
            animation: "ef-fadein 0.2s ease-out",
          }}
        >
          <DockLayout />
        </div>
      )}
    </>
  );
}
