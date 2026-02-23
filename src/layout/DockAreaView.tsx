import React from "react";
import { DockArea, LayoutNode, SplitNode } from "../layout/types";
import { TabGroupView } from "./TabGroupView";
import { useIDEStore } from "../store/ideStore";

interface DockAreaViewProps {
  area: DockArea;
}

export function DockAreaView({ area }: DockAreaViewProps) {
  if (!area.root) return null;
  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      <LayoutNodeView node={area.root} areaSlot={area.slot} />
    </div>
  );
}

// ─── Recursive layout renderer ─────────────────────────────────────

interface LayoutNodeViewProps {
  node: LayoutNode;
  areaSlot: string;
}

function LayoutNodeView({ node, areaSlot }: LayoutNodeViewProps) {
  if (node.type === "tabgroup") {
    return <TabGroupView group={node} areaSlot={areaSlot} />;
  }
  return <SplitView split={node} areaSlot={areaSlot} />;
}

// ─── SplitView ─────────────────────────────────────────────────────

interface SplitViewProps {
  split: SplitNode;
  areaSlot: string;
}

function SplitView({ split, areaSlot }: SplitViewProps) {
  const isHorizontal = split.direction === "horizontal";
  if (isHorizontal) {
    return <SplitHorizontal split={split} areaSlot={areaSlot} />;
  }
  return <SplitVertical split={split} areaSlot={areaSlot} />;
}

function SplitHorizontal({ split, areaSlot }: { split: SplitNode; areaSlot: string }) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  const handleResize = (delta: number) => {
    const w = containerRef.current?.clientWidth ?? 800;
    const ratioDelta = delta / w;
    const setSplitRatio = useIDEStore.getState().setSplitRatio;
    const newRatio = Math.max(0.1, Math.min(0.9, split.splitRatio + ratioDelta));
    setSplitRatio(split.id, newRatio);
  };

  return (
    <div ref={containerRef} style={{ display: "flex", width: "100%", height: "100%" }}>
      <div style={{ flex: split.splitRatio, overflow: "hidden", minWidth: 80 }}>
        <LayoutNodeView node={split.first} areaSlot={areaSlot} />
      </div>
      <SplitResizer isHorizontal splitId={split.id} currentRatio={split.splitRatio} onResize={handleResize} />
      <div style={{ flex: 1 - split.splitRatio, overflow: "hidden", minWidth: 80 }}>
        <LayoutNodeView node={split.second} areaSlot={areaSlot} />
      </div>
    </div>
  );
}

function SplitVertical({ split, areaSlot }: { split: SplitNode; areaSlot: string }) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  const handleResize = (delta: number) => {
    const h = containerRef.current?.clientHeight ?? 600;
    const ratioDelta = delta / h;
    const setSplitRatio = useIDEStore.getState().setSplitRatio;
    const newRatio = Math.max(0.1, Math.min(0.9, split.splitRatio + ratioDelta));
    setSplitRatio(split.id, newRatio);
  };

  return (
    <div ref={containerRef} style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      <div style={{ flex: split.splitRatio, overflow: "hidden", minHeight: 60 }}>
        <LayoutNodeView node={split.first} areaSlot={areaSlot} />
      </div>
      <SplitResizer isHorizontal={false} splitId={split.id} currentRatio={split.splitRatio} onResize={handleResize} />
      <div style={{ flex: 1 - split.splitRatio, overflow: "hidden", minHeight: 60 }}>
        <LayoutNodeView node={split.second} areaSlot={areaSlot} />
      </div>
    </div>
  );
}

// ─── SplitResizer ──────────────────────────────────────────────────

function SplitResizer({
  isHorizontal,
  splitId,
  currentRatio,
  onResize,
}: {
  isHorizontal: boolean;
  splitId: string;
  currentRatio: number;
  onResize: (delta: number) => void;
}) {
  const setSplitRatio = useIDEStore((s) => s.setSplitRatio);
  const dragging     = React.useRef(false);
  const startPos     = React.useRef(0);
  const startRatio   = React.useRef(currentRatio);
  const containerSz  = React.useRef(800);
  const divRef       = React.useRef<HTMLDivElement>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current  = true;
    startPos.current  = isHorizontal ? e.clientX : e.clientY;
    startRatio.current = currentRatio;

    const parent = divRef.current?.parentElement;
    if (parent) containerSz.current = isHorizontal ? parent.clientWidth : parent.clientHeight;

    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = (isHorizontal ? e.clientX : e.clientY) - startPos.current;
      const newRatio = Math.max(0.1, Math.min(0.9, startRatio.current + delta / containerSz.current));
      setSplitRatio(splitId, newRatio);
    };

    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    document.body.style.cursor = isHorizontal ? "col-resize" : "row-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={divRef}
      onMouseDown={onMouseDown}
      style={{
        flexShrink: 0,
        width:  isHorizontal ? 4 : "100%",
        height: isHorizontal ? "100%" : 4,
        background: "transparent",
        cursor: isHorizontal ? "col-resize" : "row-resize",
        position: "relative",
        zIndex: 10,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(203,166,247,0.35)")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
    />
  );
}
