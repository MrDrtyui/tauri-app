import React, { useCallback, useRef, useState, useEffect } from "react";
import { useIDEStore } from "../store/ideStore";
import { YamlNode } from "../store/tauriStore";
import { ContextMenu, ContextMenuState } from "../components/ContextMenu";
import { DeleteConfirmDialog } from "../components/DeleteConfirmDialog";
import { executeCommand } from "../commands/commands";

const NODE_TYPES: Record<string, { bg: string; border: string; color: string; shadow: string; accent: string; icon: string }> = {
  gateway:    { bg:"linear-gradient(135deg,#0f2847,#1a3a6b)", border:"rgba(96,165,250,0.6)",  color:"#bfdbfe", shadow:"rgba(59,130,246,0.4)",  accent:"#3b82f6", icon:"⬡" },
  service:    { bg:"linear-gradient(135deg,#052e1c,#0d4a2e)", border:"rgba(52,211,153,0.6)",  color:"#6ee7b7", shadow:"rgba(16,185,129,0.35)", accent:"#10b981", icon:"◈" },
  database:   { bg:"linear-gradient(135deg,#0a1f3d,#112d58)", border:"rgba(59,130,246,0.55)", color:"#93c5fd", shadow:"rgba(37,99,235,0.4)",   accent:"#2563eb", icon:"◫" },
  cache:      { bg:"linear-gradient(135deg,#2d1000,#4a1f00)", border:"rgba(251,146,60,0.6)",  color:"#fed7aa", shadow:"rgba(234,88,12,0.4)",   accent:"#ea580c", icon:"⚡" },
  queue:      { bg:"linear-gradient(135deg,#2d0000,#4a0a0a)", border:"rgba(239,68,68,0.6)",   color:"#fca5a5", shadow:"rgba(220,38,38,0.4)",   accent:"#dc2626", icon:"⊛" },
  monitoring: { bg:"linear-gradient(135deg,#12003d,#1e0a5e)", border:"rgba(167,139,250,0.6)", color:"#ddd6fe", shadow:"rgba(124,58,237,0.4)",  accent:"#7c3aed", icon:"◎" },
  infra:      { bg:"linear-gradient(135deg,#0d1f0d,#1a3a1a)", border:"rgba(74,222,128,0.55)", color:"#bbf7d0", shadow:"rgba(34,197,94,0.35)",  accent:"#16a34a", icon:"⛵" },
  custom:     { bg:"linear-gradient(135deg,#0f1117,#1a1d27)", border:"rgba(100,116,139,0.5)", color:"#cbd5e1", shadow:"rgba(71,85,105,0.35)",  accent:"#475569", icon:"◇" },
};
function getType(typeId: string) { return NODE_TYPES[typeId] ?? NODE_TYPES.custom; }

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = { green:"#22c55e", yellow:"#eab308", red:"#ef4444", gray:"#475569" };
  const c = colors[status] ?? colors.gray;
  return <span style={{ display:"inline-block", width:6, height:6, borderRadius:"50%", background:c, boxShadow:status!=="gray"?`0 0 5px ${c}`:"none", flexShrink:0 }} />;
}

