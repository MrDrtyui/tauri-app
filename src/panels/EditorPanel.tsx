import React, { useEffect, useState } from "react";
import { Tab } from "../layout/types";
import { useIDEStore } from "../store/ideStore";
import { readYamlFile, saveYamlFile, kubectlApply } from "../store/tauriStore";

interface EditorPanelProps {
  tab: Tab;
  groupId: string;
}

export function EditorPanel({ tab, groupId }: EditorPanelProps) {
  const [content, setContent] = useState("# Loading...");
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applyStatus, setApplyStatus] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);
  const markTabDirty = useIDEStore((s) => s.markTabDirty);

  useEffect(() => {
    const filePath = tab.filePath ?? "";
    if (!filePath) {
      setContent("# No file path");
      return;
    }
    readYamlFile(filePath)
      .then((c) => {
        setContent(c);
        setIsDirty(false);
      })
      .catch(() => setContent(`# Could not read: ${filePath}\n`));
  }, [tab.id, tab.filePath]);

  // Clear apply status after 4s
  useEffect(() => {
    if (!applyStatus) return;
    const id = setTimeout(() => setApplyStatus(null), 4000);
    return () => clearTimeout(id);
  }, [applyStatus]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    if (!isDirty) {
      setIsDirty(true);
      markTabDirty(tab.id, true);
    }
  };

  const handleSave = async () => {
    if (!tab.filePath) return;
    setSaving(true);
    setApplyStatus(null);
    try {
      await saveYamlFile(tab.filePath, content);
      setIsDirty(false);
      markTabDirty(tab.id, false);
      // Auto-apply to cluster after save
      try {
        await kubectlApply(tab.filePath);
        setApplyStatus({ ok: true, msg: "applied" });
      } catch (e) {
        setApplyStatus({
          ok: false,
          msg: String(e).split("\n")[0].slice(0, 60),
        });
      }
    } catch {}
    setSaving(false);
  };

  const lineCount = content.split("\n").length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg-primary)",
        fontFamily: "var(--font-mono)",
      }}
    >
      {/* Editor toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 14px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--bg-surface)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            color: "var(--text-faint)",
            fontSize: "var(--font-size-xs)",
            fontFamily: "var(--font-mono)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {tab.filePath ?? "untitled"}
        </span>

        {isDirty && (
          <button
            onClick={handleSave}
            style={{
              background: "rgba(180,190,254,0.10)",
              border: "1px solid var(--border-accent)",
              borderRadius: "var(--radius-xs)",
              color: "var(--accent-alt)",
              fontSize: "var(--font-size-xs)",
              padding: "2px 8px",
              cursor: "pointer",
              fontFamily: "var(--font-ui)",
              fontWeight: 500,
              transition: "var(--ease-fast)",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.background =
                "rgba(180,190,254,0.18)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background =
                "rgba(180,190,254,0.10)")
            }
          >
            {saving ? "Saving…" : "Save"}
          </button>
        )}

        {applyStatus && (
          <span
            style={{
              fontSize: "var(--font-size-xs)",
              fontFamily: "var(--font-mono)",
              padding: "2px 8px",
              borderRadius: "var(--radius-xs)",
              border: `1px solid ${applyStatus.ok ? "rgba(166,227,161,0.3)" : "rgba(243,139,168,0.3)"}`,
              background: applyStatus.ok
                ? "rgba(166,227,161,0.07)"
                : "rgba(243,139,168,0.07)",
              color: applyStatus.ok ? "var(--ctp-green)" : "var(--ctp-red)",
            }}
          >
            {applyStatus.ok ? `✓ ${applyStatus.msg}` : `✗ ${applyStatus.msg}`}
          </span>
        )}

        <span
          style={{
            color: "var(--text-faint)",
            fontSize: "var(--font-size-xs)",
            padding: "1px 6px",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-full)",
            fontFamily: "var(--font-mono)",
          }}
        >
          YAML
        </span>
      </div>

      {/* Editor area */}
      <div
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          display: "flex",
        }}
      >
        {/* Line numbers */}
        <div
          style={{
            width: 48,
            background: "var(--bg-surface)",
            borderRight: "1px solid var(--border-subtle)",
            overflowY: "hidden",
            paddingTop: 10,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            paddingRight: 8,
            userSelect: "none",
            flexShrink: 0,
          }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div
              key={i}
              style={{
                fontSize: 11,
                lineHeight: "20px",
                color: "var(--text-faint)",
                fontFamily: "var(--font-mono)",
                opacity: 0.5,
              }}
            >
              {i + 1}
            </div>
          ))}
        </div>

        {/* Textarea */}
        <textarea
          value={content}
          onChange={handleChange}
          spellCheck={false}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--text-primary)",
            fontSize: 12,
            lineHeight: "20px",
            fontFamily: "var(--font-mono)",
            padding: "10px 14px",
            resize: "none",
            overflowY: "auto",
            caretColor: "var(--accent)",
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

      {/* Status footer */}
      <div
        style={{
          height: 20,
          borderTop: "1px solid var(--border-subtle)",
          background: "var(--bg-surface)",
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          gap: 12,
          flexShrink: 0,
        }}
      >
        {isDirty && (
          <span
            style={{
              color: "var(--ctp-yellow)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
            }}
          >
            ● unsaved
          </span>
        )}
        <span
          style={{
            color: "var(--text-faint)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
          }}
        >
          {lineCount} lines
        </span>
        <div style={{ flex: 1 }} />
        <span
          style={{
            color: "var(--text-faint)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
          }}
        >
          ⌘S to save
        </span>
      </div>
    </div>
  );
}
