import React, { useState, useRef, useEffect } from 'react';
import {
  DifficultyLevel,
  QuestionType,
  QuizStyle,
  SampleDocument,
  QuizSet,
  DocumentChapter,
  KnowledgeUnit,
  DocumentSource,
} from '../types';
import { SAMPLE_DOCUMENTS, RECENT_QUIZZES_LIST } from '../data/sampleData';
import { ExamMatrixModal } from './ExamMatrixModal';
import { buildExamMatrix } from '../utils/matrixUtils';
import { extractDocumentApi, processDocumentApi } from '../services/api';
import { AiTextFlow } from './AiTextFlow';
import heroMagnifyingGlassImg from '../assets/images/hero_magnifying_glass_clean_1794755347367.jpg';

interface UploadScreenProps {
  onStartGenerate: (config: {
    content: string;
    documentTitle: string;
    numQuestions: number;
    difficulty: DifficultyLevel;
    questionType: QuestionType;
    quizStyle: QuizStyle;
    scopeChapterId?: string;
    strictSourceOnly: boolean;
  }) => void;
  onSelectRecentQuiz: (quiz: QuizSet) => void;
  onRegisterDocument?: (doc: DocumentSource | SampleDocument) => void;
  onQuizCreated?: (quiz: QuizSet) => void;
}

