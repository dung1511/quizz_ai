import {
  DocumentSource,
  QuizSet,
  QuizAttempt,
  QuizAttemptRecord,
  Question,
  ExamMatrix,
  DifficultyLevel,
  ExamPaperConfig,
  SampleDocument,
  ParsedQuizRequest,
  KnowledgePackage,
  KnowledgeChapterItem,
  PipelineStepEvent,
  AccountUser,
} from '../types';

async function readApiError(res: Response, fallback: string): Promise<string> {
  const errorData: unknown = await res.json().catch(() => null);
  if (
    typeof errorData === 'object' &&
    errorData !== null &&
    'error' in errorData &&
    typeof errorData.error === 'string'
  ) {
    return errorData.error;
  }
  return fallback;
}

export async function getCurrentUserApi(): Promise<AccountUser | null> {
  const res = await fetch('/api/auth/me');
  if (!res.ok) throw new Error(await readApiError(res, 'Không thể xác minh phiên đăng nhập.'));
  let data: { user: AccountUser | null };
  try {
    data = (await res.json()) as { user: AccountUser | null };
  } catch {
    throw new Error('API tài khoản chưa sẵn sàng. Hãy khởi động lại máy chủ npm run dev.');
  }
  return data.user;
}

async function submitAuthApi(
  endpoint: '/api/auth/login' | '/api/auth/register',
  body: { email: string; password: string; displayName?: string }
): Promise<AccountUser> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readApiError(res, 'Không thể đăng nhập.'));
  const data = (await res.json()) as { user: AccountUser };
  return data.user;
}

export function loginAccountApi(email: string, password: string): Promise<AccountUser> {
  return submitAuthApi('/api/auth/login', { email, password });
}

export function registerAccountApi(
  email: string,
  password: string,
  displayName: string
): Promise<AccountUser> {
  return submitAuthApi('/api/auth/register', { email, password, displayName });
}

export async function logoutAccountApi(): Promise<void> {
  const res = await fetch('/api/auth/logout', { method: 'POST' });
  if (!res.ok) throw new Error(await readApiError(res, 'Không thể đăng xuất.'));
}

export async function listQuizAttemptRecordsApi(): Promise<QuizAttemptRecord[]> {
  const res = await fetch('/api/attempts');
  if (!res.ok) throw new Error(await readApiError(res, 'Không thể tải lịch sử làm bài.'));
  const data = (await res.json()) as { attempts: QuizAttemptRecord[] };
  return data.attempts;
}

export async function saveQuizAttemptApi(params: {
  attempt: QuizAttempt;
  quizSet?: QuizSet;
  attemptType: 'quiz' | 'review';
  sourceAttemptId?: string;
}): Promise<QuizAttemptRecord> {
  const res = await fetch('/api/attempts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await readApiError(res, 'Không thể lưu kết quả làm bài.'));
  const data = (await res.json()) as { record: QuizAttemptRecord };
  return data.record;
}

/**
 * Extracts clean Vietnamese text safely from DOCX, PDF, or TXT file via backend
 */
export async function extractDocumentApi(file: File): Promise<{
  text: string;
  pageCount: number;
  fileType: 'pdf' | 'docx' | 'txt';
  extractionStatus: 'success' | 'failed';
  errorMessage?: string;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error('Không thể đọc tập tin từ thiết bị.'));
    };

    reader.onload = async () => {
      try {
        const fileBase64 = reader.result as string;
        const res = await fetch('/api/documents/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileBase64,
            fileName: file.name,
            fileType: file.name.endsWith('.docx')
              ? 'docx'
              : file.name.endsWith('.pdf')
              ? 'pdf'
              : 'txt',
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Máy chủ phản hồi mã lỗi ${res.status}`);
        }

        const data = await res.json();
        resolve(data);
      } catch (err: any) {
        reject(err);
      }
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Processes clean text to extract structure, chapters, and knowledge units
 */
export async function processDocumentApi(
  text: string,
  fileName: string = 'TaiLieu.pdf',
  fileType: 'pdf' | 'docx' | 'txt' = 'pdf',
  fileSize: string = '2.4 MB'
): Promise<DocumentSource> {
  const res = await fetch('/api/documents/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, fileName, fileType, fileSize }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Lỗi xử lý tài liệu (${res.status})`);
  }

  return await res.json();
}

/**
 * Generates exam with AI based on matrix and strict source mapping
 */
export async function generateExamApi(params: {
  document: DocumentSource;
  numQuestions: number;
  difficulty: DifficultyLevel;
  customMatrix?: ExamMatrix;
  strictSourceOnly?: boolean;
}): Promise<{
  matrix: ExamMatrix;
  questions: Question[];
  validationSummary: {
    totalQuestions: number;
    validCount: number;
    needsReviewCount: number;
    allValid: boolean;
  };
}> {
  const res = await fetch('/api/quizzes/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Lỗi tạo đề thi (${res.status})`);
  }

  return await res.json();
}

