import { DocumentChunk, Question } from '../src/types';

export interface SourceChunkMatch {
  chunk: DocumentChunk;
  score: number;
  exact: boolean;
}

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function meaningfulTokens(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .filter((token) => token.length >= 3);
}

export function findBestSourceChunk(
  sourceText: string,
  chunks: DocumentChunk[],
  hints: { chapter?: string; section?: string } = {}
): SourceChunkMatch | undefined {
  const normalizedSource = normalizeText(sourceText);
  if (normalizedSource.length < 15) return undefined;

  const sourceTokens = meaningfulTokens(sourceText);
  const sourceTokenSet = new Set(sourceTokens);
  const canFuzzyMatch = sourceTokenSet.size >= 4;
  let bestMatch: SourceChunkMatch | undefined;

  for (const chunk of chunks) {
    const normalizedContent = normalizeText(chunk.content);
    const exact = normalizedContent.includes(normalizedSource);
    const chunkTokenSet = new Set(meaningfulTokens(chunk.content));
    const overlapCount = [...sourceTokenSet].filter((token) => chunkTokenSet.has(token)).length;
    const coverage = sourceTokenSet.size > 0 ? overlapCount / sourceTokenSet.size : 0;

    if (!exact && (!canFuzzyMatch || coverage < 0.75)) continue;

    const chapterHint =
      hints.chapter &&
      normalizeText(chunk.chapterTitle).includes(normalizeText(hints.chapter));
    const sectionHint =
      hints.section &&
      normalizeText(chunk.sectionTitle).includes(normalizeText(hints.section));
    const score = (exact ? 1 : coverage) + (chapterHint ? 0.02 : 0) + (sectionHint ? 0.02 : 0);

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { chunk, score, exact };
    }
  }

  return bestMatch;
}

export function attachQuestionToSourceChunk(
  question: Question,
  chunks: DocumentChunk[]
): Question {
  const match = findBestSourceChunk(question.source.sourceText, chunks, {
    chapter: question.source.chapter,
    section: question.source.section,
  });

  if (!match) {
    return {
      ...question,
      source: {
        ...question.source,
        sourceChunkId: '',
      },
    };
  }

  return {
    ...question,
    source: {
      ...question.source,
      page: match.chunk.pageNumber,
      sourceChunkId: match.chunk.id,
      sourceText: match.exact ? question.source.sourceText : match.chunk.content,
    },
  };
}
