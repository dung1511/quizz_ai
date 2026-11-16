import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getKnowledgeReviewIssues,
  withKnowledgeReviewStatus,
} from './aiText/knowledgeValidation';
import { isUsefulAcademicText } from './aiText/webResearcher';
import { findBestSourceChunk } from './sourceMatcher';
import { DocumentChunk, KnowledgePackage, ParsedQuizRequest } from '../src/types';

const request: ParsedQuizRequest = {
  id: 'request-1',
  quizTitle: 'Kiểm tra',
  rawPrompt: 'Tạo câu hỏi về học sinh lớp Một',
  topic: 'Học sinh lớp Một',
  subject: 'Giáo dục tiểu học',
  audience: 'Sinh viên',
  questionCount: 5,
  difficultyMode: 'medium',
  difficulty: { easy: 2, medium: 2, hard: 1 },
  knowledgeAreas: ['Đặc điểm phát triển nhận thức học sinh lớp Một'],
  focusChapters: [],
  language: 'vi',
  optionsCount: 4,
  includeExplanation: true,
  needsWebResearch: true,
  createdAt: '2026-11-16T00:00:00.000Z',
};

const documentChunk: DocumentChunk = {
  id: 'chunk-1-1',
  documentId: 'doc-1',
  chapterId: 'chapter-1',
  chapterTitle: 'Chương 1 – Học sinh lớp Một',
  sectionId: 'section-1',
  sectionTitle: '1.1 Đặc điểm nhận thức',
  pageNumber: 3,
  content:
    'Học sinh lớp Một đang phát triển khả năng nhận thức. Giáo dục tiểu học cần chú ý đến đặc điểm tâm lý và hoạt động học tập của trẻ.',
};

function makeKnowledgePackage(): KnowledgePackage {
  const excerpt = 'Học sinh lớp Một đang phát triển khả năng nhận thức.';
  return {
    id: 'package-1',
    requestId: request.id,
    request,
    topic: request.topic,
    contentOrigin: 'WEB',
    originNotice: 'Tổng hợp từ nguồn web.',
    chapters: [
      {
        id: 'chapter-1',
        chapterNumber: 1,
        title: 'Chương 1 – Học sinh lớp Một',
        summary: '',
        sections: [
          {
            id: 'section-1',
            sectionNumber: '1.1',
            title: 'Đặc điểm nhận thức',
            concepts: [],
            explanation: 'Nội dung học tập.',
            keyPoints: [],
            sourceRefIds: ['source-1'],
          },
        ],
      },
    ],
    webSources: [
      {
        id: 'source-1',
        title: 'Tài liệu giáo dục tiểu học',
        url: 'https://example.edu.vn/grade-one',
        domain: 'example.edu.vn',
        fetchedContent: `${excerpt} Giáo dục tiểu học chú ý đến đặc điểm tâm lý của trẻ.`,
        usedExcerpts: [excerpt],
        retrievedAt: '2026-11-16T00:00:00.000Z',
        reliabilityTier: 'academic',
        fetchMethod: 'direct_fetch',
      },
    ],
    compiledMarkdown: `# ${request.topic}\n\n${excerpt}`,
    documentSource: {
      id: 'doc-ai-1',
      title: request.topic,
      fileName: 'TaiLieu_Web.txt',
      fileType: 'txt',
      fileSize: '1 KB',
      pageCount: 1,
      status: 'READY',
      rawText: excerpt,
      chapters: [],
      chunks: [],
      knowledgeUnits: [],
    },
    createdAt: '2026-11-16T00:00:00.000Z',
    updatedAt: '2026-11-16T00:00:00.000Z',
    status: 'BUILT',
  };
}

test('web result relevance requires topic overlap in both title and fetched content', () => {
  const relevantText = `${documentChunk.content} ${documentChunk.content} ${documentChunk.content}`;
  assert.equal(
    isUsefulAcademicText(relevantText, 'Học sinh lớp Một - Wikipedia tiếng Việt', request),
    true
  );
  assert.equal(
    isUsefulAcademicText(relevantText, 'Sinh viên - Wikipedia tiếng Việt', request),
    false
  );
  assert.equal(
    isUsefulAcademicText(
      'Một trang hoàn toàn không liên quan. '.repeat(30),
      'Học sinh lớp Một - Wikipedia tiếng Việt',
      request
    ),
    false
  );
});

test('source matcher returns the chunk containing the cited text and rejects unrelated text', () => {
  const match = findBestSourceChunk(
    'Học sinh lớp Một đang phát triển khả năng nhận thức.',
    [documentChunk]
  );
  assert.equal(match?.chunk.id, documentChunk.id);

  const fuzzyMatch = findBestSourceChunk(
    'Học sinh lớp Một phát triển khả năng nhận thức.',
    [documentChunk]
  );
  assert.equal(fuzzyMatch?.chunk.id, documentChunk.id);
  assert.equal(fuzzyMatch?.exact, false);

  assert.equal(findBestSourceChunk('Nội dung không xuất hiện trong đoạn tài liệu.', [documentChunk]), undefined);
});

test('web knowledge package needs review when refs or grounded excerpts are missing', () => {
  const pkg = makeKnowledgePackage();
  assert.deepEqual(getKnowledgeReviewIssues(pkg), []);

  pkg.webSources[0].usedExcerpts = ['Một trích dẫn không có trong trang đã đọc.'];
  assert.equal(getKnowledgeReviewIssues(pkg).some((issue) => issue.includes('trích đoạn')), true);

  pkg.chapters[0].sections[0].sourceRefIds = [];
  pkg.webSources[0].usedExcerpts = [];
  const issues = getKnowledgeReviewIssues(pkg);
  assert.equal(issues.some((issue) => issue.includes('sourceRefIds')), true);
  assert.equal(issues.some((issue) => issue.includes('trích đoạn')), true);
  assert.equal(withKnowledgeReviewStatus(pkg, 'CONFIRMED').status, 'NEEDS_REVIEW');
});
