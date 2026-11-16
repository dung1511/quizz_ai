import { KnowledgePackage } from '../../src/types';

type KnowledgeStatus = Extract<KnowledgePackage['status'], 'BUILT' | 'CONFIRMED'>;

function normalizeEvidenceText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function excerptMatchesFetchedContent(excerpt: string, fetchedContent: string): boolean {
  const normalizedExcerpt = normalizeEvidenceText(excerpt);
  const normalizedContent = normalizeEvidenceText(fetchedContent);
  if (normalizedExcerpt.length < 20) return false;
  if (normalizedContent.includes(normalizedExcerpt)) return true;

  const tokens = [...new Set(normalizedExcerpt.split(' ').filter((token) => token.length >= 3))];
  if (tokens.length < 4) return false;
  const contentTokens = new Set(normalizedContent.split(' '));
  const matchedTokens = tokens.filter((token) => contentTokens.has(token)).length;
  return matchedTokens / tokens.length >= 0.85;
}

export function getKnowledgeReviewIssues(
  pkg: Pick<KnowledgePackage, 'contentOrigin' | 'chapters' | 'webSources'>
): string[] {
  if (pkg.contentOrigin !== 'WEB') return [];

  const issues: string[] = [];
  const validSourceIds = new Set(pkg.webSources.map((source) => source.id));

  if (pkg.webSources.length === 0) {
    issues.push('Không có nguồn web đã truy xuất để đối chiếu.');
  }

  for (const chapter of pkg.chapters) {
    for (const section of chapter.sections) {
      const sourceRefIds = (section.sourceRefIds || []).filter((id) => validSourceIds.has(id));
      if (sourceRefIds.length === 0) {
        issues.push(`${chapter.title} / ${section.sectionNumber} ${section.title}: thiếu sourceRefIds hợp lệ.`);
      }
    }
  }

  for (const source of pkg.webSources) {
    const isReferenced = pkg.chapters.some((chapter) =>
      chapter.sections.some((section) => section.sourceRefIds?.includes(source.id))
    );
    if (!isReferenced) {
      issues.push(`${source.title}: nguồn chưa được gắn với mục kiến thức nào.`);
    }

    const excerpts = Array.isArray(source.usedExcerpts) ? source.usedExcerpts : [];
    const hasGroundedExcerpt = excerpts.some((excerpt) =>
      excerptMatchesFetchedContent(excerpt, source.fetchedContent)
    );
    if (!hasGroundedExcerpt) {
      issues.push(`${source.title}: thiếu trích đoạn khớp với nội dung trang đã truy xuất.`);
    }
  }

  return issues;
}

export function withKnowledgeReviewStatus(
  pkg: KnowledgePackage,
  successStatus: KnowledgeStatus
): KnowledgePackage {
  const reviewIssues = getKnowledgeReviewIssues(pkg);
  return {
    ...pkg,
    status: reviewIssues.length > 0 ? 'NEEDS_REVIEW' : successStatus,
    reviewIssues,
  };
}
