import { File as CodeFile } from '@pierre/diffs/react';
import type { ReactNode } from 'react';
import { markdownCodeBlockOptions } from './code-view-options.ts';

export const renderInlineMarkdown = (text: string): ReactNode => {
  const nodes: Array<ReactNode> = [];
  const pattern = /`([^`\n]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const renderText = (value: string, keyPrefix: string): Array<ReactNode> => {
    const textNodes: Array<ReactNode> = [];
    const emphasisPattern =
      /\*\*([^*\n]+)\*\*|(?<![\w_])_([^_\n]+)_(?![\w_])|(?<![\w*])\*([^*\n]+)\*(?![\w*])/g;
    let textLastIndex = 0;
    let emphasisMatch: RegExpExecArray | null;

    while ((emphasisMatch = emphasisPattern.exec(value))) {
      if (emphasisMatch.index > textLastIndex) {
        textNodes.push(value.slice(textLastIndex, emphasisMatch.index));
      }

      if (emphasisMatch[1] != null) {
        textNodes.push(
          <strong key={`${keyPrefix}:bold:${emphasisMatch.index}`}>{emphasisMatch[1]}</strong>,
        );
      } else {
        textNodes.push(
          <em key={`${keyPrefix}:italic:${emphasisMatch.index}`}>
            {emphasisMatch[2] ?? emphasisMatch[3]}
          </em>,
        );
      }
      textLastIndex = emphasisPattern.lastIndex;
    }

    if (textLastIndex < value.length) {
      textNodes.push(value.slice(textLastIndex));
    }

    return textNodes.length > 0 ? textNodes : [value];
  };

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(...renderText(text.slice(lastIndex, match.index), `${lastIndex}`));
    }

    nodes.push(
      <code className="walkthrough-inline-code" key={`${match.index}:${match[1]}`}>
        {match[1]}
      </code>,
    );
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(...renderText(text.slice(lastIndex), `${lastIndex}`));
  }

  return nodes.length > 0 ? nodes : text;
};

const markdownFenceLanguageAliases: Record<string, string> = {
  bash: 'bash',
  cjs: 'cjs',
  css: 'css',
  diff: 'diff',
  html: 'html',
  javascript: 'js',
  js: 'js',
  json: 'json',
  jsx: 'jsx',
  markdown: 'md',
  md: 'md',
  mjs: 'mjs',
  patch: 'patch',
  py: 'py',
  python: 'py',
  rb: 'rb',
  ruby: 'rb',
  sh: 'sh',
  shell: 'sh',
  ts: 'ts',
  tsx: 'tsx',
  typescript: 'ts',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yml',
  zsh: 'zsh',
};

const getMarkdownFenceFileName = (info: string) => {
  const language = info.trim().split(/\s+/)[0]?.toLowerCase();
  if (!language) {
    return 'snippet.txt';
  }

  const extension = markdownFenceLanguageAliases[language] ?? language.replaceAll(/[^\w+#.-]/g, '');
  return extension ? `snippet.${extension}` : 'snippet.txt';
};

function MarkdownCodeBlock({
  code,
  highlighted,
  info,
}: {
  code: string;
  highlighted: boolean;
  info: string;
}) {
  return highlighted ? (
    <CodeFile
      className="codiff-markdown-code-block"
      disableWorkerPool={false}
      file={{
        cacheKey: `markdown-code:${info}:${code.length}:${code.slice(0, 64)}`,
        contents: code,
        name: getMarkdownFenceFileName(info),
      }}
      options={markdownCodeBlockOptions}
    />
  ) : (
    <pre>
      <code>{code}</code>
    </pre>
  );
}

export const renderMarkdown = (
  text: string,
  { highlightCode = false }: { highlightCode?: boolean } = {},
): ReactNode => {
  const blocks: Array<ReactNode> = [];
  const renderTextBlocks = (value: string, keyPrefix: string) => {
    for (const [index, block] of value
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean)
      .entries()) {
      const lines = block.split('\n');
      const heading = lines.length === 1 ? lines[0]?.match(/^(#{1,6})\s+(.+)$/) : null;
      const listItems = lines
        .map((line) => line.trim().match(/^[-*]\s+(.+)$/)?.[1])
        .filter((line): line is string => line != null);
      const orderedListItems = lines
        .map((line) => line.trim().match(/^\d+\.\s+(.+)$/)?.[1])
        .filter((line): line is string => line != null);
      const quoteLines = lines
        .map((line) => line.trim().match(/^>\s?(.*)$/)?.[1])
        .filter((line): line is string => line != null);

      if (heading) {
        const headingContent = renderInlineMarkdown(heading[2]);
        const key = `${keyPrefix}:h:${index}`;
        switch (heading[1].length) {
          case 1:
            blocks.push(<h1 key={key}>{headingContent}</h1>);
            break;
          case 2:
            blocks.push(<h2 key={key}>{headingContent}</h2>);
            break;
          case 3:
            blocks.push(<h3 key={key}>{headingContent}</h3>);
            break;
          case 4:
            blocks.push(<h4 key={key}>{headingContent}</h4>);
            break;
          case 5:
            blocks.push(<h5 key={key}>{headingContent}</h5>);
            break;
          default:
            blocks.push(<h6 key={key}>{headingContent}</h6>);
            break;
        }
      } else if (listItems.length === lines.length) {
        blocks.push(
          <ul key={`${keyPrefix}:list:${index}`}>
            {listItems.map((line, lineIndex) => (
              <li key={`${keyPrefix}:list:${index}:${lineIndex}`}>{renderInlineMarkdown(line)}</li>
            ))}
          </ul>,
        );
      } else if (orderedListItems.length === lines.length) {
        blocks.push(
          <ol key={`${keyPrefix}:ordered-list:${index}`}>
            {orderedListItems.map((line, lineIndex) => (
              <li key={`${keyPrefix}:ordered-list:${index}:${lineIndex}`}>
                {renderInlineMarkdown(line)}
              </li>
            ))}
          </ol>,
        );
      } else if (quoteLines.length === lines.length) {
        blocks.push(
          <blockquote key={`${keyPrefix}:quote:${index}`}>
            {quoteLines.map((line, lineIndex) => (
              <span key={`${keyPrefix}:quote:${index}:${lineIndex}`}>
                {lineIndex > 0 ? <br /> : null}
                {renderInlineMarkdown(line)}
              </span>
            ))}
          </blockquote>,
        );
      } else if (lines.length === 1 && /^-{3,}$/.test(lines[0].trim())) {
        blocks.push(<hr key={`${keyPrefix}:hr:${index}`} />);
      } else {
        const paragraphText = lines.map((line) => line.trim()).join(' ');
        blocks.push(<p key={`${keyPrefix}:p:${index}`}>{renderInlineMarkdown(paragraphText)}</p>);
      }
    }
  };

  const fencePattern = /```([^\n`]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(text))) {
    if (match.index > lastIndex) {
      renderTextBlocks(text.slice(lastIndex, match.index), `${lastIndex}`);
    }

    blocks.push(
      <MarkdownCodeBlock
        code={match[2]}
        highlighted={highlightCode}
        info={match[1]}
        key={`code:${match.index}`}
      />,
    );
    lastIndex = fencePattern.lastIndex;
  }

  if (lastIndex < text.length) {
    renderTextBlocks(text.slice(lastIndex), `${lastIndex}`);
  }

  return blocks.length > 0 ? blocks : renderInlineMarkdown(text);
};
