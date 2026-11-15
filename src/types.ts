export type DifficultyLevel = 'easy' | 'medium' | 'hard' | 'all';
export type QuestionType = 'multiple_choice' | 'true_false' | 'fill_blank';
export type QuizStyle = 'standard' | 'review' | 'deep_dive';

export interface QuizOption {
  key: 'A' | 'B' | 'C' | 'D';
  text: string;
}

// 25. DATABASE DESIGN & 8. SOURCE INDEX
export interface DocumentSection {
  id: string;
  chapterId: string;
  sectionNumber: string; // e.g. "3.2"
  title: string; // e.g. "Cú pháp lệnh SELECT"
  page: number; // e.g. 42
  summary?: string;
}

export interface DocumentChapter {
  id: string;
  chapterNumber: number;
  title: string; // e.g. "Chương 3 – Ngôn ngữ truy vấn SQL"
  pageStart: number;
  pageEnd: number;
  sections: DocumentSection[];
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  chapterId: string;
  chapterTitle: string;
  sectionId: string;
  sectionTitle: string;
  pageNumber: number;
  content: string;
  startPosition?: number;
  endPosition?: number;
}

// 7. KNOWLEDGE UNIT EXTRACTION
export interface KnowledgeUnit {
  id: string;
  documentId: string;
  chapter: string;
  section: string;
  name: string; // e.g. "SELECT statement", "Mô hình OSI", "Tính thoái hóa mã di truyền"
  type: 'concept' | 'definition' | 'principle' | 'process' | 'formula' | 'rule' | 'comparison';
  description: string;
  importance: 'core' | 'important' | 'supplementary';
  sourceChunkId: string;
  sourceText: string;
  pageNumber: number;
}

export type QuizOriginType = 'DOCUMENT' | 'AI_TEXT';
export type KnowledgeOriginType = 'WEB' | 'AI_GENERATED';

export interface DifficultyDistribution {
  easy: number;
  medium: number;
  hard: number;
}

export interface ParsedQuizRequest {
  id: string;
  quizTitle: string;
  rawPrompt: string;
  topic: string;
  subject: string;
  audience: string;
  questionCount: number;
  difficultyMode: DifficultyLevel;
  difficulty: DifficultyDistribution;
  knowledgeAreas: string[];
  focusChapters: string[];
  language: string;
  optionsCount: 4;
  includeExplanation: boolean;
  needsWebResearch: boolean;
  createdAt: string;
}

export interface WebResearchSource {
  id: string;
  title: string;
  url: string;
  domain: string;
  fetchedContent: string;
  usedExcerpts: string[];
  retrievedAt: string;
  reliabilityTier: 'official_docs' | 'academic' | 'educational' | 'technical' | 'general';
  fetchMethod: 'direct_fetch';
}

export interface KnowledgeConceptItem {
  name: string;
  definition: string;
}

export interface KnowledgeSectionItem {
  id: string;
  sectionNumber: string;
  title: string;
  concepts: KnowledgeConceptItem[];
  explanation: string;
  example?: string;
  keyPoints: string[];
  sourceRefIds?: string[];
}

export interface KnowledgeChapterItem {
  id: string;
  chapterNumber: number;
  title: string;
  summary: string;
  sections: KnowledgeSectionItem[];
}

export interface KnowledgePackage {
  id: string;
  requestId: string;
  request: ParsedQuizRequest;
  topic: string;
  contentOrigin: KnowledgeOriginType;
  originNotice: string;
  freshnessWarning?: string;
  chapters: KnowledgeChapterItem[];
  webSources: WebResearchSource[];
  compiledMarkdown: string;
  documentSource: DocumentSource;
  createdAt: string;
  updatedAt: string;
  status: 'BUILT' | 'CONFIRMED';
}

export interface PipelineStepEvent {
  step: string;
  status: 'running' | 'completed' | 'warning' | 'error';
  message: string;
  detail?: string;
  timestamp: string;
}

// 9. QUESTION-TO-SOURCE MAPPING & 10. GENERATION REASON
export interface QuestionSource {
  documentId: string;
  documentName: string;
  chapter: string; // e.g. "Chương 3 – SQL"
  section: string; // e.g. "3.2 – SELECT"
  page: number; // e.g. 42
  sourceChunkId: string;
  sourceText: string; // Exact passage from original document
  knowledgeUnit: string; // e.g. "SELECT statement"
  generationReason: string; // Specific pedagogical reason grounded in the chapter/section
  contentOrigin?: KnowledgeOriginType;
  webSourceTitle?: string;
  webSourceUrl?: string;
  retrievedAt?: string;
}

// 15. QUESTION VALIDATOR
export interface QuestionValidation {
  isValid: boolean;
  status: 'VALID' | 'NEEDS_REVIEW' | 'EDITED' | 'REPORTED';
  checks: {
    hasFourOptions: boolean;
    hasSingleCorrect: boolean;
    answerInSource: boolean;
    explanationMatchesSource: boolean;
    hasSourceMapping: boolean;
    hasReason: boolean;
    noDuplicateOptions: boolean;
  };
  issues?: string[];
}

