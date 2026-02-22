import React from "react";
import { DockArea, LayoutNode, SplitNode, TabGroupNode } from "../layout/types";
import { TabGroupView } from "./TabGroupView";
import { Resizer } from "./Resizer";
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

// ─── Recursive layout node renderer ──────────────────────────────────────────

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

// ─── SplitView ────────────────────────────────────────────────────────────────

interface SplitViewProps {
  split: SplitNode;
  areaSlot: string;
}

function SplitView({ split, areaSlot }: SplitViewProps) {
  const setSplitRatio = useIDEStore((s) => s.setSplitRatio);
  const isHorizontal = split.direction === "horizontal";

  const handleResize = (delta: number) => {
    // delta in px → convert to ratio delta
    // We'd need the element size; use a ref approach
    // For now, pass a fixed step
    const step = 0.01;
    const newRatio = Math.max(
      0.1,
      Math.min(0.9, split.splitRatio + (delta > 0 ? step : -step) * Math.abs(delta) * 0.02)
    );
    setSplitRatio(split.id, newRatio);
  };

  if (isHorizontal) {
    return (
      <SplitHorizontal split={split} areaSlot={areaSlot} onResize={handleResize} />
    );
  }
  return <SplitVertical split={split} areaSlot={areaSlot} onResize={handleResize} />;
}

function SplitHorizontal({
  split,
  areaSlot,
  onResize,
}: {
  split: SplitNode;
  areaSlot: string;
  onResize: (delta: number) => void;
}) {
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
      <SplitResizer direction="horizontal" splitId={split.id} currentRatio={split.splitRatio} isHorizontal />
      <div style={{ flex: 1 - split.splitRatio, overflow: "hidden", minWidth: 80 }}>
        <LayoutNodeView node={split.second} areaSlot={areaSlot} />
      </div>
    </div>
  );
}

function SplitVertical({
  split,
  areaSlot,
  onResize,
}: {
  split: SplitNode;
  areaSlot: string;
  onResize: (delta: number) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      <div style={{ flex: split.splitRatio, overflow: "hidden", minHeight: 60 }}>
        <LayoutNodeView node={split.first} areaSlot={areaSlot} />
      </div>
      <SplitResizer direction="vertical" splitId={split.id} currentRatio={split.splitRatio} isHorizontal={false} />
      <div style={{ flex: 1 - split.splitRatio, overflow: "hidden", minHeight: 60 }}>
        <LayoutNodeView node={split.second} areaSlot={areaSlot} />
      </div>
    </div>
  );
}

// ─── SplitResizer (internal, adjusts splitRatio) ──────────────────────────────

function SplitResizer({
  direction,
  splitId,
  currentRatio,
  isHorizontal,
}: {
  direction: "horizontal" | "vertical";
  splitId: string;
  currentRatio: number;
  isHorizontal: boolean;
}) {
  const setSplitRatio = useIDEStore((s) => s.setSplitRatio);
  const dragging = React.useRef(false);
  const startPos = React.useRef(0);
  const startRatio = React.useRef(currentRatio);
  const containerSize = React.useRef(800);
  const divRef = React.useRef<HTMLDivElement>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startPos.current = isHorizontal ? e.clientX : e.clientY;
    startRatio.current = currentRatio;

    const parent = divRef.current?.parentElement;
    if (parent) {
      containerSize.current = isHorizontal
        ? parent.clientWidth
        : parent.clientHeight;
    }

    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const current = isHorizontal ? e.clientX : e.clientY;
      const delta = current - startPos.current;
      const ratioDelta = delta / containerSize.current;
      const newRatio = Math.max(0.1, Math.min(0.9, startRatio.current + ratioDelta));
      setSplitRatio(splitId, newRatio);
    };

    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={divRef}
      onMouseDown={onMouseDown}
      style={{
        flexShrink: 0,
        width: isHorizontal ? 4 : "100%",
        height: isHorizontal ? "100%" : 4,
        background: "rgba(59,130,246,0.0)",
        cursor: isHorizontal ? "col-resize" : "row-resize",
        position: "relative",
        zIndex: 10,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(59,130,246,0.4)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(59,130,246,0.08)")}
    />
  );
}
