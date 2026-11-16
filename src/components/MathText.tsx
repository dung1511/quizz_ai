import React from 'react';
import katex from 'katex';

interface MathTextProps {
  text: string;
  className?: string;
}

const mathSegmentPattern = /(\$\$[\s\S]+?\$\$|\$(?:\\.|[^$\\])+\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/g;

export const MathText: React.FC<MathTextProps> = ({ text, className }) => {
  const segments = text.split(mathSegmentPattern);

  return (
    <span className={className}>
      {segments.map((segment, index) => {
        const isMath =
          segment.startsWith('$') ||
          segment.startsWith('\\(') ||
          segment.startsWith('\\[');

        if (!isMath) return segment;

        const displayMode = segment.startsWith('$$') || segment.startsWith('\\[');
        const expression = segment.startsWith('$$')
          ? segment.slice(2, -2)
          : segment.startsWith('$')
            ? segment.slice(1, -1)
            : segment.slice(2, -2);

        return (
          <span
            key={index}
            className={displayMode ? 'block overflow-x-auto py-1' : undefined}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(expression, {
                displayMode,
                throwOnError: false,
                trust: false,
                strict: 'ignore',
                maxExpand: 200,
                maxSize: 10,
              }),
            }}
          />
        );
      })}
    </span>
  );
};
