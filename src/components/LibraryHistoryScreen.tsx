import React, { useState } from 'react';
import {
  QuizSet,
  QuizAttemptRecord,
  SampleDocument,
  DocumentSource,
} from '../types';
import { DocumentPrintModal } from './DocumentPrintModal';
import { DocumentViewModal } from './DocumentViewModal';
import { ExportPaperModal } from './ExportPaperModal';
import { getIncorrectlyAnsweredQuestions } from '../utils/quizReview';

interface LibraryHistoryScreenProps {
  documents?: (SampleDocument | DocumentSource)[];
  initialTab?: 'documents' | 'quizzes' | 'history';
  quizList: QuizSet[];
  attemptsHistory: QuizAttemptRecord[];
  onSelectQuiz: (quiz: QuizSet) => void;
  onSelectAttempt: (record: QuizAttemptRecord) => void;
  onStartReview: (record: QuizAttemptRecord) => void;
  onCreateNew: () => void;
  onDeleteDocument?: (id: string) => void;
  onSelectDocumentForQuiz?: (doc: SampleDocument | DocumentSource) => void;
}

export const LibraryHistoryScreen: React.FC<LibraryHistoryScreenProps> = ({
  documents = [],
  initialTab = 'documents',
  quizList,
  attemptsHistory,
  onSelectQuiz,
  onSelectAttempt,
  onStartReview,
  onCreateNew,
  onDeleteDocument,
  onSelectDocumentForQuiz,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'documents' | 'quizzes' | 'history'>(initialTab);

  // Modals state
  const [selectedDocForPrint, setSelectedDocForPrint] = useState<SampleDocument | DocumentSource | null>(null);
  const [selectedDocForView, setSelectedDocForView] = useState<SampleDocument | DocumentSource | null>(null);
  const [selectedQuizForExport, setSelectedQuizForExport] = useState<QuizSet | null>(null);

  // Filter documents
  const filteredDocuments = documents.filter((doc) => {
    const term = searchTerm.toLowerCase();
    const title = (doc.title || doc.fileName).toLowerCase();
    return title.includes(term) || doc.fileName.toLowerCase().includes(term);
  });

  // Filter quizzes
  const filteredQuizzes = quizList.filter((q) => {
    const term = searchTerm.toLowerCase();
    return (
      q.title.toLowerCase().includes(term) ||
      q.documentName.toLowerCase().includes(term) ||
      q.questions.some((item) => item.questionText.toLowerCase().includes(term))
    );
  });

  // Filter attempts
  const filteredAttempts = attemptsHistory.filter((a) => {
    const term = searchTerm.toLowerCase();
    return (
      a.attemptType === 'quiz' &&
      a.quizSet.title.toLowerCase().includes(term)
    );
  });

  const totalQuestions = quizList.reduce((acc, curr) => acc + curr.questions.length, 0);
  const avgScore =
    attemptsHistory.length > 0
      ? (
          attemptsHistory.reduce((acc, curr) => acc + curr.attempt.score, 0) /
          attemptsHistory.length
        ).toFixed(1)
      : '0.0';

  const handleDownloadDoc = (doc: SampleDocument | DocumentSource) => {
    const content = 'rawText' in doc ? doc.rawText : doc.content || '';
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.fileName.replace(/\.[^/.]+$/, '')}_Unicode.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8 sm:py-12 space-y-8">
      {/* Top Banner & Stats */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="px-2.5 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700">
              Kho lưu trữ học tập & khảo thí
            </span>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 mt-1">
              Kho tài liệu & Lịch sử đề thi
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
              Quản lý tài liệu gốc, in tài liệu không kèm giao diện hệ thống, và theo dõi các bộ đề thi trắc nghiệm.
            </p>
          </div>

          <button
            onClick={onCreateNew}
            id="btn-lib-create-new"
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-bold shadow-xs transition-all flex items-center gap-1.5 self-start sm:self-auto"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>Tải lên tài liệu mới</span>
          </button>
        </div>

        {/* 4 Metric Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-slate-200">
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
            <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
              <span className="material-symbols-outlined text-[15px] text-blue-600">article</span>
              Kho tài liệu gốc
            </span>
            <p className="font-display text-lg sm:text-xl font-bold text-slate-900 mt-1">
              {documents.length} tài liệu
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
            <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
              <span className="material-symbols-outlined text-[15px] text-indigo-600">library_books</span>
              Số bộ đề đã tạo
            </span>
            <p className="font-display text-lg sm:text-xl font-bold text-slate-900 mt-1">
              {quizList.length} bộ đề
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
            <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
              <span className="material-symbols-outlined text-[15px] text-amber-600">history_edu</span>
              Lượt làm bài thi
            </span>
            <p className="font-display text-lg sm:text-xl font-bold text-slate-900 mt-1">
              {attemptsHistory.length} lượt
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-emerald-50/50 border border-emerald-200">
            <span className="text-[11px] font-semibold text-emerald-800 flex items-center gap-1">
              <span className="material-symbols-outlined text-[15px]">grade</span>
              Điểm trung bình
            </span>
            <p className="font-display text-lg sm:text-xl font-bold text-emerald-700 mt-1">
              {avgScore} / 10
            </p>
          </div>
        </div>
      </div>

      {/* Tabs & Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-slate-200 w-full sm:w-auto">
          <button
            onClick={() => setActiveTab('documents')}
            id="tab-lib-documents"
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'documents'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">description</span>
            <span>Kho tài liệu học tập ({documents.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('quizzes')}
            id="tab-lib-quizzes"
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'quizzes'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">folder</span>
            <span>Kho bộ đề ({quizList.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            id="tab-lib-history"
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'history'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">fact_check</span>
            <span>Lịch sử điểm ({attemptsHistory.length})</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative w-full sm:w-72">
          <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[18px] text-slate-400">
            search
          </span>
          <input
            type="text"
            placeholder={
              activeTab === 'documents'
                ? 'Tìm tên tài liệu, môn học...'
                : activeTab === 'quizzes'
                ? 'Tìm kiếm theo tên đề, câu hỏi...'
                : 'Tìm kiếm lịch sử thi...'
            }
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs placeholder:text-slate-400 focus:outline-hidden focus:border-indigo-600 transition-colors shadow-2xs"
          />
        </div>
      </div>

      {/* TAB 1: KHO TÀI LIỆU HỌC TẬP */}
      {activeTab === 'documents' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Danh sách tài liệu đã trích xuất sạch Unicode ({filteredDocuments.length})
            </h2>
            <span className="text-xs text-slate-500">
              Tất cả tài liệu hỗ trợ xem trước, tải xuống và in chuẩn mẫu A4
            </span>
          </div>

          {filteredDocuments.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
              <span className="material-symbols-outlined text-[48px] text-slate-300">
                folder_off
              </span>
              <p className="text-sm font-semibold text-slate-700">Chưa có tài liệu nào phù hợp</p>
              <button
                onClick={onCreateNew}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-xs hover:bg-indigo-700"
              >
                Tải lên tài liệu ngay
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDocuments.map((doc, idx) => {
                const title = doc.title || doc.fileName;
                const fileType = (
                  'fileType' in doc ? doc.fileType : doc.fileName.split('.').pop() || 'pdf'
                ).toUpperCase();
                const chaptersCount = doc.chapters?.length || 0;
                const kuCount = doc.knowledgeUnits?.length || 0;

                return (
                  <div
                    key={`${doc.id || 'doc'}-${idx}`}
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:shadow-md hover:border-indigo-300 transition-all flex flex-col justify-between"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            fileType === 'PDF'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : fileType === 'DOCX'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                        >
                          {fileType}
                        </span>

                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          Đã xử lý sạch
                        </span>
                      </div>

                      <div>
                        <h3 className="font-bold text-slate-900 text-sm line-clamp-2 leading-snug">
                          {title}
                        </h3>
                        <p className="text-xs text-slate-500 mt-1 truncate">
                          Tập tin: {doc.fileName}
                        </p>
                      </div>

                      {/* Metadata grid */}
                      <div className="grid grid-cols-3 gap-2 py-2.5 px-3 bg-slate-50 rounded-xl text-center text-slate-600 text-[11px] border border-slate-100">
                        <div>
                          <span className="text-slate-400 block text-[10px]">Dung lượng</span>
                          <span className="font-semibold text-slate-800">{doc.fileSize}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">Số trang</span>
                          <span className="font-semibold text-slate-800">{doc.pageCount} tr</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">Chương</span>
                          <span className="font-semibold text-indigo-700">{chaptersCount} c.mục</span>
                        </div>
                      </div>

                      <div className="text-[11px] text-slate-500 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px] text-indigo-600">
                          psychology
                        </span>
                        <span>{kuCount} đơn vị kiến thức AI đã nhận diện</span>
                      </div>
                    </div>

                    {/* Action buttons requested: [Xem] [Tải xuống] [In tài liệu] [Xóa] */}
                    <div className="pt-4 mt-4 border-t border-slate-100 space-y-2">
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          onClick={() => setSelectedDocForView(doc)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
                          title="Xem nội dung chi tiết và cấu trúc chương mục"
                        >
                          <span className="material-symbols-outlined text-[16px]">visibility</span>
                          <span>Xem</span>
                        </button>

                        <button
                          onClick={() => handleDownloadDoc(doc)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
                          title="Tải văn bản sạch Unicode UTF-8"
                        >
                          <span className="material-symbols-outlined text-[16px]">download</span>
                          <span>Tải về</span>
                        </button>

                        <button
                          onClick={() => setSelectedDocForPrint(doc)}
                          className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center gap-1 transition-colors border border-blue-200/80"
                          title="In tài liệu học tập (chỉ in nội dung, ẩn sidebar & UI)"
                        >
                          <span className="material-symbols-outlined text-[16px]">print</span>
                          <span>In tài liệu</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {onSelectDocumentForQuiz && (
                          <button
                            onClick={() => onSelectDocumentForQuiz(doc)}
                            className="flex-1 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-1 transition-colors shadow-2xs"
                          >
                            <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
                            <span>Tạo đề thi</span>
                          </button>
                        )}

                        {onDeleteDocument && (
                          <button
                            onClick={() => onDeleteDocument(doc.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            title="Xóa tài liệu khỏi kho"
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: KHO BỘ ĐỀ THI */}
      {activeTab === 'quizzes' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Danh sách bộ đề thi đã tạo ({filteredQuizzes.length})
            </h2>
            <span className="text-xs text-slate-500">
              Có thể thi trực tuyến hoặc xuất đề giấy in ấn kèm đáp án và căn cứ sư phạm
            </span>
          </div>

          {filteredQuizzes.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
              <span className="material-symbols-outlined text-[48px] text-slate-300">
                quiz
              </span>
              <p className="text-sm font-semibold text-slate-700">Chưa có bộ đề nào</p>
              <button
                onClick={onCreateNew}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-xs hover:bg-indigo-700"
              >
                Tạo bộ đề mới
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredQuizzes.map((quiz, idx) => (
                <div
                  key={`${quiz.id || 'quiz'}-${idx}`}
                  className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:shadow-md hover:border-indigo-300 transition-all flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {quiz.totalQuestions} câu trắc nghiệm
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {new Date(quiz.createdAt).toLocaleDateString('vi-VN')}
                      </span>
                    </div>

                    <div>
                      <h3 className="font-bold text-slate-900 text-sm line-clamp-2 leading-snug">
                        {quiz.title}
                      </h3>
                      <p className="text-xs text-slate-500 mt-1 truncate">
                        Nguồn: {quiz.documentName}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium">
                        {quiz.recommendedMinutes} phút
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium">
                        Mức độ: {quiz.difficulty === 'all' ? 'Tổng hợp' : quiz.difficulty}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-medium border border-emerald-200/60">
                        {quiz.originType === 'AI_TEXT'
                          ? quiz.contentOrigin === 'WEB'
                            ? 'AI + Nguồn Web'
                            : 'AI tổng hợp'
                          : '100% Gắn nguồn'}
                      </span>
                    </div>
                  </div>

                  <div className="pt-4 mt-4 border-t border-slate-100 flex items-center gap-2">
                    <button
                      onClick={() => onSelectQuiz(quiz)}
                      className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all flex items-center justify-center gap-1 shadow-xs"
                    >
                      <span className="material-symbols-outlined text-[16px]">visibility</span>
                      <span>Xem & Thi</span>
                    </button>

                    <button
                      onClick={() => setSelectedQuizForExport(quiz)}
                      className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all flex items-center gap-1"
                      title="Xuất đề thi giấy chuẩn khảo thí hoặc tải file Word .docx"
                    >
                      <span className="material-symbols-outlined text-[16px]">print</span>
                      <span>In / Xuất đề</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: LỊCH SỬ ĐIỂM THI */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Lịch sử các lần làm bài thi ({filteredAttempts.length})
            </h2>
            <span className="text-xs text-slate-500">
              Xem lại phân tích điểm số và các câu sai cần ôn tập
            </span>
          </div>

          {filteredAttempts.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
              <span className="material-symbols-outlined text-[48px] text-slate-300">
                history_edu
              </span>
              <p className="text-sm font-semibold text-slate-700">Chưa có lượt thi nào</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredAttempts
                .filter((record) => record.attemptType === 'quiz')
                .map((record) => {
                  const { attempt } = record;
                  const wrongQuestions = getIncorrectlyAnsweredQuestions(record.quizSet, attempt);
                  const reviewRecords = attemptsHistory.filter(
                    (item) =>
                      item.attemptType === 'review' &&
                      item.sourceAttemptId === attempt.id
                  );

                  return (
                    <article
                      key={attempt.id}
                      className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-xs"
                    >
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                              {record.quizSet.title}
                            </h3>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                attempt.score >= 8
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : attempt.score >= 5
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {attempt.score.toFixed(1)} / 10 điểm
                            </span>
                          </div>
                          <p className="text-xs text-slate-500">
                            {new Date(attempt.completedAt).toLocaleString('vi-VN')} ·{' '}
                            {attempt.totalQuestions} câu · Đúng {attempt.correctCount} · Sai{' '}
                            {wrongQuestions.length} · Chưa trả lời {attempt.unansweredCount}
                          </p>
                        </div>

                        <button
                          onClick={() => onSelectAttempt(record)}
                          className="self-start rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-800 transition-all hover:bg-slate-200 xl:self-auto"
                        >
                          Xem kết quả
                        </button>
                      </div>

                      <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                        {wrongQuestions.length > 0 ? (
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <h4 className="text-sm font-bold text-emerald-950">
                                Ôn tập và củng cố
                              </h4>
                              <p className="mt-1 text-xs text-emerald-800">
                                {wrongQuestions.length} câu sai từ chính lượt thi này cần ôn lại.
                              </p>
                            </div>
                            <button
                              onClick={() => onStartReview(record)}
                              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-800"
                            >
                              <span className="material-symbols-outlined text-[17px]">replay</span>
                              Bắt đầu ôn tập
                            </button>
                          </div>
                        ) : attempt.unansweredCount === 0 ? (
                          <p className="text-sm font-semibold text-emerald-900">
                            Bạn đã trả lời đúng tất cả câu hỏi, không có nội dung cần ôn tập.
                          </p>
                        ) : (
                          <p className="text-sm font-semibold text-slate-700">
                            Không có câu trả lời sai đã chọn để ôn tập; còn {attempt.unansweredCount}{' '}
                            câu chưa trả lời.
                          </p>
                        )}
                      </div>

                      {reviewRecords.length > 0 && (
                        <div className="mt-4 border-t border-slate-100 pt-4">
                          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                            Lịch sử ôn tập
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {reviewRecords.map((reviewRecord) => (
                              <button
                                key={reviewRecord.attempt.id}
                                onClick={() => onSelectAttempt(reviewRecord)}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:border-emerald-300 hover:bg-emerald-50"
                              >
                                <span>
                                  {new Date(reviewRecord.attempt.completedAt).toLocaleString('vi-VN')}
                                </span>
                                <span className="font-bold text-emerald-800">
                                  {reviewRecord.attempt.correctCount}/
                                  {reviewRecord.attempt.totalQuestions} đúng
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* DOCUMENT PRINT MODAL */}
      <DocumentPrintModal
        document={selectedDocForPrint}
        isOpen={!!selectedDocForPrint}
        onClose={() => setSelectedDocForPrint(null)}
      />

      {/* DOCUMENT VIEW MODAL */}
      <DocumentViewModal
        document={selectedDocForView}
        isOpen={!!selectedDocForView}
        onClose={() => setSelectedDocForView(null)}
        onPrint={(d) => setSelectedDocForPrint(d)}
        onGenerateQuiz={(d) => {
          if (onSelectDocumentForQuiz) onSelectDocumentForQuiz(d);
        }}
      />

      {/* EXAM PAPER EXPORT MODAL */}
      {selectedQuizForExport && (
        <ExportPaperModal
          quizSet={selectedQuizForExport}
          isOpen={!!selectedQuizForExport}
          onClose={() => setSelectedQuizForExport(null)}
        />
      )}
    </div>
  );
};
