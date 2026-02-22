import React, { useEffect, useState } from "react";
import { Tab } from "../layout/types";
import { useIDEStore } from "../store/ideStore";
import { readYamlFile, saveYamlFile } from "../store/tauriStore";

interface EditorPanelProps {
  tab: Tab;
  groupId: string;
}

export function EditorPanel({ tab, groupId }: EditorPanelProps) {
  const [content, setContent] = useState("# Loading...");
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const markTabDirty = useIDEStore((s) => s.markTabDirty);

  useEffect(() => {
    const filePath = tab.filePath ?? "";
    if (!filePath) { setContent("# No file path"); return; }
    readYamlFile(filePath)
      .then((c) => { setContent(c); setIsDirty(false); })
      .catch(() => setContent(`# Could not read: ${filePath}\n`));
  }, [tab.id, tab.filePath]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    if (!isDirty) { setIsDirty(true); markTabDirty(tab.id, true); }
  };

  const handleSave = async () => {
    if (!tab.filePath) return;
    setSaving(true);
    try {
      await saveYamlFile(tab.filePath, content);
      setIsDirty(false);
      markTabDirty(tab.id, false);
    } catch {}
    setSaving(false);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#0d1526",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "#09111f",
          flexShrink: 0,
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 10 }}>
          {tab.filePath ?? "untitled"}
        </span>
        <div style={{ flex: 1 }} />
        {isDirty && (
          <button
            onClick={handleSave}
            style={{
              background: "rgba(59,130,246,0.2)",
              border: "1px solid rgba(96,165,250,0.35)",
              borderRadius: 3,
              color: "#93c5fd",
              fontSize: 10,
              padding: "2px 8px",
              cursor: "pointer",
              fontFamily: "monospace",
            }}
          >
            {saving ? "Saving…" : "⊞ Save"}
          </button>
        )}
        <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 10 }}>YAML</span>
      </div>

      {/* Editor area */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* Line numbers */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            width: 44,
            background: "#09111f",
            borderRight: "1px solid rgba(255,255,255,0.04)",
            overflowY: "hidden",
            paddingTop: 10,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            paddingRight: 6,
            userSelect: "none",
          }}
        >
          {content.split("\n").map((_, i) => (
            <div
              key={i}
              style={{
                fontSize: 11,
                lineHeight: "20px",
                color: "rgba(255,255,255,0.12)",
                fontFamily: "monospace",
                minWidth: 20,
                textAlign: "right",
              }}
            >
              {i + 1}
            </div>
          ))}
        </div>

        {/* Syntax-highlighted textarea overlay */}
        <textarea
          value={content}
          onChange={handleChange}
          spellCheck={false}
          style={{
            position: "absolute",
            top: 0,
            left: 44,
            right: 0,
            bottom: 0,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#c9d1d9",
            fontSize: 12,
            lineHeight: "20px",
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            padding: "10px 10px 10px 12px",
            resize: "none",
            overflowY: "auto",
            caretColor: "#60a5fa",
            whiteSpace: "pre",
            overflowX: "auto",
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
              e.preventDefault();
              handleSave();
            }
          }}
        />
      </div>
    </div>
  );
}
