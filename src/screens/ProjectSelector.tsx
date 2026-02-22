import React, { useState, useEffect } from "react";
import { useIDEStore } from "../store/ideStore";
import { openFolderDialog, scanYamlFiles } from "../store/tauriStore";

const RECENT_KEY = "endfield_recent_paths";
function getRecent(): string[] { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; } }
function addRecent(p: string) { const prev = getRecent().filter(x => x !== p); localStorage.setItem(RECENT_KEY, JSON.stringify([p, ...prev].slice(0, 8))); }

export function ProjectSelector() {
  const setProject = useIDEStore((s) => s.setProject);
  const refreshClusterStatus = useIDEStore((s) => s.refreshClusterStatus);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setRecent(getRecent()); const t = setTimeout(() => setMounted(true), 50); return () => clearTimeout(t); }, []);

  const open = async (path?: string) => {
    setError(null); setLoading(true);
    try {
      const folderPath = path ?? (await openFolderDialog());
      if (!folderPath) { setLoading(false); return; }
      const result = await scanYamlFiles(folderPath);
      addRecent(folderPath);
      await setProject(result);
      refreshClusterStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  };

  return (
    <div style={{ width:"100%", height:"100vh", background:"#07101f", display:"flex", overflow:"hidden", fontFamily:"'JetBrains Mono', monospace", opacity: mounted?1:0, transition:"opacity 0.35s ease" }}>

      {/* ── Left sidebar ── */}
      <div style={{ width:320, flexShrink:0, background:"linear-gradient(160deg, #0d1a30 0%, #07101f 100%)",
        borderRight:"1px solid rgba(255,255,255,0.06)", display:"flex", flexDirection:"column",
        justifyContent:"space-between", padding:"44px 32px", position:"relative", overflow:"hidden" }}>

        {/* bg glows */}
        <div style={{ position:"absolute", top:-100, left:-100, width:360, height:360, borderRadius:"50%",
          background:"radial-gradient(circle, rgba(59,130,246,0.1) 0%, transparent 70%)", pointerEvents:"none" }} />
        <div style={{ position:"absolute", bottom:0, right:-80, width:240, height:240, borderRadius:"50%",
          background:"radial-gradient(circle, rgba(99,102,241,0.07) 0%, transparent 70%)", pointerEvents:"none" }} />

        <div>
          {/* Logo */}
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:28 }}>
            <div style={{ width:46, height:46, borderRadius:11, background:"linear-gradient(135deg, #60a5fa, #2563eb)",
              display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 0 28px rgba(59,130,246,0.45)", flexShrink:0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="8" height="8" rx="1.5" fill="white" opacity="0.9"/>
                <rect x="13" y="3" width="8" height="8" rx="1.5" fill="white" opacity="0.6"/>
                <rect x="3" y="13" width="8" height="8" rx="1.5" fill="white" opacity="0.6"/>
                <rect x="13" y="13" width="8" height="8" rx="1.5" fill="white" opacity="0.3"/>
              </svg>
            </div>
            <div>
              <div style={{ color:"white", fontSize:21, fontWeight:700, letterSpacing:"0.04em" }}>Endfield</div>
              <div style={{ color:"rgba(255,255,255,0.25)", fontSize:10, marginTop:1 }}>Kubernetes IDE</div>
            </div>
          </div>

          <div style={{ color:"rgba(255,255,255,0.2)", fontSize:11, lineHeight:1.9, marginBottom:36 }}>
            Infrastructure-as-code workspace<br/>for Kubernetes developers
          </div>

          {/* Features */}
          {[
            ["⬡", "Visual graph editor"],
            ["⛵", "Helm chart support"],
            ["◎", "Live cluster status"],
            ["◫", "YAML editor"],
            ["⊞", "Cluster diff &amp; logs"],
          ].map(([icon, label]) => (
            <div key={label} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
              <span style={{ color:"rgba(96,165,250,0.45)", fontSize:13 }}>{icon}</span>
              <span style={{ color:"rgba(255,255,255,0.25)", fontSize:11 }} dangerouslySetInnerHTML={{ __html: label }} />
            </div>
          ))}
        </div>

        <div style={{ color:"rgba(255,255,255,0.1)", fontSize:10 }}>v0.1.0-alpha</div>
      </div>

      {/* ── Right panel ── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"52px 56px", overflowY:"auto", background:"#07101f" }}>

        <div style={{ color:"rgba(255,255,255,0.75)", fontSize:24, fontWeight:700, letterSpacing:"0.01em", marginBottom:6 }}>
          Start
        </div>
        <div style={{ color:"rgba(255,255,255,0.22)", fontSize:12, marginBottom:40 }}>
          Open a folder with Kubernetes configs to begin
        </div>

        {/* Open button */}
        <button onClick={() => open()} disabled={loading} style={{
          display:"flex", alignItems:"center", gap:12, padding:"14px 20px",
          background: loading ? "rgba(37,99,235,0.25)" : "linear-gradient(135deg, rgba(59,130,246,0.2), rgba(37,99,235,0.15))",
          border:`1.5px solid ${loading ? "rgba(96,165,250,0.15)" : "rgba(96,165,250,0.4)"}`,
          borderRadius:8, color: loading ? "rgba(255,255,255,0.35)" : "#93c5fd",
          fontSize:13, fontWeight:600, fontFamily:"monospace", cursor: loading ? "not-allowed" : "pointer",
          transition:"all 0.15s", maxWidth:460, width:"100%",
          boxShadow: loading ? "none" : "0 0 18px rgba(59,130,246,0.12)",
        }}
          onMouseEnter={e => { if (!loading) { e.currentTarget.style.background="linear-gradient(135deg, rgba(59,130,246,0.3), rgba(37,99,235,0.25))"; e.currentTarget.style.borderColor="rgba(96,165,250,0.65)"; }}}
          onMouseLeave={e => { if (!loading) { e.currentTarget.style.background="linear-gradient(135deg, rgba(59,130,246,0.2), rgba(37,99,235,0.15))"; e.currentTarget.style.borderColor="rgba(96,165,250,0.4)"; }}}
        >
          {loading ? (
            <><div style={{ width:14, height:14, borderRadius:"50%", border:"2px solid rgba(255,255,255,0.15)", borderTopColor:"#60a5fa", animation:"spin 0.7s linear infinite" }} />Scanning project…</>
          ) : (
            <><span style={{ fontSize:17 }}>📁</span>Open folder…<span style={{ marginLeft:"auto", opacity:0.3, fontSize:11 }}>Ctrl+O</span></>
          )}
        </button>

        {/* Recent */}
        {recent.length > 0 && (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:12, margin:"36px 0 14px", maxWidth:460 }}>
              <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.06)" }} />
              <span style={{ color:"rgba(255,255,255,0.18)", fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase" }}>Recent</span>
              <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.06)" }} />
            </div>

            <div style={{ display:"flex", flexDirection:"column", gap:3, maxWidth:460 }}>
              {recent.map(p => {
                const parts = p.replace(/^~/, "").split("/").filter(Boolean);
                const name = parts[parts.length - 1] ?? p;
                const parent = "/" + parts.slice(0, -1).join("/");
                return (
                  <div key={p} onClick={() => open(p)} style={{
                    display:"flex", alignItems:"center", gap:12, padding:"10px 14px",
                    borderRadius:7, border:"1px solid rgba(255,255,255,0.05)",
                    background:"rgba(255,255,255,0.02)", cursor:"pointer", transition:"all 0.12s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background="rgba(59,130,246,0.07)"; e.currentTarget.style.borderColor="rgba(96,165,250,0.2)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background="rgba(255,255,255,0.02)"; e.currentTarget.style.borderColor="rgba(255,255,255,0.05)"; }}
                  >
                    <span style={{ fontSize:16, flexShrink:0 }}>📂</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ color:"rgba(255,255,255,0.62)", fontSize:12, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name}</div>
                      <div style={{ color:"rgba(255,255,255,0.18)", fontSize:10, marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{parent}</div>
                    </div>
                    <span style={{ color:"rgba(255,255,255,0.15)", fontSize:12, flexShrink:0 }}>→</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {error && (
          <div style={{ maxWidth:460, marginTop:20, padding:"10px 14px",
            background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.25)",
            borderRadius:7, color:"#fca5a5", fontSize:11 }}>
            ✗ {error}
          </div>
        )}

        <div style={{ marginTop:"auto", paddingTop:40, color:"rgba(255,255,255,0.1)", fontSize:10 }}>
          Tip: drag a folder onto the window to open it instantly
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
