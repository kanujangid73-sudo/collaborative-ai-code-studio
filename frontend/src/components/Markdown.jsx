import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

const components = {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
};

export default function Markdown({ children }) {
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
