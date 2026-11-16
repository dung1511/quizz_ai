import { ThinkingLevel, Type } from '@google/genai';
import {
  ChapterDistribution,
  ExamMatrix,
  KnowledgePackage,
  QuestionIllustration,
  Question,
} from '../../src/types';
import {
  AI_MODEL,
  AiServiceError,
  callGeminiWithRetry,
  extractJsonFromText,
} from '../geminiClient';
import { sanitizeTikzCode } from '../../src/utils/tikzValidation';
import { findBestSourceChunk } from '../sourceMatcher';

export function buildExactMatrixFromRequest(pkg: KnowledgePackage): ExamMatrix {
  const { difficulty, questionCount } = pkg.request;
  const chapters = pkg.documentSource.chapters;
  const chapCount = Math.max(1, chapters.length);

  // Distribute easy, medium, hard counts across chapters so totals match request EXACTLY
  let remEasy = difficulty.easy;
  let remMed = difficulty.medium;
  let remHard = difficulty.hard;

  const distributions: ChapterDistribution[] = chapters.map((chap, idx) => {
    const remainingChaps = chapCount - idx;
    const targetTotalForChap = Math.floor((remEasy + remMed + remHard) / remainingChaps);

    const easy = idx === chapCount - 1 ? remEasy : Math.min(remEasy, Math.round((remEasy / remainingChaps)));
    remEasy -= easy;

    const medium =
      idx === chapCount - 1
        ? remMed
        : Math.min(remMed, Math.max(0, Math.round(remMed / remainingChaps)));
    remMed -= medium;

    const hard =
      idx === chapCount - 1
        ? remHard
        : Math.min(remHard, Math.max(0, targetTotalForChap - easy - medium));
    remHard -= hard;

    return {
      chapterId: chap.id,
      chapterTitle: chap.title,
      easy,
      medium,
      hard,
      total: easy + medium + hard,
    };
  });

  // Safety pass if any remainder left
  if (remEasy + remMed + remHard > 0 && distributions.length > 0) {
    distributions[0].easy += remEasy;
    distributions[0].medium += remMed;
    distributions[0].hard += remHard;
    distributions[0].total =
      distributions[0].easy + distributions[0].medium + distributions[0].hard;
  }

  return {
    chapterDistributions: distributions,
    totalEasy: difficulty.easy,
    totalMedium: difficulty.medium,
    totalHard: difficulty.hard,
    grandTotal: questionCount,
  };
}

interface RawGeneratedQuestionItem {
  questionText?: string;
  options?: { key?: string; text?: string }[];
  correctAnswer?: string;
  explanation?: string;
  difficulty?: string;
  topic?: string;
  chapter?: string;
  section?: string;
  knowledgeUnit?: string;
  sourceText?: string;
  generationReason?: string;
  sourceRefId?: string;
  illustration?: {
    needsImage?: boolean;
    imageType?: QuestionIllustration['imageType'];
    imagePrompt?: string;
    tikzCode?: string;
    caption?: string;
  };
}

