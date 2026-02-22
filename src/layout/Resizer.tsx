import React, { useRef } from "react";

interface ResizerProps {
  direction: "horizontal" | "vertical";
  onResize: (delta: number) => void;
}

export function Resizer({ direction, onResize }: ResizerProps) {
  const isH = direction === "horizontal";
  const hovering = useRef(false);
  const divRef = useRef<HTMLDivElement>(null);

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
      ref={divRef}
      onMouseDown={handleMouseDown}
      style={{
        flexShrink: 0,
        width: isH ? 4 : "100%",
        height: isH ? "100%" : 4,
        background: "rgba(59,130,246,0.07)",
        cursor: isH ? "col-resize" : "row-resize",
        position: "relative",
        zIndex: 20,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(59,130,246,0.5)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(59,130,246,0.07)";
      }}
    />
  );
}
