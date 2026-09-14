import {
  DocumentSource,
  QuizSet,
  Question,
  ExamMatrix,
  DifficultyLevel,
  ExamPaperConfig,
  SampleDocument,
} from '../types';

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
