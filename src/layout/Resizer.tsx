import React, { useRef } from "react";

interface ResizerProps {
  direction: "horizontal" | "vertical";
  onResize: (delta: number) => void;
}

export function Resizer({ direction, onResize }: ResizerProps) {
  const isH = direction === "horizontal";

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startPos = isH ? e.clientX : e.clientY;

    const onMove = (me: MouseEvent) => {
      const current = isH ? me.clientX : me.clientY;
      onResize(current - startPos);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };

    document.body.style.cursor = isH ? "col-resize" : "row-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        flexShrink: 0,
        width:  isH ? 4 : "100%",
        height: isH ? "100%" : 4,
        background: "transparent",
        cursor: isH ? "col-resize" : "row-resize",
        position: "relative",
        zIndex: 20,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(203,166,247,0.35)")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
    />
  );
}