export const UploadScreen: React.FC<UploadScreenProps> = ({
  onStartGenerate,
  onSelectRecentQuiz,
  onRegisterDocument,
  onQuizCreated,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'text'>('upload');
  const [selectedSample, setSelectedSample] = useState<SampleDocument>(SAMPLE_DOCUMENTS[0]);
  const [uploadedFile, setUploadedFile] = useState<{
    id?: string;
    name: string;
    size: string;
    content: string;
    chapters: DocumentChapter[];
    knowledgeUnits: KnowledgeUnit[];
    pageCount?: number;
    fileType?: 'pdf' | 'docx' | 'txt';
  }>({
    name: SAMPLE_DOCUMENTS[0].fileName,
    size: SAMPLE_DOCUMENTS[0].fileSize,
    content: SAMPLE_DOCUMENTS[0].content,
    chapters: SAMPLE_DOCUMENTS[0].chapters,
    knowledgeUnits: SAMPLE_DOCUMENTS[0].knowledgeUnits,
    pageCount: SAMPLE_DOCUMENTS[0].pageCount,
    fileType: 'pdf',
  });

  const [pastedText, setPastedText] = useState<string>('');
  const [numQuestions, setNumQuestions] = useState<number>(10);
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('medium');
  const [questionType, setQuestionType] = useState<QuestionType>('multiple_choice');
  const [quizStyle, setQuizStyle] = useState<QuizStyle>('standard');
  const [scopeChapterId, setScopeChapterId] = useState<string>('all');
  const [strictSourceOnly, setStrictSourceOnly] = useState<boolean>(true);
  const [isMatrixModalOpen, setIsMatrixModalOpen] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [extractionSuccess, setExtractionSuccess] = useState<string | null>(null);
  const [heroImageError, setHeroImageError] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToWorkspace = (targetTab?: 'upload' | 'text') => {
    if (targetTab) {
      setActiveTab(targetTab);
      setExtractionError(null);
    }
    setTimeout(() => {
      const el = document.getElementById('tao-de-workspace');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 40);
  };

  // Check for binary corruption in pasted text
  const isPastedBinary =
    pastedText.startsWith('PK') ||
    pastedText.includes('[Content_Types].xml') ||
    pastedText.includes('word/document.xml');

  const handleUploadFileAsync = async (file: File) => {
    setIsExtracting(true);
    setExtractionError(null);
    setExtractionSuccess(null);

    try {
      // 1. Trích xuất text an toàn qua parser chuyên dụng (mammoth cho DOCX, pdf-parse cho PDF)
      const extraction = await extractDocumentApi(file);

      if (extraction.extractionStatus === 'failed' || !extraction.text.trim()) {
        throw new Error(
          extraction.errorMessage ||
            'Không thể trích xuất văn bản từ tệp này. Nếu là tài liệu scan, vui lòng chuyển qua OCR.'
        );
      }

      // 2. Phân tích cấu trúc tài liệu, chương mục và đơn vị kiến thức
      const processed = await processDocumentApi(
        extraction.text,
        file.name,
        extraction.fileType,
        `${(file.size / (1024 * 1024)).toFixed(1)} MB`
      );

      const newDoc = {
        id: processed.id || `doc-${Date.now()}`,
        name: file.name,
        size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
        content: extraction.text,
        chapters:
          processed.chapters && processed.chapters.length > 0
            ? processed.chapters
            : SAMPLE_DOCUMENTS[0].chapters,
        knowledgeUnits:
          processed.knowledgeUnits && processed.knowledgeUnits.length > 0
            ? processed.knowledgeUnits
            : SAMPLE_DOCUMENTS[0].knowledgeUnits,
        pageCount: extraction.pageCount || 1,
        fileType: extraction.fileType,
      };

      setUploadedFile(newDoc);
      setExtractionSuccess(
        `Đã giải mã thành công tệp ${file.name.endsWith('.docx') ? 'Word DOCX' : file.name.endsWith('.pdf') ? 'PDF' : 'TXT'} (${extraction.pageCount} trang, ${extraction.text.length.toLocaleString('vi-VN')} ký tự chuẩn tiếng Việt UTF-8).`
      );

      // Register with Library
      if (onRegisterDocument) {
        onRegisterDocument({
          id: newDoc.id,
          title: file.name.replace(/\.[^/.]+$/, ''),
          fileName: file.name,
          fileType: extraction.fileType,
          fileSize: newDoc.size,
          pageCount: extraction.pageCount,
          status: 'READY',
          rawText: extraction.text,
          chapters: newDoc.chapters,
          chunks: processed.chunks || [],
          knowledgeUnits: newDoc.knowledgeUnits,
        });
      }
    } catch (err: any) {
      console.error('File extraction failed:', err);
      setExtractionError(
        err.message ||
          'Không thể trích xuất văn bản từ tệp. Vui lòng kiểm tra định dạng hoặc thử dán trực tiếp nội dung văn bản.'
      );
    } finally {
      setIsExtracting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleUploadFileAsync(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    handleUploadFileAsync(file);
  };

  const handleSelectSample = (sample: SampleDocument) => {
    setSelectedSample(sample);
    setExtractionError(null);
    setExtractionSuccess(null);
    setUploadedFile({
      name: sample.fileName,
      size: sample.fileSize,
      content: sample.content,
      chapters: sample.chapters,
      knowledgeUnits: sample.knowledgeUnits,
      pageCount: sample.pageCount,
      fileType: 'pdf',
    });
    setActiveTab('upload');
  };

  const handleStart = () => {
    if (activeTab === 'text' && isPastedBinary) {
      setExtractionError(
        'Văn bản dán chứa mã nhị phân PK / [Content_Types].xml. Vui lòng không sử dụng mã nhị phân để tạo đề.'
      );
      return;
    }

    const contentToUse =
      activeTab === 'upload'
        ? uploadedFile.content
        : pastedText || SAMPLE_DOCUMENTS[0].content;

    const docName =
      activeTab === 'upload'
        ? uploadedFile.name
        : 'Văn bản đã dán';

    onStartGenerate({
      content: contentToUse,
      documentTitle: docName,
      numQuestions,
      difficulty,
      questionType,
      quizStyle,
      scopeChapterId: scopeChapterId === 'all' ? undefined : scopeChapterId,
      strictSourceOnly,
    });
  };

  const currentChapters = React.useMemo(() => {
    const raw = uploadedFile.chapters || SAMPLE_DOCUMENTS[0].chapters;
    const seen = new Set<string>();
    const result: DocumentChapter[] = [];
    for (const c of raw) {
      const key = `${c.chapterNumber || ''}-${c.title.trim().toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(c);
      }
    }
    return result.length > 0 ? result : raw;
  }, [uploadedFile.chapters]);

  const currentMatrix = buildExamMatrix(currentChapters, numQuestions, difficulty);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-14 sm:space-y-16">
      {/* Hero Section: Gentle, Approachable Copy + Prominent Magnifying Glass Visual */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch pt-2">
        {/* Left Copy Column */}
        <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
          <p className="font-brand text-sm font-semibold text-[#4f46e5] tracking-normal">
            Học tập nhẹ nhàng · Khám phá kiến thức mỗi ngày
          </p>

          <h1 className="font-display text-3xl sm:text-5xl lg:text-[3.25rem] font-extrabold text-slate-900 tracking-tight leading-[1.14] [text-wrap:balance]">
            Biến tài liệu dài dòng thành{' '}
            <span className="bg-gradient-to-r from-[#ff4d6d] via-[#ff8c42] to-[#4f46e5] bg-clip-text text-transparent animate-gradient-flow">
              những giờ ôn tập đầy hứng khởi
            </span>
          </h1>

          <p className="font-sans text-base sm:text-[17px] text-slate-600 leading-relaxed max-w-xl">
            Cùng quizzAi soi rõ từng ý trọng tâm trong giáo trình, sắp xếp câu hỏi mạch lạc và biến mỗi lần tự kiểm tra thành một trải nghiệm nhẹ nhàng, thú vị.
          </p>

          <div className="flex flex-wrap items-center gap-3.5 pt-1">
            <button
              type="button"
              onClick={() => scrollToWorkspace('upload')}
              className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-[#ff4d6d] via-[#ff8c42] to-[#4f46e5] animate-gradient-flow text-white font-semibold text-sm sm:text-base shadow-md shadow-[#ff4d6d]/20 hover:shadow-lg hover:-translate-y-0.5 transition-all inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">upload_file</span>
              <span>Bắt đầu từ tài liệu</span>
            </button>

            <button
              type="button"
              onClick={() => scrollToWorkspace('text')}
              className="px-5 py-3.5 rounded-2xl bg-white border border-slate-200 hover:border-[#4f46e5]/40 hover:text-[#4f46e5] text-slate-700 font-semibold text-sm sm:text-base shadow-2xs transition-all inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px] text-[#ff4d6d]">auto_awesome</span>
              <span>Tạo nhanh theo chủ đề</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-medium text-slate-500 pt-1">
            <span>Hỗ trợ PDF, DOCX, TXT</span>
            <span aria-hidden="true">·</span>
            <span>Sinh đề theo yêu cầu tiếng Việt</span>
            <span aria-hidden="true">·</span>
            <span>Giải thích đáp án dễ hiểu</span>
          </div>
        </div>

        {/* Right Prominent Magnifying Glass Visual */}
        <div className="lg:col-span-6">
          <div className="relative h-full min-h-[280px] sm:min-h-[360px] rounded-[32px] overflow-hidden bg-gradient-to-br from-[#fff1e6] via-[#eff6ff] to-[#fdf2f8] shadow-xl shadow-indigo-950/8">
            {!heroImageError ? (
              <img
                src={heroMagnifyingGlassImg}
                alt="Hình ảnh kính lúp quizzAi soi sáng kiến thức và thẻ câu hỏi học tập"
                referrerPolicy="no-referrer"
                onError={() => setHeroImageError(true)}
                className="w-full h-full object-cover transition-transform duration-500 hover:scale-[1.02]"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-10 text-center gap-4 bg-gradient-to-br from-[#ffe4e6] via-[#fef3c7] to-[#dbeafe]">
                <div className="w-24 h-24 rounded-3xl bg-white/90 shadow-md flex items-center justify-center text-[#ff4d6d]">
                  <span className="material-symbols-outlined text-[52px]">search</span>
                </div>
                <p className="font-display font-bold text-lg text-slate-800">
                  Soi rõ kiến thức trọng tâm cùng quizzAi
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Section Giới thiệu: Vibrant Eye-Catching Gradient Background Focused on Learning & Experience Quality */}
      <section
        id="gioi-thieu-trai-nghiem"
        className="relative rounded-[32px] overflow-hidden p-7 sm:p-10 lg:p-12 text-white bg-gradient-to-br from-[#4f46e5] via-[#a855f7] to-[#ff4d6d] animate-gradient-flow shadow-xl shadow-indigo-950/15"
      >
        {/* Subtle luminous atmospheric accents */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-[#fbbf24]/30 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -left-16 w-72 h-72 rounded-full bg-[#2dd4bf]/25 blur-3xl"
        />

        <div className="relative z-10 space-y-8">
          <div className="max-w-3xl space-y-3.5">
            <p className="font-brand text-xs sm:text-sm font-semibold text-amber-200 tracking-wide">
              Chất lượng trải nghiệm học tập
            </p>
            <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-extrabold leading-tight [text-wrap:balance]">
              Học nhanh hơn, nhớ lâu hơn trên một không gian{' '}
              <span className="bg-gradient-to-r from-[#fde047] via-[#6ee7b7] to-[#bae6fd] bg-clip-text text-transparent">
                thoáng mắt và đầy cảm hứng
              </span>
            </h2>
            <p className="font-sans text-sm sm:text-base text-white/92 leading-relaxed">
              Thay vì cảm giác khô khan khi đối mặt với hàng chục trang tài liệu, quizzAi sắp xếp lại kiến thức thành từng mảnh ghép rõ ràng, chữ viết sắc nét và màu sắc tươi vui để mỗi phút ôn bài đều nhẹ nhàng.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="rounded-2xl bg-white/14 backdrop-blur-md border border-white/20 p-5 sm:p-6 space-y-2.5 transition-transform duration-200 hover:-translate-y-0.5">
              <div className="flex items-center justify-between">
                <span className="material-symbols-outlined text-[24px] text-amber-200">
                  auto_stories
                </span>
                <span className="font-brand text-sm font-bold text-white/75 tabular-nums">01</span>
              </div>
              <h3 className="font-brand text-lg font-bold text-white">
                Thoáng mắt & Dễ đọc
              </h3>
              <p className="font-sans text-sm text-white/88 leading-relaxed">
                Bo góc mềm mại, nhiều khoảng trắng cùng phông chữ tiếng Việt cân đối giúp bạn đọc lâu mà không bị rối mắt.
              </p>
            </div>

            <div className="rounded-2xl bg-white/14 backdrop-blur-md border border-white/20 p-5 sm:p-6 space-y-2.5 transition-transform duration-200 hover:-translate-y-0.5">
              <div className="flex items-center justify-between">
                <span className="material-symbols-outlined text-[24px] text-emerald-200">
                  manage_search
                </span>
                <span className="font-brand text-sm font-bold text-white/75 tabular-nums">02</span>
              </div>
              <h3 className="font-brand text-lg font-bold text-white">
                Bám sát ý trọng tâm
              </h3>
              <p className="font-sans text-sm text-white/88 leading-relaxed">
                Tự động chia chương mục hợp lý, giữ trọn nội dung chính xác và truy xuất rõ ràng từng trang tài liệu.
              </p>
            </div>

            <div className="rounded-2xl bg-white/14 backdrop-blur-md border border-white/20 p-5 sm:p-6 space-y-2.5 transition-transform duration-200 hover:-translate-y-0.5">
              <div className="flex items-center justify-between">
                <span className="material-symbols-outlined text-[24px] text-sky-200">
                  sentiment_satisfied
                </span>
                <span className="font-brand text-sm font-bold text-white/75 tabular-nums">03</span>
              </div>
              <h3 className="font-brand text-lg font-bold text-white">
                Luyện tập đầy hứng thú
              </h3>
              <p className="font-sans text-sm text-white/88 leading-relaxed">
                Làm bài mượt mà, nhận giải thích cặn kẽ ngay lập tức hoặc in đề giấy gọn đẹp chỉ với một cú nhấp chuột.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Main Input Container Card */}
      <section id="tao-de-workspace" className="scroll-mt-24 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 px-1">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              Không gian tạo đề thi của bạn
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Chọn tải tài liệu có sẵn hoặc mô tả chủ đề để AI biên soạn nội dung và tạo đề ngay.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-[28px] border border-slate-200/90 shadow-sm overflow-hidden">
          {/* Card Header with Tabs */}
          <div className="flex flex-wrap border-b border-slate-200/80 bg-slate-50/70 p-2.5 gap-2 text-xs sm:text-sm font-semibold">
            <button
              type="button"
              onClick={() => {
                setActiveTab('upload');
                setExtractionError(null);
              }}
              id="tab-upload-file"
              className={`flex-1 sm:flex-none px-5 py-2.5 rounded-2xl flex items-center justify-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'upload'
                  ? 'bg-gradient-to-r from-[#4f46e5] to-[#6366f1] text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">upload_file</span>
              <span>Tải tài liệu học tập (PDF / DOCX / TXT)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('text');
                setExtractionError(null);
              }}
              id="tab-ai-prompt"
              className={`flex-1 sm:flex-none px-5 py-2.5 rounded-2xl flex items-center justify-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'text'
                  ? 'bg-gradient-to-r from-[#ff4d6d] to-[#ff8c42] text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
              <span>Tạo đề từ yêu cầu AI</span>
            </button>
          </div>

        {/* Extraction Error Banner */}
        {extractionError && (
          <div className="mx-6 mt-6 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs space-y-1">
            <div className="flex items-center gap-2 font-bold">
              <span className="material-symbols-outlined text-[18px]">error</span>
              <span>Lỗi giải mã hoặc trích xuất tài liệu</span>
            </div>
            <p className="pl-6">{extractionError}</p>
          </div>
        )}

        {/* Extraction Success Banner */}
        {extractionSuccess && (
          <div className="mx-6 mt-6 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-emerald-600">check_circle</span>
            <span>{extractionSuccess}</span>
          </div>
        )}

        {/* Input Content Area */}
        <div className="p-6 sm:p-8 space-y-6">
          {activeTab === 'upload' ? (
            <div className="space-y-4">
              {/* Dropzone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !isExtracting && fileInputRef.current?.click()}
                id="file-dropzone"
                className={`border-2 border-dashed rounded-xl p-6 sm:p-8 text-center cursor-pointer transition-all duration-200 relative ${
                  isDragging
                    ? 'border-indigo-600 bg-indigo-50/40 scale-[0.99]'
                    : isExtracting
                    ? 'border-indigo-400 bg-indigo-50/30 cursor-wait'
                    : uploadedFile
                    ? 'border-emerald-400 bg-emerald-50/20 hover:border-emerald-600'
                    : 'border-slate-300 hover:border-indigo-600 hover:bg-slate-50'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".pdf,.docx,.txt,.doc"
                  className="hidden"
                  id="hidden-file-input"
                  disabled={isExtracting}
                />

                {isExtracting ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
                      <span className="material-symbols-outlined text-[32px] animate-spin">
                        refresh
                      </span>
                    </div>
                    <div>
                      <h4 className="font-bold text-base text-slate-900">
                        Đang giải mã và trích xuất nội dung...
                      </h4>
                      <p className="text-xs text-slate-500 mt-1">
                        Sử dụng parser DOCX (mammoth) / PDF (pdf-parse) để bảo đảm 100% chuẩn tiếng Việt Unicode có dấu, không dính chuỗi nhị phân.
                      </p>
                    </div>
                  </div>
                ) : uploadedFile ? (
                  <div className="flex flex-col items-center gap-2.5">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-xs">
                      <span className="material-symbols-outlined text-[28px]">description</span>
                    </div>
                    <div>
                      <div className="flex items-center justify-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase">
                          {uploadedFile.fileType || 'PDF'}
                        </span>
                        <h4 className="font-bold text-base text-slate-900">{uploadedFile.name}</h4>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Dung lượng: {uploadedFile.size} • {uploadedFile.pageCount || 1} trang • Đã nhận diện{' '}
                        {uploadedFile.chapters.length} chương & {uploadedFile.knowledgeUnits.length} đơn vị kiến thức
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                      className="mt-1 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors inline-flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[16px]">sync</span>
                      Chọn tài liệu khác từ máy tính
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-xs">
                      <span className="material-symbols-outlined text-[28px]">cloud_upload</span>
                    </div>
                    <div>
                      <p className="font-semibold text-sm sm:text-base text-slate-900">
                        Kéo thả file PDF, DOCX, TXT vào đây hoặc <span className="text-indigo-600 underline">duyệt từ máy</span>
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Hỗ trợ giáo trình, slide bài giảng, đề cương ôn tập (Tự động giải mã nhị phân DOCX & PDF)
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Sample Documents Quick Click */}
              <div className="space-y-2.5">
                <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-[#4f46e5]">school</span>
                  Tài liệu mẫu sẵn có để trải nghiệm nhanh:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  {SAMPLE_DOCUMENTS.map((sample) => (
                    <div
                      key={sample.id}
                      onClick={() => handleSelectSample(sample)}
                      id={`sample-doc-${sample.id}`}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer text-left ${
                        uploadedFile.name === sample.fileName
                          ? 'border-[#4f46e5] bg-indigo-50/45 shadow-xs ring-1 ring-[#4f46e5]/40'
                          : 'border-slate-200 bg-white hover:border-[#ff8c42]/60 hover:bg-slate-50/70'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#4f46e5] mb-1.5">
                        <span>{sample.category}</span>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className="text-slate-400 font-normal tabular-nums">{sample.fileSize}</span>
                      </div>
                      <h4 className="text-xs font-bold text-slate-900 line-clamp-1">
                        {sample.fileName}
                      </h4>
                      <p className="text-[11px] text-slate-500 line-clamp-2 mt-1 leading-relaxed">
                        {sample.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <AiTextFlow
              onQuizCreated={(quiz) => {
                if (onQuizCreated) {
                  onQuizCreated(quiz);
                } else {
                  onSelectRecentQuiz(quiz);
                }
              }}
            />
          )}

          {activeTab === 'upload' && (
            <>
              {/* Structure Detection & Knowledge Unit Pre-Analysis */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[18px] text-indigo-600">account_tree</span>
                    Cấu trúc chương mục & Đơn vị kiến thức phát hiện trong tài liệu:
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsMatrixModalOpen(true)}
                    className="text-xs text-indigo-600 font-bold hover:underline flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[16px]">grid_view</span>
                    Xem ma trận đặc tả đề thi
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {currentChapters.map((chap, idx) => (
                    <div
                      key={`${chap.id || 'chap'}-${idx}`}
                      className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-indigo-600 text-[11px]">Chương {idx + 1}</span>
                        <span className="text-[10px] text-slate-400">Trang {chap.pageStart} - {chap.pageEnd}</span>
                      </div>
                      <h5 className="font-bold text-slate-900 text-xs line-clamp-1">{chap.title}</h5>
                      <div className="space-y-0.5 pt-1 border-t border-slate-100 text-[11px] text-slate-600">
                        {chap.sections.map((sec, sIdx) => (
                          <div key={`${sec.id || 'sec'}-${sIdx}`} className="truncate flex items-center gap-1">
                            <span className="text-slate-400">•</span>
                            <span>{sec.sectionNumber} {sec.title}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Generator Controls Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
                {/* Number of Questions */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                    <span>Số lượng câu hỏi</span>
                    <span className="text-indigo-600 font-extrabold">{numQuestions} câu</span>
                  </label>
                  <div className="flex items-center gap-2">
                    {[5, 10, 20, 30].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setNumQuestions(num)}
                        className={`flex-1 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                          numQuestions === num
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Difficulty */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Mức độ phân hóa
                  </label>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value as DifficultyLevel)}
                    className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-800"
                  >
                    <option value="medium">Tổng hợp (Nhận biết - Thông hiểu - Vận dụng)</option>
                    <option value="easy">Nhận biết & Thông hiểu (Cơ bản)</option>
                    <option value="hard">Vận dụng & Vận dụng cao (Nâng cao)</option>
                  </select>
                </div>

                {/* Scope / Chapters */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Phạm vi kiến thức
                  </label>
                  <select
                    value={scopeChapterId}
                    onChange={(e) => setScopeChapterId(e.target.value)}
                    className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-800"
                  >
                    <option value="all">Toàn bộ tài liệu (Theo ma trận)</option>
                    {currentChapters.map((chap, idx) => (
                      <option key={`${chap.id || 'chap'}-${idx}`} value={chap.id}>
                        Chỉ {chap.title}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Strict Source Guarantee */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Chế độ kiểm định nguồn
                  </label>
                  <label className="flex items-center gap-2 p-2 bg-emerald-50/70 border border-emerald-200 rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={strictSourceOnly}
                      onChange={(e) => setStrictSourceOnly(e.target.checked)}
                      className="rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-[11px] font-bold text-emerald-900 leading-tight">
                      Chống bịa đặt (Chỉ sinh từ nguồn tài liệu gốc)
                    </span>
                  </label>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-xs text-slate-500 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[18px] text-indigo-600">lock_reset</span>
                  <span>100% câu hỏi được lập từ ma trận và trích xuất nguồn đối soát</span>
                </div>

                <button
                  onClick={handleStart}
                  disabled={isExtracting}
                  id="btn-start-generating"
                  className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-gradient-to-r from-[#4f46e5] via-[#7c3aed] to-[#ff4d6d] animate-gradient-flow disabled:opacity-50 text-white font-bold text-sm shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
                  <span>Bắt đầu AI phân tích & Tạo đề thi</span>
                </button>
              </div>
            </>
          )}
        </div>
        </div>
      </section>

      {/* Matrix Modal */}
      <ExamMatrixModal
        isOpen={isMatrixModalOpen}
        onClose={() => setIsMatrixModalOpen(false)}
        matrix={currentMatrix}
        totalQuestions={numQuestions}
      />
    </div>
  );
};
