import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MathText } from '../src/components/MathText';
import { getMathIllustrationFallback } from '../src/utils/mathIllustrations';
import { normalizeQuizTitle } from '../src/utils/quizTitle';
import { sanitizeTikzCode } from '../src/utils/tikzValidation';

test('normalizes generated Markdown headings in quiz titles only at the start', () => {
  assert.equal(normalizeQuizTitle('## toán12'), 'toán12');
  assert.equal(normalizeQuizTitle('Tiêu đề #12'), 'Tiêu đề #12');
});

test('renders inline math instead of leaving LaTeX delimiters visible', () => {
  const markup = renderToStaticMarkup(
    React.createElement(MathText, { text: String.raw`Tính $I = \frac{4}{3}$.` })
  );
  assert.match(markup, /class="katex"/);
  assert.match(markup, /<mfrac>/);
  assert.doesNotMatch(markup, /\$I/);
});

test('provides safe illustrative diagrams for prism and pyramid questions', () => {
  const questions = [
    'Tính thể tích khối lăng trụ.',
    'Tính thể tích khối chóp.',
  ];

  for (const question of questions) {
    const illustration = getMathIllustrationFallback(question);
    assert.ok(illustration?.needsImage);
    assert.ok(sanitizeTikzCode(illustration.tikzCode));
  }

  assert.equal(getMathIllustrationFallback('Tính tích phân xác định.'), undefined);
});
