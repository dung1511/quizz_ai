import { QuestionIllustration } from '../types';

export function getMathIllustrationFallback(questionText: string): QuestionIllustration | undefined {
  if (/khối\s+chóp/i.test(questionText)) {
    return {
      needsImage: true,
      imageType: 'diagram',
      caption: 'Sơ đồ minh họa khối chóp',
      tikzCode: String.raw`\coordinate (A) at (0,0);
\coordinate (B) at (2.5,0);
\coordinate (C) at (3.2,0.8);
\coordinate (D) at (0.7,0.8);
\coordinate (S) at (1.7,2.5);
\draw (A)--(B)--(C)--(D)--cycle;
\draw (A)--(S)--(B);
\draw (S)--(C);
\draw[dashed] (S)--(D);`,
    };
  }

  if (/lăng\s+trụ/i.test(questionText)) {
    return {
      needsImage: true,
      imageType: 'diagram',
      caption: 'Sơ đồ minh họa khối lăng trụ tam giác',
      tikzCode: String.raw`\coordinate (A) at (0,0);
\coordinate (B) at (2,0);
\coordinate (C) at (0.7,1.2);
\coordinate (A1) at (1,1.5);
\coordinate (B1) at (3,1.5);
\coordinate (C1) at (1.7,2.7);
\draw (A)--(B)--(C)--cycle;
\draw (A1)--(B1)--(C1)--cycle;
\draw (A)--(A1) (B)--(B1) (C)--(C1);`,
    };
  }

  return undefined;
}
