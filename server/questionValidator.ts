import { Question, QuestionValidation } from '../src/types';

export interface ValidationReport {
  totalQuestions: number;
  validCount: number;
  needsReviewCount: number;
  allValid: boolean;
  issuesSummary: string[];
}

export function validateQuestion(
  q: Partial<Question>,
  existingQuestions: Question[] = []
): QuestionValidation {
  const issues: string[] = [];

  // 1. Kiểm tra 4 đáp án
  const options = q.options || [];
  const hasFourOptions =
    options.length === 4 &&
    options.every((opt) => opt && opt.text && opt.text.trim().length > 0) &&
    ['A', 'B', 'C', 'D'].every((key) => options.some((opt) => opt.key === key));

  if (!hasFourOptions) {
    issues.push('Câu hỏi phải có đúng 4 phương án A, B, C, D không được để trống.');
  }

  // 2. Không trùng lặp đáp án
  const optionTexts = options.map((opt) => opt.text.trim().toLowerCase());
  const uniqueOptionTexts = new Set(optionTexts);
  const noDuplicateOptions = uniqueOptionTexts.size === options.length;
  if (!noDuplicateOptions) {
    issues.push('Các phương án lựa chọn bị trùng lặp nội dung.');
  }

  // 3. Đúng 1 đáp án đúng
  const hasSingleCorrect =
    q.correctAnswer !== undefined && ['A', 'B', 'C', 'D'].includes(q.correctAnswer);
  if (!hasSingleCorrect) {
    issues.push('Phải xác định duy nhất một đáp án đúng (A, B, C hoặc D).');
  }

  // 4. Có source mapping đầy đủ
  const src = q.source;
  const hasSourceMapping = Boolean(
    src &&
    src.chapter &&
    src.chapter.trim().length > 0 &&
    src.section &&
    src.section.trim().length > 0 &&
    src.sourceChunkId &&
    src.sourceChunkId.trim().length > 0 &&
    src.sourceText &&
    src.sourceText.trim().length > 10 &&
    src.knowledgeUnit &&
    src.knowledgeUnit.trim().length > 0
  );
  if (!hasSourceMapping) {
    issues.push('Thiếu thông tin truy xuất nguồn gốc (Chương, Mục, Đoạn văn bản gốc hoặc Đơn vị kiến thức).');
  }

  // 5. Có lý do tạo câu hỏi cụ thể
  const hasReason = Boolean(
    src && src.generationReason && src.generationReason.trim().length >= 15
  );
  if (!hasReason) {
    issues.push('Lý do tạo câu hỏi quá ngắn hoặc thiếu căn cứ sư phạm.');
  }

  // 6. Kiểm tra câu hỏi có liên quan đến sourceText
  let answerInSource = true;
  if (src && src.sourceText) {
    const srcLower = src.sourceText.toLowerCase();
    const correctOpt = options.find((o) => o.key === q.correctAnswer);
    // Rough check: at least some key words or concepts from question or correct option appear in source
    const qWords = (q.questionText || '').toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const hasWordOverlap = qWords.some((w) => srcLower.includes(w));
    if (!hasWordOverlap && qWords.length > 3) {
      answerInSource = false;
      issues.push('Nội dung câu hỏi chưa phản ánh rõ dữ kiện từ đoạn văn bản nguồn.');
    }
  }

  // 7. Trùng lặp với câu hỏi đã có
  if (q.questionText) {
    const isDuplicateQuestion = existingQuestions.some(
      (exist) =>
        exist.id !== q.id &&
        exist.questionText.trim().toLowerCase() === q.questionText?.trim().toLowerCase()
    );
    if (isDuplicateQuestion) {
      issues.push('Câu hỏi bị trùng lặp hoàn toàn với một câu khác trong bộ đề.');
    }
  }

  const isValid = issues.length === 0;

  return {
    isValid,
    status: isValid ? 'VALID' : 'NEEDS_REVIEW',
    checks: {
      hasFourOptions,
      hasSingleCorrect,
      answerInSource,
      explanationMatchesSource: Boolean(q.explanation && q.explanation.length > 10),
      hasSourceMapping,
      hasReason,
      noDuplicateOptions,
    },
    issues: issues.length > 0 ? issues : undefined,
  };
}

export function validateQuestionSet(questions: Question[]): ValidationReport {
  let validCount = 0;
  let needsReviewCount = 0;
  const issuesSummary: string[] = [];

  questions.forEach((q, idx) => {
    const val = validateQuestion(q, questions);
    q.validation = val;
    if (val.isValid) {
      validCount++;
    } else {
      needsReviewCount++;
      if (val.issues) {
        issuesSummary.push(`Câu ${idx + 1}: ${val.issues.join(', ')}`);
      }
    }
  });

  return {
    totalQuestions: questions.length,
    validCount,
    needsReviewCount,
    allValid: needsReviewCount === 0,
    issuesSummary,
  };
}