function normalizeSourceLabel(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function getSectionSourceRefIds(
  pkg: KnowledgePackage,
  chapter: string,
  section: string,
  knowledgeUnit: string
): string[] {
  if (pkg.contentOrigin !== 'WEB') return [];

  const normalizedChapter = normalizeSourceLabel(chapter);
  const normalizedSection = normalizeSourceLabel(section);
  const normalizedUnit = normalizeSourceLabel(knowledgeUnit);
  const candidates = pkg.chapters.flatMap((chapterItem) =>
    chapterItem.sections.map((sectionItem) => ({
      chapterItem,
      sectionItem,
    }))
  );
  const chapterCandidates = normalizedChapter
    ? candidates.filter(({ chapterItem }) => {
        const title = normalizeSourceLabel(chapterItem.title);
        return title.includes(normalizedChapter) || normalizedChapter.includes(title);
      })
    : [];
  const relevantCandidates = chapterCandidates.length > 0 ? chapterCandidates : candidates;

  const scoredCandidates = relevantCandidates
    .map(({ sectionItem }) => {
      const sectionNumber = normalizeSourceLabel(sectionItem.sectionNumber);
      const sectionTitle = normalizeSourceLabel(sectionItem.title);
      const matchesSection =
        !!normalizedSection &&
        ((sectionNumber &&
          (normalizedSection === sectionNumber ||
            normalizedSection.startsWith(`${sectionNumber} `))) ||
          (sectionTitle &&
            (normalizedSection.includes(sectionTitle) ||
              sectionTitle.includes(normalizedSection))));
      const matchesKnowledgeUnit =
        !!normalizedUnit &&
        sectionItem.concepts.some((concept) => {
          const conceptName = normalizeSourceLabel(concept.name);
          return (
            conceptName &&
            (normalizedUnit === conceptName ||
              normalizedUnit.includes(conceptName) ||
              conceptName.includes(normalizedUnit))
          );
        });

      return {
        sectionItem,
        score: (matchesSection ? 2 : 0) + (matchesKnowledgeUnit ? 1 : 0),
      };
    })
    .filter(({ score }) => score > 0);

  if (scoredCandidates.length === 0) return [];

  const bestScore = Math.max(...scoredCandidates.map(({ score }) => score));
  const bestMatches = scoredCandidates.filter(({ score }) => score === bestScore);
  const referenceSets = new Set(
    bestMatches.map(({ sectionItem }) =>
      [...new Set(sectionItem.sourceRefIds || [])].sort().join('|')
    )
  );

  if (referenceSets.size !== 1) return [];

  return [...new Set(bestMatches.flatMap(({ sectionItem }) => sectionItem.sourceRefIds || []))];
}

function mapRawItemToQuestion(
  item: RawGeneratedQuestionItem,
  idx: number,
  pkg: KnowledgePackage
): Question {
  const validKeys: ('A' | 'B' | 'C' | 'D')[] = ['A', 'B', 'C', 'D'];
  const rawOptions = Array.isArray(item.options) ? item.options : [];
  const options = validKeys.map((k, kIdx) => {
    const matched = rawOptions.find((o) => String(o?.key || '').toUpperCase() === k) || rawOptions[kIdx];
    return {
      key: k,
      text: String(matched?.text || '').trim(),
    };
  });

  const rawAnswer = String(item.correctAnswer || 'A').trim().toUpperCase();
  const correctAnswer: 'A' | 'B' | 'C' | 'D' = validKeys.includes(rawAnswer as any)
    ? (rawAnswer as 'A' | 'B' | 'C' | 'D')
    : 'A';

  const rawDiff = String(item.difficulty || 'medium').trim().toLowerCase();
  const difficulty: 'easy' | 'medium' | 'hard' =
    rawDiff === 'easy' || rawDiff === 'hard' ? rawDiff : 'medium';

  const fallbackChapter = pkg.documentSource.chapters[0]?.title || 'Chương 1';
  const fallbackSection = pkg.documentSource.chapters[0]?.sections[0]
    ? `${pkg.documentSource.chapters[0].sections[0].sectionNumber} ${pkg.documentSource.chapters[0].sections[0].title}`
    : '1.1 Kiến thức trọng tâm';

  const requestedChapter = (item.chapter || fallbackChapter).trim();
  const requestedSection = (item.section || fallbackSection).trim();
  const kuName = (item.knowledgeUnit || item.topic || requestedSection).trim();
  const sourceText = (item.sourceText || '').trim();
  const generationReason = (item.generationReason || '').trim();
  const matchedChunk = findBestSourceChunk(sourceText, pkg.documentSource.chunks, {
    chapter: requestedChapter,
    section: requestedSection,
  });
  const chapter = matchedChunk?.chunk.chapterTitle || requestedChapter;
  const section = matchedChunk?.chunk.sectionTitle || requestedSection;
  const sectionSourceRefIds = getSectionSourceRefIds(pkg, chapter, section, kuName);

  const matchedWebSource =
    pkg.contentOrigin === 'WEB'
      ? pkg.webSources.find(
          (source) => source.id === item.sourceRefId && sectionSourceRefIds.includes(source.id)
        ) ||
        pkg.webSources.find((source) => sectionSourceRefIds.includes(source.id))
      : undefined;

  return {
    id: `q-aitext-${Date.now()}-${idx + 1}-${Math.random().toString(36).slice(2, 6)}`,
    questionNumber: idx + 1,
    questionText: (item.questionText || '').trim(),
    options,
    correctAnswer,
    explanation: (item.explanation || '').trim(),
    difficulty,
    topic: (item.topic || kuName).trim(),
    source: {
      documentId: pkg.documentSource.id,
      documentName: pkg.documentSource.fileName,
      chapter,
      section,
      page: matchedChunk?.chunk.pageNumber || 1,
      sourceChunkId: matchedChunk?.chunk.id || '',
      sourceText:
        matchedChunk && !matchedChunk.exact ? matchedChunk.chunk.content : sourceText,
      knowledgeUnit: kuName,
      generationReason,
      contentOrigin: pkg.contentOrigin,
      webSourceTitle: matchedWebSource?.title,
      webSourceUrl: matchedWebSource?.url,
      retrievedAt: matchedWebSource?.retrievedAt,
    },
    illustration: item.illustration?.needsImage
      ? {
          needsImage: true,
          imageType: item.illustration.imageType || 'diagram',
          imagePrompt: item.illustration.imagePrompt || `Hình minh họa cho: ${item.questionText || kuName}`,
          tikzCode: sanitizeTikzCode(item.illustration.tikzCode),
          caption: item.illustration.caption || `Minh họa: ${kuName}`,
        }
      : undefined,
    validation: {
      isValid: false,
      status: 'NEEDS_REVIEW',
      checks: {
        hasFourOptions: false,
        hasSingleCorrect: false,
        answerInSource: false,
        explanationMatchesSource: false,
        hasSourceMapping: false,
        hasReason: false,
        noDuplicateOptions: false,
      },
    },
  };
}

export async function generateQuestionsFromKnowledge(
  pkg: KnowledgePackage,
  matrix: ExamMatrix,
  options: {
    targetSlots?: { difficulty: 'easy' | 'medium' | 'hard'; chapterTitle?: string }[];
    excludeQuestionTexts?: string[];
  } = {}
): Promise<Question[]> {
  const count = options.targetSlots ? options.targetSlots.length : pkg.request.questionCount;
  const knowledgeUnitsList = pkg.documentSource.knowledgeUnits
    .map((ku) => {
      const sourceRefIds = getSectionSourceRefIds(pkg, ku.chapter, ku.section, ku.name);
      const sourceNote = sourceRefIds.length > 0 ? ` [Nguồn web: ${sourceRefIds.join(', ')}]` : '';
      return `- [${ku.chapter} | ${ku.section}] ${ku.name}: ${ku.sourceText.slice(0, 200)}${sourceNote}`;
    })
    .join('\n');

  const sourceListText =
    pkg.contentOrigin === 'WEB' && pkg.webSources.length > 0
      ? `\nDANH SÁCH NGUỒN WEB ĐÃ XÁC THỰC (dùng cho trường sourceRefId):\n${pkg.webSources
          .map((s) => `- ${s.id}: ${s.title} (${s.url})`)
          .join('\n')}`
      : '';

  const slotSpecText = options.targetSlots
    ? `Hãy tạo chính xác ${count} câu hỏi bổ sung/thay thế theo phân bổ sau:\n${options.targetSlots
        .map((s, i) => `Câu ${i + 1}: độ khó "${s.difficulty}"${s.chapterTitle ? `, ưu tiên chương "${s.chapterTitle}"` : ''}`)
        .join('\n')}`
    : `Hãy tạo chính xác ${count} câu hỏi với phân bổ độ khó BẮT BUỘC:
- Số câu Dễ (easy): ${matrix.totalEasy}
- Số câu Trung bình (medium): ${matrix.totalMedium}
- Số câu Khó (hard): ${matrix.totalHard}
Phân bổ theo từng chương: ${JSON.stringify(
        matrix.chapterDistributions.map((d) => ({
          chapter: d.chapterTitle,
          total: d.total,
          easy: d.easy,
          medium: d.medium,
          hard: d.hard,
        }))
      )}`;

  const excludeBlock =
    options.excludeQuestionTexts && options.excludeQuestionTexts.length > 0
      ? `\nTUYỆT ĐỐI KHÔNG TRÙNG LẶP hoặc hỏi lại nội dung tương tự các câu hỏi đã có sau đây:\n${options.excludeQuestionTexts
          .map((t, i) => `${i + 1}. ${t}`)
          .join('\n')}`
      : '';

  const systemInstruction = `Bạn là Chuyên gia Khảo thí thiết kế đề thi trắc nghiệm chuẩn đại học.
Nhiệm vụ: Tạo câu hỏi trắc nghiệm 4 phương án (A, B, C, D) CHỈ DỰA TRÊN tài liệu học tập đã được xác nhận dưới đây.

QUY TẮC BẮT BUỘC:
1. Chỉ tạo câu hỏi nằm trong phạm vi kiến thức của tài liệu học tập đã biên soạn. Không tự ý bịa thêm kiến thức ngoài tài liệu.
2. Mỗi câu hỏi có ĐÚNG 4 phương án A, B, C, D khác nhau hoàn toàn về nội dung và ĐÚNG 1 đáp án đúng duy nhất.
3. Phân bổ đều vị trí đáp án đúng qua A, B, C, D (không dồn hết vào A).
4. Các phương án nhiễu phải hợp lý về mặt học thuật, không ngớ ngẩn.
5. ${
    pkg.request.includeExplanation
      ? 'Bắt buộc cung cấp giải thích chi tiết (explanation) thống nhất với đáp án đúng và trích dẫn căn cứ.'
      : 'Cung cấp giải thích ngắn gọn (explanation) nêu rõ đáp án đúng dựa trên đoạn nào.'
  }
6. Trường "sourceText" phải là đoạn nội dung nguyên văn (ít nhất 25 ký tự) trích trực tiếp từ tài liệu học tập làm căn cứ tạo câu hỏi.
7. Trường "generationReason" phải giải thích ngắn gọn câu hỏi này kiểm tra đơn vị kiến thức nào và tại sao quan trọng (ít nhất 20 ký tự).
8. Nếu bộ tài liệu có nguồn Web, trường "sourceRefId" phải là ID của nguồn được liệt kê ngay cạnh đơn vị kiến thức tương ứng; không chọn nguồn khác mục chỉ để điền ID.
9. Với biểu thức toán học, dùng LaTeX inline dạng $...$ khi phù hợp. Với câu hỏi về khối chóp, lăng trụ, hình học không gian, đồ thị hàm số có đủ dữ kiện, miền diện tích tích phân hoặc biểu diễn hình học số phức, hãy tạo sơ đồ TikZ khi hình giúp hiểu bài; không bỏ hình nếu câu hỏi cần đọc hình để trả lời. Gắn illustration.needsImage = true và tikzCode chỉ gồm lệnh vẽ bên trong tikzpicture. Chỉ dùng draw, fill, node, coordinate, path, addplot và môi trường axis/scope; không dùng lệnh đọc/ghi tệp, định nghĩa macro hay lệnh hệ thống.
10. Ngôn ngữ: ${pkg.request.language}. Đối tượng: ${pkg.request.audience}.`;

  const prompt = `TÀI LIỆU HỌC TẬP ĐÃ XÁC NHẬN (Chủ đề: ${pkg.topic}):
"""
${pkg.compiledMarkdown.slice(0, 18000)}
"""

CÁC ĐƠN VỊ KIẾN THỨC:
${knowledgeUnitsList}
${sourceListText}

YÊU CẦU SỐ LƯỢNG VÀ ĐỘ KHÓ:
${slotSpecText}
${excludeBlock}

Trả về JSON array gồm đúng ${count} phần tử câu hỏi.`;

  const rawItems = await callGeminiWithRetry<RawGeneratedQuestionItem[]>({
    step: options.targetSlots ? 'repair-questions' : 'generate-questions',
    timeoutMs: 75000,
    maxRetries: 2,
    fn: (ai, model) =>
      ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                questionText: { type: Type.STRING },
                options: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      key: { type: Type.STRING },
                      text: { type: Type.STRING },
                    },
                    required: ['key', 'text'],
                  },
                },
                correctAnswer: { type: Type.STRING },
                explanation: { type: Type.STRING },
                difficulty: { type: Type.STRING },
                topic: { type: Type.STRING },
                chapter: { type: Type.STRING },
                section: { type: Type.STRING },
                knowledgeUnit: { type: Type.STRING },
                sourceText: { type: Type.STRING },
                generationReason: { type: Type.STRING },
                sourceRefId: { type: Type.STRING },
                illustration: {
                  type: Type.OBJECT,
                  properties: {
                    needsImage: { type: Type.BOOLEAN },
                    imageType: { type: Type.STRING },
                    imagePrompt: { type: Type.STRING },
                    tikzCode: { type: Type.STRING },
                    caption: { type: Type.STRING },
                  },
                },
              },
              required: [
                'questionText',
                'options',
                'correctAnswer',
                'explanation',
                'difficulty',
                'topic',
                'chapter',
                'section',
                'knowledgeUnit',
                'sourceText',
                'generationReason',
                ...(pkg.contentOrigin === 'WEB' ? ['sourceRefId'] : []),
              ],
            },
          },
        },
      }),
    transform: (res) => {
      if (!res.text) {
        throw new AiServiceError('Mô hình AI không trả về dữ liệu câu hỏi.', {
          statusCode: 502,
          code: 'EMPTY_QUESTIONS',
          step: 'generate-questions',
          retryable: true,
        });
      }
      const parsed = extractJsonFromText<RawGeneratedQuestionItem[]>(res.text, 'generate-questions');
      if (!Array.isArray(parsed)) {
        throw new AiServiceError('Kết quả sinh câu hỏi không phải là danh sách JSON hợp lệ.', {
          statusCode: 422,
          code: 'INVALID_QUESTIONS_JSON',
          step: 'generate-questions',
          retryable: true,
        });
      }
      return parsed;
    },
  });

  return rawItems.map((item, idx) => mapRawItemToQuestion(item, idx, pkg));
}
