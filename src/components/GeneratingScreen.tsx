import React, { useEffect, useState, useRef } from 'react';
import { DifficultyLevel, QuestionType, QuizStyle, QuizSet } from '../types';
import { processDocumentApi, generateExamApi } from '../services/api';

interface GeneratingScreenProps {
  documentTitle: string;
  documentContent: string;
  numQuestions: number;
  difficulty: DifficultyLevel;
  questionType: QuestionType;
  quizStyle: QuizStyle;
  scopeChapterId?: string;
  strictSourceOnly: boolean;
  onComplete: (quizSet: QuizSet) => void;
  onCancel?: () => void;
}

export const GeneratingScreen: React.FC<GeneratingScreenProps> = ({
  documentTitle,
  documentContent,
  numQuestions,
  difficulty,
  questionType,
  quizStyle,
  scopeChapterId,
  strictSourceOnly,
  onComplete,
  onCancel,
}) => {
  const [progress, setProgress] = useState<number>(10);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [tipIndex, setTipIndex] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('Bắt đầu quy trình xử lý tài liệu...');
  const [isProcessing, setIsProcessing] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasTriggeredRef = useRef<boolean>(false);

  const steps = [
    {
      title: '1. Trích xuất văn bản & Chuẩn hóa dữ liệu',
      description: 'Đọc nội dung văn bản từ tập tin, loại bỏ ký tự rác và chuẩn hóa dấu câu tiếng Việt.',
    },
    {
      title: '2. Phân tích cấu trúc tài liệu & Nhận diện Chương/Mục',
      description: 'Phát hiện các tiêu đề Chương, Mục con và ước tính số trang tương ứng.',
    },
    {
      title: '3. Phân đoạn & Tạo chỉ mục nguồn (Source Index)',
      description: 'Chia nhỏ văn bản thành các đoạn (chunks), liên kết từng đoạn với số trang và chương mục.',
    },
    {
      title: '4. Trích xuất đơn vị kiến thức trọng tâm (Knowledge Units)',
      description: 'Nhận diện khái niệm, định nghĩa, quy tắc, công thức, quy trình và sự so sánh cốt lõi.',
    },
    {
      title: '5. Lập ma trận đặc tả đề thi (Question Blueprint)',
      description: `Phân bổ ${numQuestions} câu hỏi theo các mức độ nhận thức (Nhận biết, Thông hiểu, Vận dụng).`,
    },
    {
      title: '6. AI biên soạn câu hỏi & Gắn nguồn gốc chi tiết',
      description: 'Chống bịa đặt kiến thức: Mỗi câu hỏi bắt buộc đính kèm trích dẫn văn bản và lý do sư phạm.',
    },
    {
      title: '7. Kiểm định chất lượng đề thi (Question Validator)',
      description: 'Xác thực 4 phương án, 1 đáp án đúng, câu hỏi không trùng lặp và đối soát dữ kiện với văn bản.',
    },
  ];

  const tips = [
    'Quy tắc Anti-Hallucination: AI bị cấm tạo kiến thức không tồn tại trong tài liệu nếu bạn chọn chế độ bám sát.',
    'Mỗi câu hỏi được tạo ra đều lưu lại số trang, tên chương, tên mục và đoạn trích nguyên văn từ tài liệu học tập.',
    'Sau khi làm bài kiểm tra, hệ thống sẽ đề xuất lộ trình ôn tập dựa trên các đơn vị kiến thức bạn trả lời sai.',
    'Bạn có thể xuất đề thi dưới dạng chuẩn đề thi in ấn trường Đại học hoặc phiếu tô trắc nghiệm 2B bất cứ lúc nào.',
  ];

  // Elapsed timer
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Tips cycler
  useEffect(() => {
    const tipInterval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % tips.length);
    }, 4000);
    return () => clearInterval(tipInterval);
  }, [tips.length]);

  // Main Pipeline Execution
  useEffect(() => {
    if (hasTriggeredRef.current) return;
    hasTriggeredRef.current = true;

    async function executePipeline() {
      try {
        // Step 1 & 2 & 3 & 4: Process Document
        setCurrentStepIndex(1);
        setProgress(20);
        setStatusMessage('Đang phân tích cấu trúc chương mục và lập chỉ mục nguồn...');

        const docSource = await processDocumentApi(
          documentContent,
          documentTitle,
          documentTitle.endsWith('.docx') ? 'docx' : documentTitle.endsWith('.txt') ? 'txt' : 'pdf'
        );

        setCurrentStepIndex(3);
        setProgress(45);
        setStatusMessage(`Đã tìm thấy ${docSource.chapters.length} chương và ${docSource.knowledgeUnits.length} đơn vị kiến thức trọng tâm.`);

        // Step 5: Blueprint Matrix
        setCurrentStepIndex(4);
        setProgress(60);
        setStatusMessage('Đang thiết lập ma trận đặc tả đề thi chuẩn khảo thí...');

        // Step 6: Generate Exam with AI
        setCurrentStepIndex(5);
        setProgress(75);
        setStatusMessage('AI đang biên soạn câu hỏi và gắn nguồn gốc kiến thức chi tiết...');

        const examResult = await generateExamApi({
          document: docSource,
          numQuestions,
          difficulty,
          strictSourceOnly,
        });

        // Step 7: Validator
        setCurrentStepIndex(6);
        setProgress(95);
        setStatusMessage(`Đã kiểm định: ${examResult.validationSummary.validCount}/${examResult.validationSummary.totalQuestions} câu hỏi hoàn toàn hợp lệ.`);

        const createdQuizSet: QuizSet = {
          id: `quiz-${Date.now()}`,
          title: documentTitle.replace(/\.[^/.]+$/, '').replace(/_/g, ' '),
          documentId: docSource.id,
          documentName: documentTitle,
          documentExcerpt: documentContent.slice(0, 160) + '...',
          createdAt: 'Vừa tạo',
          totalQuestions: examResult.questions.length,
          recommendedMinutes: Math.max(5, Math.round(examResult.questions.length * 1.5)),
          difficulty,
          questionType,
          quizStyle,
          matrix: examResult.matrix,
          chapters: docSource.chapters,
          knowledgeUnits: docSource.knowledgeUnits,
          questions: examResult.questions,
          rawDocumentText: documentContent,
        };

        setProgress(100);
        setIsProcessing(false);
        setTimeout(() => {
          onComplete(createdQuizSet);
        }, 600);
      } catch (err: any) {
        console.error('Pipeline error:', err);
        setErrorMessage(err?.message || 'Quá trình xử lý tài liệu và tạo đề thi gặp sự cố.');
        setStatusMessage('Xử lý tài liệu thất bại.');
        setIsProcessing(false);
      }
    }

    executePipeline();
  }, [documentContent, documentTitle, numQuestions, difficulty, questionType, quizStyle, strictSourceOnly, onComplete]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-10 sm:py-14 space-y-8 text-center">
      {/* Central Animated Orb */}
      <div className="relative flex items-center justify-center mx-auto w-32 h-32 sm:w-36 sm:h-36">
        <div className="absolute inset-0 rounded-full bg-indigo-500/15 animate-ping opacity-75" />
        <div className="absolute inset-2 rounded-full bg-gradient-to-tr from-indigo-600 to-emerald-500 opacity-20 blur-xl animate-pulse" />
        <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-gradient-to-tr from-indigo-700 via-blue-600 to-emerald-600 flex flex-col items-center justify-center text-white shadow-xl shadow-indigo-500/20">
          <span className="material-symbols-outlined text-[36px] sm:text-[40px] animate-spin" style={{ animationDuration: '6s' }}>
            neurology
          </span>
          <span className="text-xs font-bold mt-0.5 font-mono tracking-wider">{progress}%</span>
        </div>
      </div>

      {/* Title & Document Info */}
      <div className="space-y-1.5">
        <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900">
          AI đang xử lý tài liệu & biên soạn đề thi...
        </h2>
        <p className="text-xs sm:text-sm text-slate-600 max-w-lg mx-auto">
          Tài liệu: <span className="font-bold text-slate-900">{documentTitle}</span> • Chỉ tiêu:{' '}
          <span className="font-bold text-indigo-700">{numQuestions} câu hỏi trắc nghiệm</span>
        </p>
      </div>

      {/* Progress Bar & Status */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
          <span className="flex items-center gap-1.5 text-indigo-700">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            {statusMessage}
          </span>
          <span className="flex items-center gap-1 font-mono text-slate-500">
            <span className="material-symbols-outlined text-[15px]">timer</span>
            {formatTime(elapsedSeconds)}
          </span>
        </div>

        {/* Bar */}
        <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden p-0.5">
          <div
            className="h-full bg-gradient-to-r from-indigo-600 via-blue-600 to-emerald-500 rounded-full transition-all duration-300 shadow-xs"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-left space-y-3 text-xs">
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px] text-rose-600 shrink-0">error</span>
            <div>
              <p className="font-bold">Không thể hoàn tất tạo đề từ tài liệu</p>
              <p className="mt-0.5">{errorMessage}</p>
            </div>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-lg bg-white border border-rose-300 text-rose-800 font-bold hover:bg-rose-100 transition-colors"
            >
              Quay lại trang tải tài liệu
            </button>
          )}
        </div>
      )}

      {/* Steps Checklist */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 sm:p-6 text-left space-y-3.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Tiến trình phân tích & Kiểm định câu hỏi (7 Bước)
          </h3>
          <span className="text-xs text-indigo-600 font-semibold font-mono">
            {currentStepIndex + 1}/7
          </span>
        </div>

        <div className="space-y-2.5">
          {steps.map((step, idx) => {
            const isFinished = idx < currentStepIndex || progress >= 100;
            const isCurrent = idx === currentStepIndex && progress < 100;

            return (
              <div
                key={idx}
                className={`p-3 rounded-xl border transition-all flex items-start gap-3 ${
                  isFinished
                    ? 'border-emerald-200 bg-emerald-50/25 text-emerald-950'
                    : isCurrent
                    ? 'border-indigo-300 bg-indigo-50/40 text-slate-900 shadow-2xs'
                    : 'border-slate-200 opacity-50 text-slate-400'
                }`}
              >
                <div className="mt-0.5">
                  {isFinished ? (
                    <div className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                      <span className="material-symbols-outlined text-[14px]">check</span>
                    </div>
                  ) : isCurrent ? (
                    <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center animate-pulse">
                      <span className="material-symbols-outlined text-[14px] animate-spin">refresh</span>
                    </div>
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-[10px] font-bold">
                      {idx + 1}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className={`text-xs sm:text-sm font-bold ${isCurrent ? 'text-indigo-700' : isFinished ? 'text-emerald-900' : 'text-slate-700'}`}>
                    {step.title}
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Rotating Tip */}
      <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 text-amber-900 text-xs flex items-center gap-3 text-left">
        <span className="material-symbols-outlined text-[22px] shrink-0 text-amber-600">lightbulb</span>
        <span className="leading-relaxed">{tips[tipIndex]}</span>
      </div>
    </div>
  );
};
