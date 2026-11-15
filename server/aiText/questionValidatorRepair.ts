import {
  ExamMatrix,
  KnowledgePackage,
  PipelineStepEvent,
  Question,
  QuestionValidation,
} from '../../src/types';
import { AiServiceError } from '../geminiClient';
import {
  buildExactMatrixFromRequest,
  generateQuestionsFromKnowledge,
} from './aiTextQuestionGenerator';

export interface KnowledgeQuestionValidationResult {
  validQuestions: Question[];
  invalidIndices: number[];
  issuesByIndex: Record<number, string[]>;
  missingCount: number;
  allValid: boolean;
}

function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(
    normalizeForComparison(text)
      .split(' ')
      .filter((t) => t.length >= 2)
  );
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function checkTextGroundedInKnowledge(
  sourceText: string,
  knowledgeCorpusLower: string
): boolean {
  if (!sourceText || sourceText.trim().length < 15) return false;
  const cleanSnippet = normalizeForComparison(sourceText);
  const cleanCorpus = normalizeForComparison(knowledgeCorpusLower);

  if (cleanCorpus.includes(cleanSnippet.slice(0, 40))) {
    return true;
  }

  // Fallback token overlap check (>= 45% of content tokens exist in compiled knowledge)
  const snippetTokens = Array.from(tokenSet(sourceText)).filter((w) => w.length >= 3);
  if (snippetTokens.length === 0) return false;
  const matched = snippetTokens.filter((t) => cleanCorpus.includes(t));
  return matched.length / snippetTokens.length >= 0.45;
}

export function validateSingleKnowledgeQuestion(
  q: Question,
  priorValidQuestions: Question[],
  pkg: KnowledgePackage
): QuestionValidation {
  const issues: string[] = [];

  if (!q.questionText || q.questionText.trim().length < 10) {
    issues.push('Nội dung câu hỏi quá ngắn hoặc bị trống.');
  }

  // 1. Exactly 4 non-empty options A, B, C, D
  const options = q.options || [];
  const hasFourOptions =
    options.length === 4 &&
    ['A', 'B', 'C', 'D'].every((k) => {
      const opt = options.find((o) => o.key === k);
      return Boolean(opt && opt.text && opt.text.trim().length > 0);
    });
  if (!hasFourOptions) {
    issues.push('Câu hỏi phải có đủ 4 phương án A, B, C, D.');
  }

  // 2. No duplicate options
  const normalizedOptions = options.map((o) => normalizeForComparison(o.text || ''));
  const noDuplicateOptions = new Set(normalizedOptions).size === 4;
  if (!noDuplicateOptions) {
    issues.push('Các phương án lựa chọn bị trùng lặp nội dung.');
  }

  // 3. Single valid correctAnswer
  const hasSingleCorrect = ['A', 'B', 'C', 'D'].includes(q.correctAnswer);
  if (!hasSingleCorrect) {
    issues.push('Thiếu một đáp án đúng duy nhất (A, B, C hoặc D).');
  }

  // 4. Explanation present & coherent
  const explanationMatchesSource = Boolean(q.explanation && q.explanation.trim().length >= 15);
  if (!explanationMatchesSource) {
    issues.push('Thiếu giải thích đáp án rõ ràng.');
  }

  // 5. Source mapping & Knowledge Unit link
  const hasSourceMapping = Boolean(
    q.source &&
      q.source.chapter &&
      q.source.section &&
      q.source.knowledgeUnit &&
      q.source.sourceText &&
      q.source.sourceText.trim().length >= 15
  );
  if (!hasSourceMapping) {
    issues.push('Thiếu liên kết tới chương/mục hoặc đoạn nội dung kiến thức căn cứ.');
  }

  // 6. Groundedness in compiled knowledge content
  const answerInSource =
    hasSourceMapping &&
    checkTextGroundedInKnowledge(q.source.sourceText, pkg.compiledMarkdown);
  if (hasSourceMapping && !answerInSource) {
    issues.push('Đoạn căn cứ của câu hỏi không khớp với nội dung kiến thức đã biên soạn.');
  }

  // 7. Pedagogical reason
  const hasReason = Boolean(q.source?.generationReason && q.source.generationReason.trim().length >= 12);
  if (!hasReason) {
    issues.push('Thiếu lý do kiểm tra kiến thức.');
  }

  // 8. Duplicate / near-duplicate question detection
  const isDuplicate = priorValidQuestions.some((existing) => {
    const normA = normalizeForComparison(existing.questionText);
    const normB = normalizeForComparison(q.questionText);
    if (normA === normB) return true;
    return jaccardSimilarity(existing.questionText, q.questionText) >= 0.78;
  });
  if (isDuplicate) {
    issues.push('Câu hỏi bị trùng lặp hoặc quá giống câu hỏi khác trong đề.');
  }

  const isValid = issues.length === 0;

  return {
    isValid,
    status: isValid ? 'VALID' : 'NEEDS_REVIEW',
    checks: {
      hasFourOptions,
      hasSingleCorrect,
      answerInSource,
      explanationMatchesSource,
      hasSourceMapping,
      hasReason,
      noDuplicateOptions,
    },
    issues: issues.length > 0 ? issues : undefined,
  };
}