export function GraphPanel() {
  const storeNodes           = useIDEStore(s => s.nodes);
  const clusterStatus        = useIDEStore(s => s.clusterStatus);
  const updateNodePosition   = useIDEStore(s => s.updateNodePosition);
  const setSelectedEntity    = useIDEStore(s => s.setSelectedEntity);
  const renameNode           = useIDEStore(s => s.renameNode);

  const [selectedId, setSelectedId]           = useState<string | null>(null);
  const [pan, setPan]                         = useState({ x:0, y:0 });
  const [zoom, setZoom]                       = useState(1);
  const [localPos, setLocalPos]               = useState<Record<string, {x:number;y:number}>>({});
  const [contextMenu, setContextMenu]         = useState<ContextMenuState | null>(null);
  const [deleteTarget, setDeleteTarget]       = useState<YamlNode | null>(null);
  const [renamingId, setRenamingId]           = useState<string | null>(null);
  const [renameValue, setRenameValue]         = useState("");

  const canvasRef   = useRef<HTMLDivElement>(null);
  const fittedRef   = useRef(false);
  const renameRef   = useRef<HTMLInputElement>(null);
  const draggingNode = useRef<{ id:string; offX:number; offY:number } | null>(null);

  const getNodePos = (n: YamlNode) => localPos[n.id] ?? { x: n.x, y: n.y };

  // ── Node drag ──────────────────────────────────────────────────────────────
  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (renamingId === nodeId) return;
      const r = canvasRef.current!.getBoundingClientRect();
      const node = storeNodes.find(n => n.id === nodeId);
      if (!node) return;
      const pos = localPos[nodeId] ?? { x: node.x, y: node.y };
      draggingNode.current = {
        id: nodeId,
        offX: (e.clientX - r.left - pan.x) / zoom - pos.x,
        offY: (e.clientY - r.top  - pan.y) / zoom - pos.y,
      };
      let lastPos = pos;
      const onMove = (me: MouseEvent) => {
        if (!draggingNode.current) return;
        const nx = (me.clientX - r.left - pan.x - draggingNode.current.offX) / zoom;
        const ny = (me.clientY - r.top  - pan.y - draggingNode.current.offY) / zoom;
        lastPos = { x: nx, y: ny };
        setLocalPos(prev => ({ ...prev, [nodeId]: lastPos }));
      };
      const onUp = () => {
        updateNodePosition(nodeId, lastPos.x, lastPos.y);
        draggingNode.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [storeNodes, pan, zoom, localPos, updateNodePosition, renamingId]
  );

  // ── Node left click ────────────────────────────────────────────────────────
  const handleNodeClick = useCallback(
    (e: React.MouseEvent, node: YamlNode) => {
      e.stopPropagation();
      setSelectedId(node.id);
      executeCommand("field.properties", { node });
    },
    []
  );

  // ── Node right click ───────────────────────────────────────────────────────
  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: YamlNode) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ node, x: e.clientX, y: e.clientY });
      setSelectedId(node.id);
    },
    []
  );

  // ── Canvas pan ─────────────────────────────────────────────────────────────
  const panState = useRef<{ startX:number; startY:number; startPan:{x:number;y:number} } | null>(null);
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target !== canvasRef.current && !target.classList.contains("canvas-bg")) return;
    setSelectedId(null);
    setContextMenu(null);
    panState.current = { startX: e.clientX, startY: e.clientY, startPan: { ...pan } };
    const onMove = (me: MouseEvent) => {
      if (!panState.current) return;
      setPan({ x: panState.current.startPan.x + me.clientX - panState.current.startX, y: panState.current.startPan.y + me.clientY - panState.current.startY });
    };
    const onUp = () => { panState.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.max(0.25, Math.min(3, z * (e.deltaY < 0 ? 1.1 : 0.9))));
  };

  // ── Fit view ───────────────────────────────────────────────────────────────
  const fitView = useCallback(() => {
    if (!canvasRef.current || storeNodes.length === 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const xs = storeNodes.map(n => (localPos[n.id] ?? n).x);
    const ys = storeNodes.map(n => (localPos[n.id] ?? n).y);
    const minX = Math.min(...xs), maxX = Math.max(...xs) + 155;
    const minY = Math.min(...ys), maxY = Math.max(...ys) + 60;
    const newZoom = Math.min(rect.width / (maxX - minX + 80), rect.height / (maxY - minY + 80), 1.5) * 0.85;
    setPan({ x: rect.width / 2 - ((minX + maxX) / 2) * newZoom, y: rect.height / 2 - ((minY + maxY) / 2) * newZoom });
    setZoom(newZoom);
  }, [storeNodes, localPos]);

  useEffect(() => {
    if (storeNodes.length > 0 && !fittedRef.current) { fittedRef.current = true; fitView(); }
  }, [storeNodes, fitView]);

  // ── Inline rename ──────────────────────────────────────────────────────────
  const startRename = (node: YamlNode) => {
    setRenamingId(node.id);
    setRenameValue(node.label);
    setTimeout(() => renameRef.current?.select(), 30);
  };

  const commitRename = () => {
    if (renamingId && renameValue.trim()) {
      executeCommand("field.rename", { node: storeNodes.find(n => n.id === renamingId)!, newName: renameValue.trim() });
    }
    setRenamingId(null);
  };

  const getStatus = (node: YamlNode) => clusterStatus?.fields.find(f => f.label === node.label) ?? null;

  return (
    <div style={{ position:"relative", width:"100%", height:"100%", overflow:"hidden", background:"#0a1628" }} onWheel={handleWheel}>
      {/* Canvas background */}
      <div
        className="canvas-bg"
        ref={canvasRef}
        onMouseDown={handleCanvasMouseDown}
        onContextMenu={e => e.preventDefault()}
        style={{
          position:"absolute", inset:0,
          backgroundImage:"linear-gradient(rgba(59,130,246,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.05) 1px, transparent 1px)",
          backgroundSize:`${40*zoom}px ${40*zoom}px`, backgroundPosition:`${pan.x}px ${pan.y}px`,
          cursor:"grab",
        }}
      />

      {storeNodes.length === 0 && (
        <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:"rgba(255,255,255,0.15)", fontFamily:"monospace", pointerEvents:"none", gap:8 }}>
          <div style={{ fontSize:32 }}>◈</div>
          <div style={{ fontSize:12 }}>Open a project to see the graph</div>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ position:"absolute", top:10, right:10, zIndex:10, display:"flex", gap:4 }}>
        {[
          { l:"⊡", t:"Fit view",  a: fitView },
          { l:"+", t:"Zoom in",   a: () => setZoom(z => Math.min(3, z*1.2)) },
          { l:"−", t:"Zoom out",  a: () => setZoom(z => Math.max(0.25, z/1.2)) },
          { l:"⊞", t:"Reset",     a: () => { setPan({x:0,y:0}); setZoom(1); } },
        ].map(btn => (
          <button key={btn.l} onClick={btn.a} title={btn.t}
            style={{ width:28, height:28, background:"rgba(13,22,40,0.85)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:5, color:"rgba(255,255,255,0.5)", cursor:"pointer", fontSize:13, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(8px)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "white")}
            onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.5)")}
          >{btn.l}</button>
        ))}
        <div style={{ display:"flex", alignItems:"center", padding:"0 8px", background:"rgba(13,22,40,0.85)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:5, color:"rgba(255,255,255,0.4)", fontSize:10, backdropFilter:"blur(8px)", fontFamily:"monospace" }}>
          {Math.round(zoom * 100)}%
        </div>
      </div>

      {/* Nodes */}
      <div style={{ position:"absolute", inset:0, transformOrigin:"0 0", transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})`, pointerEvents:"none" }}>
        {storeNodes.map(node => {
          const pos  = getNodePos(node);
          const st   = getStatus(node);
          const t    = getType(node.type_id);
          const isSel = selectedId === node.id;
          const isRenaming = renamingId === node.id;

          return (
            <div
              key={node.id}
              onMouseDown={e => handleNodeMouseDown(e, node.id)}
              onClick={e => handleNodeClick(e, node)}
              onContextMenu={e => handleNodeContextMenu(e, node)}
              style={{
                position:"absolute", left:pos.x, top:pos.y, width:155, padding:"7px 10px",
                borderRadius:7, background:t.bg,
                border:`1.5px solid ${isSel ? t.accent : t.border}`,
                color:t.color, fontSize:11, fontFamily:"monospace", fontWeight:600,
                cursor:"grab", userSelect:"none", pointerEvents:"all",
                boxShadow: isSel ? `0 0 0 2px ${t.accent}, 0 0 20px ${t.shadow}` : `0 0 10px ${t.shadow}`,
                transition:"box-shadow 0.12s, border-color 0.12s",
                display:"flex", alignItems:"center", gap:6,
              }}
            >
              <span style={{ fontSize:14, flexShrink:0 }}>{t.icon}</span>
              <div style={{ flex:1, minWidth:0 }}>
                {isRenaming ? (
                  <input
                    ref={renameRef}
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setRenamingId(null);
                      e.stopPropagation();
                    }}
                    onClick={e => e.stopPropagation()}
                    style={{
                      background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.3)",
                      borderRadius:3, color:"white", fontSize:11, fontFamily:"monospace",
                      width:"100%", outline:"none", padding:"1px 4px",
                    }}
                  />
                ) : (
                  <div style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{node.label}</div>
                )}
                <div style={{ display:"flex", alignItems:"center", gap:4, marginTop:2, fontSize:9, opacity:0.55, fontWeight:400 }}>
                  {st && <StatusDot status={st.status} />}
                  <span>{node.kind}</span>
                  {node.replicas != null && <span>×{node.replicas}</span>}
                </div>
              </div>
              {node.source === "helm" && <span style={{ fontSize:9, opacity:0.4, flexShrink:0 }}>⛵</span>}
            </div>
          );
        })}
      </div>

      <div style={{ position:"absolute", bottom:8, left:"50%", transform:"translateX(-50%)", color:"rgba(255,255,255,0.1)", fontSize:10, fontFamily:"monospace", pointerEvents:"none" }}>
        scroll to zoom · drag canvas to pan · right-click node for actions
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onRename={node => startRename(node)}
          onDelete={node => { setDeleteTarget(node); setContextMenu(null); }}
        />
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <DeleteConfirmDialog
          node={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
