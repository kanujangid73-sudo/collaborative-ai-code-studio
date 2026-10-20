import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

// Plain text of a syntax-tree node (highlighting splits code into many spans).
function nodeText(node) {
  if (!node) return "";
  if (node.type === "text") return node.value;
  return (node.children ?? []).map(nodeText).join("");
}

function languageOf(node) {
  const code = node?.children?.find((c) => c.tagName === "code");
  const cls = (code?.properties?.className ?? []).find((c) => String(c).startsWith("language-"));
  return cls ? String(cls).slice("language-".length) : "";
}

function CodeBlock({ node, children, onInsertCode }) {
  const [copied, setCopied] = useState(false);
  const text = nodeText(node).replace(/\n$/, "");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (e.g. insecure context); the user can still select the text.
    }
  }

  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span>{languageOf(node) || "code"}</span>
        <div>
          {onInsertCode && (
            <button type="button" onClick={() => onInsertCode(text)} title="Insert at the cursor in the editor">
              Insert into editor
            </button>
          )}
          <button type="button" onClick={copy}>{copied ? "Copied ✓" : "Copy"}</button>
        </div>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export default function Markdown({ children, onInsertCode }) {
  const components = {
    a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
    pre: ({ node, children: inner }) => (
      <CodeBlock node={node} onInsertCode={onInsertCode}>{inner}</CodeBlock>
    ),
  };
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
