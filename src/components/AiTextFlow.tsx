import React, { useState } from 'react';
import {
  DifficultyLevel,
  KnowledgePackage,
  ParsedQuizRequest,
  PipelineStepEvent,
  QuizSet,
} from '../types';
import {
  buildKnowledgeStreamApi,
  generateFromKnowledgeStreamApi,
  parseAiRequestApi,
} from '../services/api';

interface AiTextFlowProps {
  onQuizCreated: (quizSet: QuizSet) => void;
}

type AiFlowStep =
  | 'input'
  | 'confirm-request'
  | 'building-knowledge'
  | 'preview-knowledge'
  | 'generating-quiz';

const SAMPLE_PROMPTS = [
  {
    label: 'Python cơ bản (20 câu)',
    prompt: 'Tạo 20 câu trắc nghiệm về Python cơ bản cho sinh viên năm nhất.',
  },
  {
    label: 'Hệ quản trị CSDL (30 câu)',
    prompt:
      'Tạo 30 câu về hệ quản trị cơ sở dữ liệu, tập trung vào khóa chính, khóa ngoại và chuẩn hóa.',
  },
  {
    label: 'Mạng máy tính (10 dễ / 10 TB / 5 khó)',
    prompt:
      'Tạo 25 câu về mạng máy tính, gồm 10 câu dễ, 10 câu trung bình và 5 câu khó.',
  },
  {
    label: 'Trí tuệ nhân tạo có giải thích',
    prompt: 'Tạo 20 câu về trí tuệ nhân tạo cơ bản, có giải thích đáp án.',
  },
];

