import { GoogleGenAI, GenerateContentResponse } from '@google/genai';

export const AI_MODEL = 'gemini-4-hydrogen';

export class AiServiceError extends Error {
  statusCode: number;
  code: string;
  step: string;
  retryable: boolean;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      code?: string;
      step?: string;
      retryable?: boolean;
    } = {}
  ) {
    super(message);
    this.name = 'AiServiceError';
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? 'AI_ERROR';
    this.step = options.step ?? 'unknown';
    this.retryable = options.retryable ?? false;
  }
}

let geminiClient: GoogleGenAI | null = null;
let cachedApiKey: string | undefined;

export function getConfiguredApiKey(): string | undefined {
  const candidates = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY1];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && trimmed !== 'MY_GEMINI_API_KEY') {
      return trimmed;
    }
  }
  return undefined;
}

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = getConfiguredApiKey();
  if (!apiKey) {
    return null;
  }
  if (!geminiClient || cachedApiKey !== apiKey) {
    cachedApiKey = apiKey;
    geminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

export function requireGeminiClient(step: string): GoogleGenAI {
  const client = getGeminiClient();
  if (!client) {
    console.error(`[QuizAI][${step}] Neither GEMINI_API_KEY nor GEMINI_API_KEY1 is configured in server environment.`);
    throw new AiServiceError(
      'Hệ thống chưa được cấu hình khóa API Gemini (GEMINI_API_KEY hoặc GEMINI_API_KEY1) trên máy chủ. Vui lòng thiết lập trong Settings > Secrets để sử dụng chức năng AI tạo đề.',
      {
        statusCode: 503,
        code: 'MISSING_API_KEY',
        step,
        retryable: false,
      }
    );
  }
  return client;
}

export function extractJsonFromText<T = unknown>(rawText: string, step: string): T {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Attempt to locate outermost JSON object or array if model included prose
    const firstObj = cleaned.indexOf('{');
    const lastObj = cleaned.lastIndexOf('}');
    const firstArr = cleaned.indexOf('[');
    const lastArr = cleaned.lastIndexOf(']');

    let candidate = '';
    if (firstArr !== -1 && lastArr > firstArr && (firstObj === -1 || firstArr < firstObj)) {
      candidate = cleaned.slice(firstArr, lastArr + 1);
    } else if (firstObj !== -1 && lastObj > firstObj) {
      candidate = cleaned.slice(firstObj, lastObj + 1);
    }

    if (candidate) {
      try {
        return JSON.parse(candidate) as T;
      } catch {
        // Fall through to structured error
      }
    }

    throw new AiServiceError(
      'Mô hình AI trả về định dạng JSON không hợp lệ. Hệ thống không thể phân tích kết quả.',
      {
        statusCode: 422,
        code: 'INVALID_JSON',
        step,
        retryable: true,
      }
    );
  }
}

function classifyProviderError(err: any, step: string): AiServiceError {
  if (err instanceof AiServiceError) {
    return err;
  }

  const msg = String(err?.message || err || 'Lỗi không xác định từ dịch vụ AI');
  const status = Number(err?.status || err?.statusCode || 0);
  const lower = msg.toLowerCase();

  if (status === 429 || lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('quota')) {
    return new AiServiceError(
      'Hệ thống AI đang quá tải hoặc vượt giới hạn tần suất (HTTP 429). Vui lòng thử lại sau ít giây.',
      { statusCode: 429, code: 'RATE_LIMITED', step, retryable: true }
    );
  }

  if (status === 503 || lower.includes('503') || lower.includes('unavailable') || lower.includes('overloaded')) {
    return new AiServiceError(
      'Dịch vụ AI tạm thời không khả dụng (HTTP 503). Vui lòng thử lại sau ít giây.',
      { statusCode: 503, code: 'SERVICE_UNAVAILABLE', step, retryable: true }
    );
  }

  if (status === 401 || status === 403 || lower.includes('api_key_invalid') || lower.includes('permission_denied')) {
    return new AiServiceError(
      'GEMINI_API_KEY không hợp lệ hoặc không đủ quyền truy cập. Vui lòng kiểm tra lại cấu hình Secrets.',
      { statusCode: 403, code: 'INVALID_API_KEY', step, retryable: false }
    );
  }

  if (status === 404 || lower.includes('not_found')) {
    return new AiServiceError(
      `Mô hình AI (${AI_MODEL}) không tìm thấy hoặc không được hỗ trợ trên tài khoản hiện tại.`,
      { statusCode: 404, code: 'MODEL_NOT_FOUND', step, retryable: false }
    );
  }

  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('aborted')) {
    return new AiServiceError(
      'Yêu cầu xử lý AI vượt quá thời gian chờ cho phép (Timeout). Vui lòng thử lại.',
      { statusCode: 504, code: 'TIMEOUT', step, retryable: true }
    );
  }

  return new AiServiceError(
    `Lỗi kết nối hoặc xử lý từ máy chủ AI (${status || 500}): ${msg}`,
    { statusCode: status >= 400 ? status : 500, code: 'PROVIDER_ERROR', step, retryable: status >= 500 || status === 0 }
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, step: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new AiServiceError(
          `Bước "${step}" vượt quá thời gian chờ (${Math.round(timeoutMs / 1000)}s).`,
          { statusCode: 504, code: 'TIMEOUT', step, retryable: true }
        )
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function callGeminiWithRetry<T = GenerateContentResponse>(options: {
  step: string;
  timeoutMs?: number;
  maxRetries?: number;
  fn: (ai: GoogleGenAI) => Promise<GenerateContentResponse>;
  transform?: (response: GenerateContentResponse) => T;
}): Promise<T> {
  const { step, timeoutMs = 45000, maxRetries = 2, fn, transform } = options;
  const ai = requireGeminiClient(step);

  let lastError: AiServiceError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startMs = Date.now();
    try {
      console.log(`[QuizAI][${step}] Attempt ${attempt + 1}/${maxRetries + 1} starting...`);
      const response = await withTimeout(fn(ai), timeoutMs, step);
      const elapsed = Date.now() - startMs;
      console.log(`[QuizAI][${step}] Attempt ${attempt + 1} succeeded in ${elapsed}ms.`);

      if (transform) {
        return transform(response);
      }
      return response as unknown as T;
    } catch (err: any) {
      const classified = classifyProviderError(err, step);
      lastError = classified;
      console.warn(
        `[QuizAI][${step}] Attempt ${attempt + 1} failed (${classified.code}, HTTP ${classified.statusCode}): ${classified.message}`
      );

      if (!classified.retryable || attempt >= maxRetries) {
        throw classified;
      }

      const backoffMs =
        classified.code === 'RATE_LIMITED'
          ? Math.min(12000, 3500 * Math.pow(2, attempt))
          : Math.min(4000, 800 * Math.pow(2, attempt));
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError || new AiServiceError('Lỗi AI không xác định', { step });
}
