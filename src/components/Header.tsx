import React, { useState } from 'react';
import { ScreenId } from '../types';

interface HeaderProps {
  currentScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
  quizTitle?: string;
  hasActiveQuiz: boolean;
  onOpenSampleModal?: () => void;
  onStartWorkspace?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentScreen,
  onNavigate,
  onOpenSampleModal,
  onStartWorkspace,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const screensList: { id: ScreenId; label: string; icon: string }[] = [
    { id: 'upload', label: '1. Tải tài liệu', icon: 'upload_file' },
    { id: 'generating', label: '2. AI Xử lý', icon: 'smart_toy' },
    { id: 'quiz-detail', label: '3. Bộ câu hỏi', icon: 'quiz' },
    { id: 'quiz-taking', label: '4. Làm bài thi', icon: 'assignment' },
    { id: 'quiz-result', label: '5. Kết quả', icon: 'analytics' },
    { id: 'quiz-review', label: '6. Lời giải', icon: 'fact_check' },
    { id: 'quiz-edit', label: '7. Chỉnh sửa', icon: 'edit_note' },
    { id: 'library-history', label: '8. Kho tài liệu', icon: 'folder_open' },
  ];

  const handleGoHome = () => {
    setMobileMenuOpen(false);
    onNavigate('upload');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleGoWorkspace = () => {
    setMobileMenuOpen(false);
    if (onStartWorkspace) {
      onStartWorkspace();
    } else {
      onNavigate('upload');
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white/92 backdrop-blur-md border-b border-slate-200/75">
      {/* Primary 1-Row Top Bar: Brand — Simple Menu — Primary Action */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand wordmark "quizzAi" */}
        <button
          type="button"
          onClick={handleGoHome}
          id="brand-logo-button"
          className="flex items-center gap-2.5 cursor-pointer group select-none whitespace-nowrap shrink-0"
        >
          <span className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#ec4899] to-[#16a34a] flex items-center justify-center text-white shadow-sm group-hover:scale-105 transition-transform duration-200">
            <span className="material-symbols-outlined text-[20px]">search</span>
          </span>
          <span className="font-brand font-extrabold text-2xl tracking-tight text-slate-900">
            quizz
            <span className="bg-gradient-to-r from-[#ec4899] to-[#16a34a] bg-clip-text text-transparent">
              Ai
            </span>
          </span>
        </button>

        {/* Zone 2: Simple single-line menu links */}
        <nav
          aria-label="Điều hướng chính"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600"
        >
          <button
            type="button"
            onClick={handleGoHome}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
              currentScreen === 'upload'
                ? 'text-[#15803d] border-[#ec4899] font-semibold'
                : 'border-transparent hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            Trang chủ
          </button>
          <button
            type="button"
            onClick={handleGoWorkspace}
            className="whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:text-[#ec4899] hover:border-[#ec4899]/60 transition-colors cursor-pointer"
          >
            Tạo đề ngay
          </button>
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              onNavigate('quiz-detail');
            }}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
              currentScreen === 'quiz-detail' ||
              currentScreen === 'quiz-taking' ||
              currentScreen === 'quiz-result' ||
              currentScreen === 'quiz-review' ||
              currentScreen === 'quiz-edit'
                ? 'text-[#15803d] border-[#15803d] font-semibold'
                : 'border-transparent hover:text-[#15803d] hover:border-[#15803d]/50'
            }`}
          >
            Bộ câu hỏi
          </button>
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              onNavigate('library-history');
            }}
            id="open-history-header-btn"
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
              currentScreen === 'library-history'
                ? 'text-[#15803d] border-[#15803d] font-semibold'
                : 'border-transparent hover:text-[#15803d] hover:border-[#15803d]/50'
            }`}
          >
            Kho tài liệu
          </button>
          {onOpenSampleModal && (
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenSampleModal();
              }}
              id="open-samples-header-btn"
              className="whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:text-[#ec4899] hover:border-[#ec4899]/50 transition-colors cursor-pointer"
            >
              Tài liệu mẫu
            </button>
          )}
        </nav>

        {/* Zone 3: Single Primary CTA + mobile menu toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleGoWorkspace}
            id="create-new-quiz-btn"
            className="px-4 py-2 text-xs sm:text-sm font-bold text-white rounded-xl bg-[#ec4899] hover:bg-[#db2777] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all whitespace-nowrap shrink-0 cursor-pointer"
          >
            Bắt đầu ngay
          </button>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Mở menu điều hướng"
            className="md:hidden w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">
              {mobileMenuOpen ? 'close' : 'menu'}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile Dropdown Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-100 bg-white px-4 py-3 flex flex-col gap-1 text-sm font-medium text-slate-700">
          <button
            type="button"
            onClick={handleGoHome}
            className="text-left px-3 py-2.5 rounded-xl hover:bg-slate-50"
          >
            Trang chủ
          </button>
          <button
            type="button"
            onClick={handleGoWorkspace}
            className="text-left px-3 py-2.5 rounded-xl hover:bg-slate-50"
          >
            Tạo đề ngay
          </button>
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              onNavigate('quiz-detail');
            }}
            className="text-left px-3 py-2.5 rounded-xl hover:bg-slate-50"
          >
            Bộ câu hỏi
          </button>
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              onNavigate('library-history');
            }}
            className="text-left px-3 py-2.5 rounded-xl hover:bg-slate-50"
          >
            Kho tài liệu
          </button>
          {onOpenSampleModal && (
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenSampleModal();
              }}
              className="text-left px-3 py-2.5 rounded-xl hover:bg-slate-50"
            >
              Tài liệu mẫu
            </button>
          )}
        </div>
      )}

      {/* Contextual Workflow Bar: shown only when working inside a quiz/library screen */}
      {currentScreen !== 'upload' && (
        <div className="bg-slate-50/90 border-t border-slate-200/60 overflow-x-auto no-scrollbar py-1.5 px-4 sm:px-6">
          <div className="max-w-7xl mx-auto flex items-center gap-1.5 text-xs min-w-max">
            {screensList.map((screen) => {
              const isActive = currentScreen === screen.id;
              return (
                <button
                  key={screen.id}
                  onClick={() => onNavigate(screen.id)}
                  id={`nav-screen-${screen.id}`}
                  className={`px-2.5 py-1 rounded-lg transition-all font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-[#15803d] text-white shadow-xs font-semibold'
                      : 'text-slate-600 hover:bg-white hover:text-slate-900'
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">{screen.icon}</span>
                  <span>{screen.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
};