export const AiTextFlow: React.FC<AiTextFlowProps> = ({ onQuizCreated }) => {
  const [step, setStep] = useState<AiFlowStep>('input');

  // Screen 1: Input state
  const [rawPrompt, setRawPrompt] = useState<string>('');
  const [quizTitle, setQuizTitle] = useState<string>('');
  const [questionCountOverride, setQuestionCountOverride] = useState<string>('');
  const [difficultyOverride, setDifficultyOverride] = useState<DifficultyLevel | 'auto'>('auto');
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [stepError, setStepError] = useState<string | null>(null);

  // Screen 2: Parsed & editable request
  const [parsedRequest, setParsedRequest] = useState<ParsedQuizRequest | null>(null);
  const [newAreaInput, setNewAreaInput] = useState<string>('');

  // Screen 3: Real-time knowledge building logs
  const [buildLogs, setBuildLogs] = useState<PipelineStepEvent[]>([]);
  const [buildError, setBuildError] = useState<string | null>(null);

  // Screen 4: Knowledge preview & edit
  const [knowledgePkg, setKnowledgePkg] = useState<KnowledgePackage | null>(null);
  const [previewMode, setPreviewMode] = useState<'structured' | 'edit'>('structured');
  const [editedMarkdown, setEditedMarkdown] = useState<string>('');

  // Screen 5: Real-time question generation logs
  const [genLogs, setGenLogs] = useState<PipelineStepEvent[]>([]);
  const [genError, setGenError] = useState<string | null>(null);

  const flowStepsMeta: { id: AiFlowStep | 'result'; num: number; label: string }[] = [
    { id: 'input', num: 1, label: 'Nhập yêu cầu' },
    { id: 'confirm-request', num: 2, label: 'Xác nhận yêu cầu' },
    { id: 'building-knowledge', num: 3, label: 'Xây dựng nội dung' },
    { id: 'preview-knowledge', num: 4, label: 'Xem trước kiến thức' },
    { id: 'generating-quiz', num: 5, label: 'Tạo & kiểm định đề' },
    { id: 'result', num: 6, label: 'Kết quả bộ đề' },
  ];

  const currentStepIdx = flowStepsMeta.findIndex((s) => s.id === step);

  // Action: Step 1 -> Step 2 (Parse request)
  const handleParseRequest = async () => {
    if (!rawPrompt.trim()) {
      setStepError('Vui lòng nhập yêu cầu tạo đề bằng ngôn ngữ tự nhiên.');
      return;
    }

    setIsParsing(true);
    setStepError(null);

    try {
      const parsedCount = questionCountOverride ? Number(questionCountOverride) : undefined;
      const result = await parseAiRequestApi({
        rawPrompt: rawPrompt.trim(),
        quizTitle: quizTitle.trim() || undefined,
        questionCount: parsedCount && parsedCount > 0 ? parsedCount : undefined,
        difficultyMode: difficultyOverride === 'auto' ? undefined : difficultyOverride,
      });

      setParsedRequest(result);
      setStep('confirm-request');
    } catch (err: any) {
      setStepError(err.message || 'Không thể phân tích yêu cầu. Vui lòng thử lại.');
    } finally {
      setIsParsing(false);
    }
  };

  // Helpers for editing Screen 2
  const handleUpdateDifficultyCounts = (
    field: 'easy' | 'medium' | 'hard',
    value: number
  ) => {
    if (!parsedRequest) return;
    const safeVal = Math.max(0, Math.min(50, Math.round(value || 0)));
    const nextDiff = {
      ...parsedRequest.difficulty,
      [field]: safeVal,
    };
    const nextTotal = nextDiff.easy + nextDiff.medium + nextDiff.hard;
    setParsedRequest({
      ...parsedRequest,
      difficulty: nextDiff,
      questionCount: Math.max(1, nextTotal),
    });
  };

  const handleUpdateTotalQuestions = (newTotal: number) => {
    if (!parsedRequest) return;
    const total = Math.max(1, Math.min(50, Math.round(newTotal || 1)));
    const easy = Math.round(total * 0.3);
    const medium = Math.round(total * 0.45);
    const hard = Math.max(0, total - easy - medium);
    setParsedRequest({
      ...parsedRequest,
      questionCount: total,
      difficulty: { easy, medium, hard },
    });
  };

  const handleAddKnowledgeArea = () => {
    if (!parsedRequest || !newAreaInput.trim()) return;
    const trimmed = newAreaInput.trim();
    if (!parsedRequest.knowledgeAreas.includes(trimmed)) {
      setParsedRequest({
        ...parsedRequest,
        knowledgeAreas: [...parsedRequest.knowledgeAreas, trimmed],
      });
    }
    setNewAreaInput('');
  };

  const handleRemoveKnowledgeArea = (area: string) => {
    if (!parsedRequest || parsedRequest.knowledgeAreas.length <= 1) return;
    setParsedRequest({
      ...parsedRequest,
      knowledgeAreas: parsedRequest.knowledgeAreas.filter((a) => a !== area),
    });
  };

  // Action: Step 2 -> Step 3 -> Step 4 (Build knowledge content)
  const handleBuildKnowledge = async () => {
    if (!parsedRequest) return;
    const diffSum =
      parsedRequest.difficulty.easy +
      parsedRequest.difficulty.medium +
      parsedRequest.difficulty.hard;
    if (diffSum !== parsedRequest.questionCount) {
      setStepError(
        `Tổng số câu theo độ khó (${diffSum}) phải bằng tổng số câu yêu cầu (${parsedRequest.questionCount}).`
      );
      return;
    }

    setStepError(null);
    setBuildError(null);
    setBuildLogs([
      {
        step: 'init',
        status: 'running',
        message: `Khởi tạo quy trình nghiên cứu & biên soạn nội dung cho "${parsedRequest.topic}"...`,
        timestamp: new Date().toISOString(),
      },
    ]);
    setStep('building-knowledge');

    try {
      const pkg = await buildKnowledgeStreamApi(parsedRequest, (event) => {
        setBuildLogs((prev) => [...prev, event]);
      });
      setKnowledgePkg(pkg);
      setEditedMarkdown(pkg.compiledMarkdown);
      setPreviewMode('structured');
      setStep('preview-knowledge');
    } catch (err: any) {
      setBuildError(
        err.message || 'Không thể xây dựng nội dung học tập. Vui lòng thử lại.'
      );
    }
  };

  // Action: Step 4 -> Step 5 -> Step 6 (Generate & validate quiz from confirmed knowledge)
  const handleConfirmAndGenerateQuiz = async () => {
    if (!knowledgePkg) return;

    setGenError(null);
    setGenLogs([
      {
        step: 'init',
        status: 'running',
        message: `Bắt đầu tạo ${knowledgePkg.request.questionCount} câu hỏi từ nội dung kiến thức đã xác nhận...`,
        timestamp: new Date().toISOString(),
      },
    ]);
    setStep('generating-quiz');

    try {
      const hasMarkdownEdit =
        editedMarkdown.trim() !== knowledgePkg.compiledMarkdown.trim();

      const quizSet = await generateFromKnowledgeStreamApi(
        {
          knowledgePackageId: knowledgePkg.id,
          editedMarkdown: hasMarkdownEdit ? editedMarkdown : undefined,
          editedRequest: parsedRequest || knowledgePkg.request,
        },
        (event) => {
          setGenLogs((prev) => [...prev, event]);
        }
      );

      onQuizCreated(quizSet);
    } catch (err: any) {
      setGenError(
        err.message ||
          'Quá trình tạo câu hỏi gặp sự cố. Bộ đề chưa được lưu.'
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Compact 6-Step Progress Bar */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 overflow-x-auto">
        <div className="flex items-center justify-between gap-2 min-w-[640px]">
          {flowStepsMeta.map((item, idx) => {
            const isCompleted = idx < currentStepIdx;
            const isActive = idx === currentStepIdx;
            return (
              <div key={item.id} className="flex items-center gap-2 flex-1">
                <div
                  className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 transition-colors ${
                    isCompleted
                      ? 'bg-emerald-600 text-white'
                      : isActive
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-200 text-slate-500'
                  }`}
                >
                  {isCompleted ? (
                    <span className="material-symbols-outlined text-[14px]">check</span>
                  ) : (
                    item.num
                  )}
                </div>
                <span
                  className={`text-xs whitespace-nowrap ${
                    isActive
                      ? 'font-bold text-indigo-700'
                      : isCompleted
                      ? 'font-semibold text-emerald-700'
                      : 'font-medium text-slate-500'
                  }`}
                >
                  {item.label}
                </span>
                {idx < flowStepsMeta.length - 1 && (
                  <div className="flex-1 h-px bg-slate-200 mx-1" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ========================================= */}
      {/* SCREEN 1: NHẬP YÊU CẦU TỰ NHIÊN            */}
      {/* ========================================= */}
      {step === 'input' && (
        <div className="space-y-5">
          <div className="p-4 rounded-xl bg-indigo-50/60 border border-indigo-200/80 text-xs text-indigo-950 flex items-start gap-3">
            <span className="material-symbols-outlined text-[20px] text-indigo-600 shrink-0 mt-0.5">
              auto_stories
            </span>
            <div className="space-y-1">
              <p className="font-bold text-indigo-900">
                AI tự nghiên cứu & biên soạn tài liệu trước khi tạo đề
              </p>
              <p className="text-indigo-800/90 leading-relaxed">
                Bạn không cần dán sẵn giáo trình. Chỉ cần mô tả chủ đề mong muốn — AI sẽ phân tích yêu cầu, tìm kiếm tài liệu chính thức hoặc tổng hợp kiến thức thành giáo trình có cấu trúc để bạn xem duyệt trước khi sinh câu hỏi.
              </p>
            </div>
          </div>

          {stepError && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
              <span className="material-symbols-outlined text-[18px] text-rose-600 shrink-0">
                error
              </span>
              <span>{stepError}</span>
            </div>
          )}

          {/* Prompt textarea */}
          <div className="space-y-2">
            <label
              htmlFor="ai-request-prompt-textarea"
              className="text-xs font-bold text-slate-700 uppercase tracking-wider block"
            >
              Yêu cầu tạo đề của bạn (Ngôn ngữ tự nhiên)
            </label>
            <textarea
              id="ai-request-prompt-textarea"
              value={rawPrompt}
              onChange={(e) => {
                setRawPrompt(e.target.value);
                if (stepError) setStepError(null);
              }}
              rows={4}
              placeholder="Ví dụ: Tạo 25 câu về mạng máy tính cho sinh viên CNTT, gồm 10 câu dễ, 10 câu trung bình và 5 câu khó, có giải thích chi tiết..."
              className="w-full p-4 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-600 focus:bg-white transition-all resize-y leading-relaxed"
            />

            {/* Sample prompts */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[11px] font-semibold text-slate-500">
                Gợi ý nhanh:
              </span>
              {SAMPLE_PROMPTS.map((sample, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setRawPrompt(sample.prompt);
                    setStepError(null);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 text-[11px] font-medium text-slate-700 transition-colors whitespace-nowrap"
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </div>

          {/* Optional Overrides Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            <div className="space-y-1.5">
              <label
                htmlFor="ai-quiz-title-input"
                className="text-xs font-bold text-slate-700 block"
              >
                Tên bộ đề (tùy chọn)
              </label>
              <input
                id="ai-quiz-title-input"
                type="text"
                value={quizTitle}
                onChange={(e) => setQuizTitle(e.target.value)}
                placeholder="Để trống AI tự đặt theo chủ đề"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-600"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="ai-question-count-input"
                className="text-xs font-bold text-slate-700 block"
              >
                Số lượng câu hỏi (tùy chọn)
              </label>
              <input
                id="ai-question-count-input"
                type="number"
                min={1}
                max={50}
                value={questionCountOverride}
                onChange={(e) => setQuestionCountOverride(e.target.value)}
                placeholder="Tự động nhận diện từ yêu cầu"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-600 tabular-nums"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="ai-difficulty-select"
                className="text-xs font-bold text-slate-700 block"
              >
                Độ khó ưu tiên (tùy chọn)
              </label>
              <select
                id="ai-difficulty-select"
                value={difficultyOverride}
                onChange={(e) =>
                  setDifficultyOverride(e.target.value as DifficultyLevel | 'auto')
                }
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-600"
              >
                <option value="auto">Tự động theo yêu cầu / Cân bằng</option>
                <option value="easy">Cơ bản (Ưu tiên nhận biết)</option>
                <option value="medium">Tổng hợp (Dễ - Trung bình - Khó)</option>
                <option value="hard">Nâng cao (Ưu tiên vận dụng)</option>
              </select>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              Bước tiếp theo: AI phân tích cấu hình để bạn kiểm tra và điều chỉnh.
            </span>
            <button
              type="button"
              id="btn-parse-ai-request"
              onClick={handleParseRequest}
              disabled={isParsing}
              className="w-full sm:w-auto px-7 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold text-sm shadow-sm transition-all flex items-center justify-center gap-2 whitespace-nowrap"
            >
              {isParsing ? (
                <>
                  <span className="material-symbols-outlined text-[18px] animate-spin">
                    progress_activity
                  </span>
                  <span>Đang phân tích yêu cầu...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">
                    psychology_alt
                  </span>
                  <span>Phân tích yêu cầu</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* SCREEN 2: XÁC NHẬN & CHỈNH SỬA YÊU CẦU    */}
      {/* ========================================= */}
      {step === 'confirm-request' && parsedRequest && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Kết quả AI phân tích yêu cầu
              </h3>
              <p className="text-xs text-slate-500">
                Kiểm tra và chỉnh sửa thông số trước khi AI nghiên cứu và biên soạn nội dung học tập.
              </p>
            </div>
            <span className="text-xs font-medium text-indigo-700">
              Ngôn ngữ: {parsedRequest.language}
            </span>
          </div>

          {stepError && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
              <span className="material-symbols-outlined text-[18px] text-rose-600 shrink-0">
                error
              </span>
              <span>{stepError}</span>
            </div>
          )}

          {/* Editable metadata fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">
                Tên bộ đề
              </label>
              <input
                type="text"
                value={parsedRequest.quizTitle}
                onChange={(e) =>
                  setParsedRequest({ ...parsedRequest, quizTitle: e.target.value })
                }
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm font-medium text-slate-900"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">
                Chủ đề chính
              </label>
              <input
                type="text"
                value={parsedRequest.topic}
                onChange={(e) =>
                  setParsedRequest({ ...parsedRequest, topic: e.target.value })
                }
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm font-medium text-slate-900"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">
                Môn học / Lĩnh vực
              </label>
              <input
                type="text"
                value={parsedRequest.subject}
                onChange={(e) =>
                  setParsedRequest({ ...parsedRequest, subject: e.target.value })
                }
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">
                Đối tượng học
              </label>
              <input
                type="text"
                value={parsedRequest.audience}
                onChange={(e) =>
                  setParsedRequest({ ...parsedRequest, audience: e.target.value })
                }
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800"
              />
            </div>
          </div>

          {/* Question count & Difficulty breakdown */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800">
                Cấu hình số lượng & phân bổ mức độ câu hỏi
              </span>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-600">Tổng số câu:</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={parsedRequest.questionCount}
                  onChange={(e) =>
                    handleUpdateTotalQuestions(Number(e.target.value))
                  }
                  className="w-16 px-2 py-1 bg-white border border-slate-300 rounded-md font-bold text-indigo-700 text-center tabular-nums"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-1">
                <label className="text-[11px] font-semibold text-emerald-700 block">
                  Dễ (Nhận biết)
                </label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={parsedRequest.difficulty.easy}
                  onChange={(e) =>
                    handleUpdateDifficultyCounts('easy', Number(e.target.value))
                  }
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md text-sm font-bold text-slate-900 tabular-nums"
                />
              </div>

              <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-1">
                <label className="text-[11px] font-semibold text-indigo-700 block">
                  Trung bình (Thông hiểu)
                </label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={parsedRequest.difficulty.medium}
                  onChange={(e) =>
                    handleUpdateDifficultyCounts('medium', Number(e.target.value))
                  }
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md text-sm font-bold text-slate-900 tabular-nums"
                />
              </div>

              <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-1">
                <label className="text-[11px] font-semibold text-amber-700 block">
                  Khó (Vận dụng)
                </label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={parsedRequest.difficulty.hard}
                  onChange={(e) =>
                    handleUpdateDifficultyCounts('hard', Number(e.target.value))
                  }
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md text-sm font-bold text-slate-900 tabular-nums"
                />
              </div>
            </div>
          </div>

          {/* Knowledge Areas */}
          <div className="space-y-2.5">
            <label className="text-xs font-bold text-slate-700 block">
              Phạm vi kiến thức & Chương trọng tâm ({parsedRequest.knowledgeAreas.length} mảng)
            </label>
            <div className="space-y-2">
              {parsedRequest.knowledgeAreas.map((area, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2"
                >
                  <span className="text-xs font-mono text-slate-400 tabular-nums w-5">
                    {idx + 1}.
                  </span>
                  <input
                    type="text"
                    value={area}
                    onChange={(e) => {
                      const next = [...parsedRequest.knowledgeAreas];
                      next[idx] = e.target.value;
                      setParsedRequest({ ...parsedRequest, knowledgeAreas: next });
                    }}
                    className="flex-1 text-xs sm:text-sm text-slate-800 focus:outline-hidden"
                  />
                  {parsedRequest.knowledgeAreas.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveKnowledgeArea(area)}
                      className="text-slate-400 hover:text-rose-600 p-1"
                      title="Xóa mảng kiến thức này"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        close
                      </span>
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newAreaInput}
                onChange={(e) => setNewAreaInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddKnowledgeArea())}
                placeholder="Thêm chương hoặc mảng kiến thức bổ sung..."
                className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-600 focus:bg-white"
              />
              <button
                type="button"
                onClick={handleAddKnowledgeArea}
                className="px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold whitespace-nowrap"
              >
                + Thêm mục
              </button>
            </div>
          </div>

          {/* Options */}
          <div className="flex flex-wrap items-center gap-6 pt-1 text-xs text-slate-700">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={parsedRequest.includeExplanation}
                onChange={(e) =>
                  setParsedRequest({
                    ...parsedRequest,
                    includeExplanation: e.target.checked,
                  })
                }
                className="rounded text-indigo-600"
              />
              <span className="font-medium">Kèm giải thích đáp án chi tiết</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={parsedRequest.needsWebResearch}
                onChange={(e) =>
                  setParsedRequest({
                    ...parsedRequest,
                    needsWebResearch: e.target.checked,
                  })
                }
                className="rounded text-indigo-600"
              />
              <span className="font-medium">
                Ưu tiên nghiên cứu nguồn tài liệu chính thức trên Web
              </span>
            </label>
          </div>

          <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setStep('input');
                setStepError(null);
              }}
              className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              <span>Sửa yêu cầu ban đầu</span>
            </button>

            <button
              type="button"
              id="btn-confirm-build-knowledge"
              onClick={handleBuildKnowledge}
              className="w-full sm:w-auto px-7 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-sm transition-all flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-[18px]">library_books</span>
              <span>Xác nhận & Xây dựng nội dung</span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* SCREEN 3: XÂY DỰNG NỘI DUNG (REAL STEPS)  */}
      {/* ========================================= */}
      {step === 'building-knowledge' && (
        <div className="py-4 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Đang nghiên cứu & xây dựng nội dung học tập
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Chủ đề: <span className="font-semibold text-slate-800">{parsedRequest?.topic}</span>
              </p>
            </div>
            {!buildError && (
              <div className="flex items-center gap-2 text-xs font-semibold text-indigo-700">
                <span className="material-symbols-outlined text-[18px] animate-spin">
                  progress_activity
                </span>
                <span>Đang xử lý thực tế...</span>
              </div>
            )}
          </div>

          <div className="space-y-2.5">
            {buildLogs.map((log, idx) => (
              <div
                key={idx}
                className={`p-3.5 rounded-xl border flex items-start gap-3 text-xs ${
                  log.status === 'completed'
                    ? 'border-emerald-200 bg-emerald-50/40 text-emerald-950'
                    : log.status === 'warning'
                    ? 'border-amber-200 bg-amber-50/50 text-amber-950'
                    : log.status === 'error'
                    ? 'border-rose-200 bg-rose-50 text-rose-900'
                    : 'border-indigo-200 bg-indigo-50/40 text-slate-800'
                }`}
              >
                <span
                  className={`material-symbols-outlined text-[18px] shrink-0 mt-0.5 ${
                    log.status === 'completed'
                      ? 'text-emerald-600'
                      : log.status === 'warning'
                      ? 'text-amber-600'
                      : log.status === 'error'
                      ? 'text-rose-600'
                      : 'text-indigo-600 animate-spin'
                  }`}
                >
                  {log.status === 'completed'
                    ? 'check_circle'
                    : log.status === 'warning'
                    ? 'info'
                    : log.status === 'error'
                    ? 'error'
                    : 'progress_activity'}
                </span>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="font-semibold">{log.message}</p>
                  {log.detail && (
                    <p className="text-[11px] opacity-80 break-words">{log.detail}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {buildError && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 space-y-3">
              <div className="flex items-start gap-2 text-xs">
                <span className="material-symbols-outlined text-[18px] text-rose-600 shrink-0">
                  error
                </span>
                <div>
                  <p className="font-bold">Xây dựng nội dung thất bại</p>
                  <p className="mt-0.5">{buildError}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleBuildKnowledge}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
                >
                  Thử lại
                </button>
                <button
                  type="button"
                  onClick={() => setStep('confirm-request')}
                  className="px-4 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50"
                >
                  Quay lại chỉnh sửa yêu cầu
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================= */}
      {/* SCREEN 4: XEM TRƯỚC & CHỈNH SỬA KIẾN THỨC */}
      {/* ========================================= */}
      {step === 'preview-knowledge' && knowledgePkg && (
        <div className="space-y-5">
          {/* Origin Disclosure Banner (WEB vs AI_GENERATED) */}
          <div
            className={`p-4 rounded-xl border text-xs space-y-1.5 ${
              knowledgePkg.contentOrigin === 'WEB'
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                : 'bg-amber-50/80 border-amber-200 text-amber-950'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold">
                <span
                  className={`material-symbols-outlined text-[18px] ${
                    knowledgePkg.contentOrigin === 'WEB'
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                  }`}
                >
                  {knowledgePkg.contentOrigin === 'WEB' ? 'public' : 'smart_toy'}
                </span>
                <span>
                  {knowledgePkg.contentOrigin === 'WEB'
                    ? `Nguồn nội dung: Tổng hợp từ ${knowledgePkg.webSources.length} trang Web đã truy xuất thực tế`
                    : 'Nguồn nội dung: AI tự tổng hợp (chưa đối chiếu nguồn Web trực tiếp)'}
                </span>
              </div>
              <span className="text-[11px] font-medium opacity-80">
                {knowledgePkg.chapters.length} chương · {knowledgePkg.documentSource.knowledgeUnits.length} đơn vị kiến thức
              </span>
            </div>
            <p className="leading-relaxed opacity-90">{knowledgePkg.originNotice}</p>
            {knowledgePkg.freshnessWarning && (
              <p className="font-semibold text-rose-800 pt-1">
                Lưu ý tính thời sự: {knowledgePkg.freshnessWarning}
              </p>
            )}
          </div>

          {/* Web Sources List (Only if WEB) */}
          {knowledgePkg.contentOrigin === 'WEB' && knowledgePkg.webSources.length > 0 && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Trang lý thuyết gốc dùng để biên soạn nội dung ({knowledgePkg.webSources.length})
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {knowledgePkg.webSources.map((src) => (
                  <div
                    key={src.id}
                    className="p-3 bg-white rounded-lg border border-slate-200 space-y-1 text-xs"
                  >
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold text-indigo-700 hover:underline line-clamp-1 flex items-center gap-1"
                    >
                      <span className="truncate">{src.title}</span>
                      <span className="material-symbols-outlined text-[14px] shrink-0">
                        open_in_new
                      </span>
                    </a>
                    <div className="text-[11px] text-slate-500 flex items-center gap-2">
                      <span>{src.domain}</span>
                      <span>·</span>
                      <span>
                        Truy xuất:{' '}
                        {new Date(src.retrievedAt).toLocaleTimeString('vi-VN')}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 line-clamp-2 pt-0.5">
                      {src.usedExcerpts[0] || src.fetchedContent.slice(0, 140)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mode Toggle: Structured Preview vs Markdown Editor */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-900">
              Bản xem trước nội dung học tập làm căn cứ tạo đề
            </h3>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setPreviewMode('structured')}
                className={`px-3 py-1.5 rounded-md font-semibold transition-colors whitespace-nowrap ${
                  previewMode === 'structured'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Xem theo Chương & Mục
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode('edit')}
                className={`px-3 py-1.5 rounded-md font-semibold transition-colors whitespace-nowrap ${
                  previewMode === 'edit'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Chỉnh sửa nội dung
              </button>
            </div>
          </div>

          {previewMode === 'structured' ? (
            <div className="space-y-4 max-h-[460px] overflow-y-auto pr-1">
              {knowledgePkg.chapters.map((chap) => (
                <div
                  key={chap.id}
                  className="p-4 rounded-xl bg-white border border-slate-200 space-y-3"
                >
                  <div className="border-b border-slate-100 pb-2">
                    <h4 className="font-bold text-sm text-indigo-800">{chap.title}</h4>
                    {chap.summary && (
                      <p className="text-xs text-slate-600 mt-0.5">{chap.summary}</p>
                    )}
                  </div>

                  <div className="space-y-3">
                    {chap.sections.map((sec) => (
                      <div key={sec.id} className="space-y-1.5 text-xs">
                        <h5 className="font-bold text-slate-900">
                          {sec.sectionNumber} {sec.title}
                        </h5>

                        {sec.concepts.length > 0 && (
                          <ul className="space-y-1 pl-3">
                            {sec.concepts.map((c, cIdx) => (
                              <li key={cIdx} className="text-slate-700 leading-relaxed">
                                <span className="font-semibold text-slate-900">
                                  {c.name}:
                                </span>{' '}
                                {c.definition}
                              </li>
                            ))}
                          </ul>
                        )}

                        {sec.explanation && (
                          <p className="text-slate-700 leading-relaxed">
                            {sec.explanation}
                          </p>
                        )}

                        {sec.example && (
                          <p className="text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-200/70">
                            <span className="font-semibold text-slate-800">Ví dụ: </span>
                            {sec.example}
                          </p>
                        )}

                        {sec.keyPoints.length > 0 && (
                          <div className="text-[11px] text-slate-600">
                            <span className="font-semibold text-slate-700">
                              Trọng tâm:{' '}
                            </span>
                            {sec.keyPoints.join(' · ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={editedMarkdown}
                onChange={(e) => setEditedMarkdown(e.target.value)}
                rows={16}
                className="w-full p-4 text-xs sm:text-sm text-slate-900 bg-slate-50 border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-600 focus:bg-white font-mono leading-relaxed"
              />
              <p className="text-[11px] text-slate-500">
                Mọi chỉnh sửa của bạn ở đây sẽ được hệ thống lập chỉ mục lại và dùng làm căn cứ duy nhất khi tạo câu hỏi.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep('confirm-request')}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                <span>Sửa cấu hình</span>
              </button>
              <button
                type="button"
                onClick={handleBuildKnowledge}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                <span>Biên soạn lại</span>
              </button>
            </div>

            <button
              type="button"
              id="btn-confirm-generate-quiz"
              onClick={handleConfirmAndGenerateQuiz}
              className="w-full sm:w-auto px-7 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-sm transition-all flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
              <span>
                Xác nhận & Tạo {knowledgePkg.request.questionCount} câu trắc nghiệm
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* SCREEN 5: TẠO ĐỀ & KIỂM ĐỊNH (REAL STEPS) */}
      {/* ========================================= */}
      {step === 'generating-quiz' && (
        <div className="py-4 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Đang tạo câu hỏi & kiểm định chất lượng
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Bộ đề: <span className="font-semibold text-slate-800">{knowledgePkg?.request.quizTitle}</span>
              </p>
            </div>
            {!genError && (
              <div className="flex items-center gap-2 text-xs font-semibold text-indigo-700">
                <span className="material-symbols-outlined text-[18px] animate-spin">
                  progress_activity
                </span>
                <span>Đang sinh & kiểm định...</span>
              </div>
            )}
          </div>

          <div className="space-y-2.5">
            {genLogs.map((log, idx) => (
              <div
                key={idx}
                className={`p-3.5 rounded-xl border flex items-start gap-3 text-xs ${
                  log.status === 'completed'
                    ? 'border-emerald-200 bg-emerald-50/40 text-emerald-950'
                    : log.status === 'warning'
                    ? 'border-amber-200 bg-amber-50/50 text-amber-950'
                    : log.status === 'error'
                    ? 'border-rose-200 bg-rose-50 text-rose-900'
                    : 'border-indigo-200 bg-indigo-50/40 text-slate-800'
                }`}
              >
                <span
                  className={`material-symbols-outlined text-[18px] shrink-0 mt-0.5 ${
                    log.status === 'completed'
                      ? 'text-emerald-600'
                      : log.status === 'warning'
                      ? 'text-amber-600'
                      : log.status === 'error'
                      ? 'text-rose-600'
                      : 'text-indigo-600 animate-spin'
                  }`}
                >
                  {log.status === 'completed'
                    ? 'check_circle'
                    : log.status === 'warning'
                    ? 'warning'
                    : log.status === 'error'
                    ? 'error'
                    : 'progress_activity'}
                </span>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="font-semibold">{log.message}</p>
                  {log.detail && (
                    <p className="text-[11px] opacity-80 break-words">{log.detail}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {genError && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 space-y-3">
              <div className="flex items-start gap-2 text-xs">
                <span className="material-symbols-outlined text-[18px] text-rose-600 shrink-0">
                  error
                </span>
                <div>
                  <p className="font-bold">Tạo đề thi không thành công</p>
                  <p className="mt-0.5">{genError}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleConfirmAndGenerateQuiz}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
                >
                  Thử tạo lại
                </button>
                <button
                  type="button"
                  onClick={() => setStep('preview-knowledge')}
                  className="px-4 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50"
                >
                  Quay lại xem trước kiến thức
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