/**
 * Regenerates single question
 */
export async function regenerateQuestionApi(params: {
  document: DocumentSource;
  knowledgeUnitName: string;
  questionNumber: number;
  difficulty?: 'easy' | 'medium' | 'hard';
}): Promise<Question> {
  const res = await fetch('/api/questions/regenerate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Lỗi tạo lại câu hỏi (${res.status})`);
  }

  return await res.json();
}

/**
 * Generates practice questions for a missed knowledge unit
 */
export async function generatePracticeQuestionsApi(params: {
  document: DocumentSource;
  knowledgeUnitName: string;
  count?: number;
}): Promise<Question[]> {
  const res = await fetch('/api/questions/practice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Lỗi tạo câu hỏi ôn tập (${res.status})`);
  }

  return await res.json();
}

/**
 * Exports exam as HTML for print preview & PDF printing
 */
export async function exportExamApi(
  quizSet: QuizSet,
  config: ExamPaperConfig
): Promise<string> {
  const res = await fetch('/api/quizzes/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quizSet, config }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Lỗi xuất bản in đề thi (${res.status})`);
  }

  const data = await res.json();
  return data.html;
}

/**
 * Downloads official Word (.docx) exam paper
 */
export async function exportExamDocxApi(
  quizSet: QuizSet,
  config: ExamPaperConfig
): Promise<void> {
  const res = await fetch('/api/quizzes/export-docx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quizSet, config }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Lỗi tạo tệp Word .docx (${res.status})`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `DeThi_${config.examCode || '001'}_${quizSet.title.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, '_')}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generates clean print HTML for documents in Library History
 */
export async function printDocumentApi(
  doc: DocumentSource | SampleDocument,
  uploadDate?: string
): Promise<string> {
  const res = await fetch('/api/documents/print-html', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: doc, uploadDate }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Lỗi tạo trang in tài liệu (${res.status})`);
  }

  const data = await res.json();
  return data.html;
}

// ==========================================
// AI_TEXT PIPELINE CLIENT APIs
// ==========================================

async function consumeSsePost<T>(
  url: string,
  payload: Record<string, unknown>,
  onProgress?: (event: PipelineStepEvent) => void
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...payload, stream: true }),
  });

  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Máy chủ trả về mã lỗi ${res.status}`);
  }

  if (!contentType.includes('text/event-stream') || !res.body) {
    return (await res.json()) as T;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let finalResult: T | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const rawEvents = buffer.split('\n\n');
    buffer = rawEvents.pop() || '';

    for (const rawEvent of rawEvents) {
      const lines = rawEvent.split('\n');
      let eventName = 'message';
      let dataLine = '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLine += line.slice(5).trim();
        }
      }

      if (!dataLine) continue;
      const parsed = JSON.parse(dataLine);

      if (eventName === 'progress') {
        onProgress?.(parsed as PipelineStepEvent);
      } else if (eventName === 'error') {
        throw new Error(parsed.error || 'Quá trình xử lý AI gặp sự cố.');
      } else if (eventName === 'result') {
        finalResult = parsed as T;
      }
    }
  }

  if (!finalResult) {
    throw new Error('Kết nối stream kết thúc nhưng không nhận được kết quả hoàn chỉnh.');
  }

  return finalResult;
}

export async function parseAiRequestApi(params: {
  rawPrompt: string;
  quizTitle?: string;
  questionCount?: number;
  difficultyMode?: DifficultyLevel;
}): Promise<ParsedQuizRequest> {
  const res = await fetch('/api/ai/parse-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Lỗi phân tích yêu cầu (${res.status})`);
  }

  return (await res.json()) as ParsedQuizRequest;
}

export async function buildKnowledgeStreamApi(
  request: ParsedQuizRequest,
  onProgress?: (event: PipelineStepEvent) => void
): Promise<KnowledgePackage> {
  return consumeSsePost<KnowledgePackage>(
    '/api/ai/build-knowledge',
    { request },
    onProgress
  );
}

export async function getKnowledgePreviewApi(id: string): Promise<KnowledgePackage> {
  const res = await fetch(`/api/ai/knowledge-preview/${encodeURIComponent(id)}`);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Không tìm thấy nội dung học tập (${res.status})`);
  }
  return (await res.json()) as KnowledgePackage;
}

export async function generateFromKnowledgeStreamApi(
  params: {
    knowledgePackageId: string;
    editedMarkdown?: string;
    editedChapters?: KnowledgeChapterItem[];
    editedRequest?: ParsedQuizRequest;
  },
  onProgress?: (event: PipelineStepEvent) => void
): Promise<QuizSet> {
  return consumeSsePost<QuizSet>(
    '/api/ai/generate-from-knowledge',
    params,
    onProgress
  );
}

export async function listSavedQuizzesApi(): Promise<QuizSet[]> {
  const res = await fetch('/api/quizzes');
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({ quizzes: [] }));
  return Array.isArray(data.quizzes) ? data.quizzes : [];
}