export function validateGeneratedQuestions(
  questions: Question[],
  pkg: KnowledgePackage
): KnowledgeQuestionValidationResult {
  const validQuestions: Question[] = [];
  const invalidIndices: number[] = [];
  const issuesByIndex: Record<number, string[]> = {};

  questions.forEach((q, idx) => {
    const val = validateSingleKnowledgeQuestion(q, validQuestions, pkg);
    q.validation = val;
    if (val.isValid) {
      validQuestions.push(q);
    } else {
      invalidIndices.push(idx);
      issuesByIndex[idx] = val.issues || ['Câu hỏi không đạt tiêu chuẩn kiểm định.'];
    }
  });

  const targetCount = pkg.request.questionCount;
  const missingCount = Math.max(0, targetCount - validQuestions.length);

  return {
    validQuestions: validQuestions.slice(0, targetCount),
    invalidIndices,
    issuesByIndex,
    missingCount,
    allValid: validQuestions.length >= targetCount && invalidIndices.length === 0,
  };
}

export async function generateAndValidateWithRepair(
  pkg: KnowledgePackage,
  onProgress?: (event: PipelineStepEvent) => void
): Promise<{
  matrix: ExamMatrix;
  questions: Question[];
  repairAttemptsUsed: number;
}> {
  const emit = (
    step: string,
    status: PipelineStepEvent['status'],
    message: string,
    detail?: string
  ) => {
    onProgress?.({
      step,
      status,
      message,
      detail,
      timestamp: new Date().toISOString(),
    });
  };

  const matrix = buildExactMatrixFromRequest(pkg);
  const targetCount = pkg.request.questionCount;
  const MAX_REPAIR_ATTEMPTS = 2;

  emit(
    'matrix',
    'completed',
    `Đã lập ma trận đề ${targetCount} câu (Dễ: ${matrix.totalEasy}, Trung bình: ${matrix.totalMedium}, Khó: ${matrix.totalHard}).`
  );

  emit(
    'generate_questions',
    'running',
    `AI đang biên soạn ${targetCount} câu hỏi trắc nghiệm từ nội dung kiến thức đã xác nhận...`
  );

  let pool = await generateQuestionsFromKnowledge(pkg, matrix);
  let validation = validateGeneratedQuestions(pool, pkg);
  let validPool = [...validation.validQuestions];
  let repairAttemptsUsed = 0;

  emit(
    'validate_questions',
    validation.validQuestions.length >= targetCount ? 'completed' : 'warning',
    `Kiểm định lần 1: ${validation.validQuestions.length}/${targetCount} câu đạt chuẩn.`
  );

  while (validPool.length < targetCount && repairAttemptsUsed < MAX_REPAIR_ATTEMPTS) {
    repairAttemptsUsed++;
    const needed = targetCount - validPool.length;

    // Determine missing difficulties relative to target matrix
    const currentEasy = validPool.filter((q) => q.difficulty === 'easy').length;
    const currentMed = validPool.filter((q) => q.difficulty === 'medium').length;
    const currentHard = validPool.filter((q) => q.difficulty === 'hard').length;

    let remEasy = Math.max(0, matrix.totalEasy - currentEasy);
    let remMed = Math.max(0, matrix.totalMedium - currentMed);
    let remHard = Math.max(0, matrix.totalHard - currentHard);

    const slots: { difficulty: 'easy' | 'medium' | 'hard'; chapterTitle?: string }[] = [];
    for (let i = 0; i < needed; i++) {
      let diff: 'easy' | 'medium' | 'hard' = 'medium';
      if (remEasy > 0) {
        diff = 'easy';
        remEasy--;
      } else if (remMed > 0) {
        diff = 'medium';
        remMed--;
      } else if (remHard > 0) {
        diff = 'hard';
        remHard--;
      }
      const chapter = pkg.documentSource.chapters[i % pkg.documentSource.chapters.length];
      slots.push({ difficulty: diff, chapterTitle: chapter?.title });
    }

    emit(
      'repair_questions',
      'running',
      `Đang tạo bù/sửa ${needed} câu hỏi chưa đạt hoặc bị thiếu (Lần thử ${repairAttemptsUsed}/${MAX_REPAIR_ATTEMPTS})...`
    );

    const replacements = await generateQuestionsFromKnowledge(pkg, matrix, {
      targetSlots: slots,
      excludeQuestionTexts: validPool.map((q) => q.questionText),
    });

    for (const candidate of replacements) {
      if (validPool.length >= targetCount) break;
      const check = validateSingleKnowledgeQuestion(candidate, validPool, pkg);
      candidate.validation = check;
      if (check.isValid) {
        validPool.push(candidate);
      }
    }
  }

  if (validPool.length < targetCount) {
    const missing = targetCount - validPool.length;
    console.error(
      `[QuizAI][validate_questions] Failed after ${repairAttemptsUsed} repair attempts: got ${validPool.length}/${targetCount} valid questions.`
    );
    throw new AiServiceError(
      `Không thể hoàn tất bộ đề đạt chuẩn sau ${MAX_REPAIR_ATTEMPTS} lần kiểm định sửa lỗi (chỉ đạt ${validPool.length}/${targetCount} câu hợp lệ, còn thiếu ${missing} câu). Bộ đề chưa được lưu để đảm bảo chất lượng.`,
      {
        statusCode: 422,
        code: 'INCOMPLETE_OR_INVALID_QUIZ',
        step: 'validate_questions',
        retryable: true,
      }
    );
  }

  // Final sequential numbering
  const finalQuestions = validPool.slice(0, targetCount).map((q, idx) => ({
    ...q,
    questionNumber: idx + 1,
  }));

  emit(
    'validate_questions',
    'completed',
    `Kiểm định hoàn tất: 100% (${finalQuestions.length}/${targetCount}) câu hỏi đạt chuẩn chất lượng.`
  );

  return {
    matrix,
    questions: finalQuestions,
    repairAttemptsUsed,
  };
}
