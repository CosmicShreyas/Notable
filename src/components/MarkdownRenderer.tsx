import { Fragment, type ReactNode } from "react";

export function MarkdownRenderer({
  markdown,
  className = "markdown-note",
}: {
  markdown: string;
  className?: string;
}) {
  return <div className={className}>{renderMarkdownBlocks(markdown)}</div>;
}

function renderMarkdownBlocks(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 6);
      const headingContent = renderInlineMarkdown(headingMatch[2]);

      if (level === 1) blocks.push(<h1 key={`heading-${index}`}>{headingContent}</h1>);
      if (level === 2) blocks.push(<h2 key={`heading-${index}`}>{headingContent}</h2>);
      if (level === 3) blocks.push(<h3 key={`heading-${index}`}>{headingContent}</h3>);
      if (level === 4) blocks.push(<h4 key={`heading-${index}`}>{headingContent}</h4>);
      if (level === 5) blocks.push(<h5 key={`heading-${index}`}>{headingContent}</h5>);
      if (level === 6) blocks.push(<h6 key={`heading-${index}`}>{headingContent}</h6>);

      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }

      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={`ul-item-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }

      blocks.push(
        <ol key={`ol-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={`ol-item-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index].trim()) &&
      !/^[-*]\s+/.test(lines[index].trim()) &&
      !/^\d+\.\s+/.test(lines[index].trim())
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    blocks.push(<p key={`p-${index}`}>{renderInlineMarkdown(paragraphLines.join(" "))}</p>);
  }

  return blocks;
}

function renderInlineMarkdown(text: string) {
  const tokens = text.split(/(\*\*.*?\*\*|`.*?`|\*.*?\*)/g).filter(Boolean);

  return tokens.map((token, index) => {
    if (token.startsWith("**") && token.endsWith("**")) {
      return <strong key={index}>{token.slice(2, -2)}</strong>;
    }

    if (token.startsWith("*") && token.endsWith("*")) {
      return <em key={index}>{token.slice(1, -1)}</em>;
    }

    if (token.startsWith("`") && token.endsWith("`")) {
      return <code key={index}>{token.slice(1, -1)}</code>;
    }

    return <Fragment key={index}>{token}</Fragment>;
  });
}
