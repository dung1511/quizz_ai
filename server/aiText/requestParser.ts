import { ThinkingLevel, Type } from '@google/genai';
import {
  DifficultyDistribution,
  DifficultyLevel,
  ParsedQuizRequest,
} from '../../src/types';
import {
  AI_MODEL,
  AiServiceError,
  callGeminiWithRetry,
  extractJsonFromText,
} from '../geminiClient';
import { saveAiRequest } from '../storage';
import { normalizeQuizTitle } from '../../src/utils/quizTitle';

export interface ParseRequestInput {
  rawPrompt: string;
  quizTitle?: string;
  questionCount?: number;
  difficultyMode?: DifficultyLevel;
}

interface RawAiParsedResponse {
  quizTitle?: string;
  topic?: string;
  subject?: string;
  audience?: string;
  questionCount?: number;
  difficultyMode?: 'easy' | 'medium' | 'hard' | 'all';
  difficulty?: {
    easy?: number;
    medium?: number;
    hard?: number;
  };
  knowledgeAreas?: string[];
  focusChapters?: string[];
  language?: string;
  includeExplanation?: boolean;
  needsWebResearch?: boolean;
}

export function balanceDifficultyDistribution(
  total: number,
  mode: DifficultyLevel,
  suggested?: Partial<DifficultyDistribution>
): DifficultyDistribution {
  const safeTotal = Math.max(1, Math.min(50, Math.round(total)));

  if (
    suggested &&
    typeof suggested.easy === 'number' &&
    typeof suggested.medium === 'number' &&
    typeof suggested.hard === 'number'
  ) {
    const e = Math.max(0, Math.round(suggested.easy));
    const m = Math.max(0, Math.round(suggested.medium));
    const h = Math.max(0, Math.round(suggested.hard));
    const sum = e + m + h;

    if (sum === safeTotal) {
      return { easy: e, medium: m, hard: h };
    }
    if (sum > 0) {
      let scaledE = Math.round((e / sum) * safeTotal);
      let scaledM = Math.round((m / sum) * safeTotal);
      let scaledH = safeTotal - scaledE - scaledM;
      if (scaledH < 0) {
        scaledM = Math.max(0, scaledM + scaledH);
        scaledH = safeTotal - scaledE - scaledM;
      }
      if (scaledE + scaledM + scaledH === safeTotal && scaledE >= 0 && scaledM >= 0 && scaledH >= 0) {
        return { easy: scaledE, medium: scaledM, hard: scaledH };
      }
    }
  }

  let easy = 0;
  let medium = 0;
  let hard = 0;

  if (mode === 'easy') {
    easy = Math.round(safeTotal * 0.65);
    medium = Math.round(safeTotal * 0.25);
    hard = safeTotal - easy - medium;
  } else if (mode === 'hard') {
    hard = Math.round(safeTotal * 0.55);
    medium = Math.round(safeTotal * 0.3);
    easy = safeTotal - hard - medium;
  } else {
    // Balanced distribution for 'medium' or 'all'
    easy = Math.round(safeTotal * 0.3);
    medium = Math.round(safeTotal * 0.45);
    hard = safeTotal - easy - medium;
  }

  // Clamp any rounding edge cases
  if (easy < 0) easy = 0;
  if (medium < 0) medium = 0;
  if (hard < 0) hard = 0;
  const diff = safeTotal - (easy + medium + hard);
  medium = Math.max(0, medium + diff);

  return { easy, medium, hard };
}

export function normalizeParsedRequest(
  raw: RawAiParsedResponse,
  input: ParseRequestInput
): ParsedQuizRequest {
  const trimmedPrompt = input.rawPrompt.trim();
  const topic = normalizeQuizTitle(raw.topic || trimmedPrompt).slice(0, 120);
  const subject = (raw.subject || topic).trim();
  const audience = (raw.audience || 'Học sinh / Sinh viên').trim();

  // Respect explicit UI override if user provided a positive questionCount
  const requestedCount =
    typeof input.questionCount === 'number' && input.questionCount > 0
      ? input.questionCount
      : Number(raw.questionCount) || 10;
  const questionCount = Math.max(1, Math.min(50, Math.round(requestedCount)));

  const effectiveMode: DifficultyLevel =
    input.difficultyMode && input.difficultyMode !== 'all'
      ? input.difficultyMode
      : raw.difficultyMode || 'medium';

  // If user explicitly overrode count or mode without matching raw distribution, recompute cleanly
  const useSuggestedDist =
    !(typeof input.questionCount === 'number' && input.questionCount > 0 && input.questionCount !== raw.questionCount) &&
    !(input.difficultyMode && input.difficultyMode !== 'all' && input.difficultyMode !== raw.difficultyMode);

  const difficulty = balanceDifficultyDistribution(
    questionCount,
    effectiveMode,
    useSuggestedDist ? raw.difficulty : undefined
  );

  const rawAreas = Array.isArray(raw.knowledgeAreas)
    ? raw.knowledgeAreas.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const knowledgeAreas =
    rawAreas.length > 0
      ? Array.from(new Set(rawAreas)).slice(0, 8)
      : [
          `Khái niệm nền tảng về ${topic}`,
          `Nguyên lý và cấu trúc cốt lõi`,
          `Ứng dụng và bài tập thực tiễn`,
        ];

  const rawFocus = Array.isArray(raw.focusChapters)
    ? raw.focusChapters.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const focusChapters = rawFocus.length > 0 ? rawFocus : knowledgeAreas;

  const quizTitle =
    normalizeQuizTitle(input.quizTitle || '') ||
    normalizeQuizTitle(raw.quizTitle || '') ||
    `Đề trắc nghiệm: ${topic}`;

  return {
    id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    quizTitle,
    rawPrompt: trimmedPrompt,
    topic,
    subject,
    audience,
    questionCount,
    difficultyMode: effectiveMode,
    difficulty,
    knowledgeAreas,
    focusChapters,
    language: (raw.language || 'Tiếng Việt').trim(),
    optionsCount: 4,
    includeExplanation: raw.includeExplanation !== false,
    needsWebResearch: raw.needsWebResearch !== false,
    createdAt: new Date().toISOString(),
  };
}