// 19. & 20. IMAGE GENERATION PIPELINE
export interface QuestionIllustration {
  needsImage: boolean;
  imagePrompt?: string;
  tikzCode?: string;
  imageUrl?: string;
  imageType?: 'diagram' | 'chart' | 'schema' | 'flowchart' | 'table';
  caption?: string;
}

export interface Question {
  id: string;
  questionNumber: number;
  questionText: string;
  options: QuizOption[];
  correctAnswer: 'A' | 'B' | 'C' | 'D';
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  source: QuestionSource; // Mandatory source mapping
  validation: QuestionValidation;
  sourceQuote?: string;
  illustration?: QuestionIllustration;
  userReport?: {
    reason: string;
    reportedAt: string;
  };
}

// 12. MA TRẬN ĐỀ (QUESTION BLUEPRINT)
export interface ChapterDistribution {
  chapterId: string;
  chapterTitle: string;
  easy: number;
  medium: number;
  hard: number;
  total: number;
}

export interface ExamMatrix {
  chapterDistributions: ChapterDistribution[];
  totalEasy: number;
  totalMedium: number;
  totalHard: number;
  grandTotal: number;
}

export interface DocumentSource {
  id: string;
  title: string;
  fileName: string;
  fileType: 'pdf' | 'docx' | 'txt';
  fileSize: string;
  pageCount: number;
  status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';
  rawText: string;
  chapters: DocumentChapter[];
  chunks: DocumentChunk[];
  knowledgeUnits: KnowledgeUnit[];
}

export interface QuizSet {
  id: string;
  title: string;
  documentId?: string;
  documentName: string;
  documentExcerpt?: string;
  createdAt: string;
  totalQuestions: number;
  recommendedMinutes: number;
  difficulty: DifficultyLevel;
  questionType: QuestionType;
  quizStyle: QuizStyle;
  matrix?: ExamMatrix;
  chapters?: DocumentChapter[];
  knowledgeUnits?: KnowledgeUnit[];
  questions: Question[];
  rawDocumentText?: string;
  originType?: QuizOriginType;
  aiRequest?: ParsedQuizRequest;
  knowledgePackageId?: string;
  contentOrigin?: KnowledgeOriginType;
  originNotice?: string;
  freshnessWarning?: string;
  webSources?: WebResearchSource[];
  compiledKnowledgeText?: string;
}

export interface QuizAttempt {
  id: string;
  quizId: string;
  quizTitle: string;
  completedAt: string;
  timeSpentSeconds: number;
  answers: Record<string, 'A' | 'B' | 'C' | 'D'>;
  flaggedQuestions: string[];
  score: number; // 0 - 10 scale
  percentage: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  totalQuestions: number;
  categoryBreakdown: {
    category: string;
    correct: number;
    total: number;
    accuracy: number;
  }[];
  difficultyBreakdown: {
    difficulty: 'easy' | 'medium' | 'hard';
    label: string;
    correct: number;
    total: number;
  }[];
  // 30. FLOW HỌC LẠI KIẾN THỨC
  missedKnowledgeUnits?: {
    questionId: string;
    questionNumber: number;
    knowledgeUnit: string;
    chapter: string;
    section: string;
    page: number;
    sourceText: string;
    reason: string;
  }[];
}

// 22. & 23. FORM ĐỀ THI GIẤY CHUẨN ĐỀ THI THẬT
export interface ExamPaperConfig {
  schoolName: string;
  facultyName: string;
  subjectName: string;
  examName: string;
  examCode: string;
  durationMinutes: number;
  candidateNamePlaceholder: string;
  candidateIdPlaceholder: string;
  exportMode: 'exam_only' | 'exam_with_bubble' | 'exam_with_answers' | 'exam_with_explanations' | 'full_with_source';
  fontSize: 'sm' | 'md' | 'lg';
  columns: 1 | 2;
}

export type ScreenId = 
  | 'upload'           // 1. Tải tài liệu & Cấu hình
  | 'generating'       // 2. AI Đang xử lý
  | 'quiz-detail'      // 3. Danh sách & Tổng quan bộ câu hỏi
  | 'quiz-taking'      // 4. Giao diện làm bài thi
  | 'quiz-result'      // 5. Kết quả & Phân tích điểm số
  | 'quiz-review'      // 6. Lời giải chi tiết
  | 'quiz-edit'        // 7. Chỉnh sửa câu hỏi
  | 'library-history'; // 8. Kho tài liệu & Lịch sử đề thi

export interface SampleDocument {
  id: string;
  title: string;
  category: string;
  description: string;
  fileName: string;
  fileSize: string;
  pageCount: number;
  content: string;
  chapters: DocumentChapter[];
  knowledgeUnits: KnowledgeUnit[];
}
