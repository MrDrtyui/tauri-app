import React, { useEffect } from "react";
import { DockLayout } from "./layout/DockLayout";
import { useIDEStore } from "./store/ideStore";
import { ProjectSelector } from "./screens/ProjectSelector";

const GLOBAL_STYLES = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { width: 100%; height: 100%; overflow: hidden; background: #07101f; }
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
  * { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent; }
  @keyframes fadeIn { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

export default function App() {
  const projectPath = useIDEStore((s) => s.projectPath);
  const refreshClusterStatus = useIDEStore((s) => s.refreshClusterStatus);

  // Poll cluster status every 10s when a project is open
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
        // ── Splash / project picker (shown on startup like VS Code) ──
        <ProjectSelector />
      ) : (
        // ── Main IDE layout ──
        <div style={{ width:"100%", height:"100vh", animation:"fadeIn 0.25s ease" }}>
          <DockLayout />
        </div>
      )}
    </>
  );
}