export async function parseUserRequest(input: ParseRequestInput): Promise<ParsedQuizRequest> {
  const promptText = (input.rawPrompt || '').trim();
  if (!promptText || promptText.length < 2) {
    throw new AiServiceError('Vui lòng nhập yêu cầu hoặc chủ đề muốn tạo đề trắc nghiệm.', {
      statusCode: 400,
      code: 'EMPTY_PROMPT',
      step: 'parse-request',
      retryable: false,
    });
  }

  const systemInstruction = `Bạn là chuyên gia phân tích yêu cầu khảo thí và thiết kế chương trình đào tạo.
Nhiệm vụ: Phân tích yêu cầu ngôn ngữ tự nhiên của người dùng thành cấu hình chuẩn để hệ thống nghiên cứu kiến thức và tạo đề trắc nghiệm.

Quy tắc bắt buộc:
1. Hiểu linh hoạt mọi kiểu yêu cầu (ngắn như "Python", trung bình hoặc chi tiết với tỷ lệ câu dễ/trung bình/khó).
2. Nếu người dùng nêu rõ số lượng từng mức độ (ví dụ: "10 dễ, 10 trung bình, 5 khó"), giữ đúng các con số đó và đặt questionCount = tổng của chúng.
3. Nếu người dùng KHÔNG nêu số câu, mặc định questionCount = 10.
4. Nếu người dùng KHÔNG nêu phân bổ độ khó, tự đề xuất phân bổ hợp lý sao cho easy + medium + hard = questionCount.
5. Nếu người dùng KHÔNG nêu phạm vi kiến thức chi tiết, tự đề xuất 4-6 mảng kiến thức trọng tâm chuẩn học thuật cho chủ đề đó.
6. Đặt needsWebResearch = true theo mặc định để hệ thống ưu tiên nghiên cứu nguồn tài liệu chính thức/học thuật trên web (chỉ đặt false nếu người dùng yêu cầu rõ không cần tra cứu web).
7. Trả về JSON hợp lệ theo schema.`;

  const userContext = `Yêu cầu gốc của người dùng: "${promptText}"
${input.quizTitle ? `Tên bộ đề người dùng nhập: "${input.quizTitle}"` : ''}
${input.questionCount ? `Số câu người dùng chọn bổ sung: ${input.questionCount}` : ''}
${input.difficultyMode ? `Độ khó người dùng chọn bổ sung: ${input.difficultyMode}` : ''}`;

  const parsed = await callGeminiWithRetry<RawAiParsedResponse>({
    step: 'parse-request',
    timeoutMs: 45000,
    maxRetries: 2,
    fn: (ai, model) =>
      ai.models.generateContent({
        model,
        contents: userContext,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              quizTitle: { type: Type.STRING, description: 'Tên đề thi ngắn gọn, học thuật.' },
              topic: { type: Type.STRING, description: 'Chủ đề chính của đề thi.' },
              subject: { type: Type.STRING, description: 'Môn học hoặc lĩnh vực chuyên môn.' },
              audience: { type: Type.STRING, description: 'Đối tượng người học (ví dụ: Sinh viên năm nhất).' },
              questionCount: { type: Type.INTEGER, description: 'Tổng số câu hỏi (1-50).' },
              difficultyMode: {
                type: Type.STRING,
                description: 'Một trong: easy, medium, hard, all.',
              },
              difficulty: {
                type: Type.OBJECT,
                properties: {
                  easy: { type: Type.INTEGER },
                  medium: { type: Type.INTEGER },
                  hard: { type: Type.INTEGER },
                },
                required: ['easy', 'medium', 'hard'],
              },
              knowledgeAreas: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Danh sách 4-6 mảng kiến thức hoặc chương trọng tâm.',
              },
              focusChapters: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Các phần kiến thức được người dùng nhấn mạnh nếu có.',
              },
              language: { type: Type.STRING, description: 'Ngôn ngữ của đề thi (ví dụ: Tiếng Việt).' },
              includeExplanation: { type: Type.BOOLEAN },
              needsWebResearch: { type: Type.BOOLEAN },
            },
            required: [
              'quizTitle',
              'topic',
              'subject',
              'audience',
              'questionCount',
              'difficulty',
              'knowledgeAreas',
              'language',
              'includeExplanation',
            ],
          },
        },
      }),
    transform: (res) => {
      if (!res.text) {
        throw new AiServiceError('Mô hình AI không trả về dữ liệu phân tích yêu cầu.', {
          statusCode: 502,
          code: 'EMPTY_RESPONSE',
          step: 'parse-request',
          retryable: true,
        });
      }
      return extractJsonFromText<RawAiParsedResponse>(res.text, 'parse-request');
    },
  });

  const normalized = normalizeParsedRequest(parsed, input);
  await saveAiRequest(normalized);
  return normalized;
}
