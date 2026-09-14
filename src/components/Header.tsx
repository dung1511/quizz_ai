import React from 'react';
import { ScreenId } from '../types';

interface HeaderProps {
  currentScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
  quizTitle?: string;
  hasActiveQuiz: boolean;
  onOpenSampleModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentScreen,
  onNavigate,
  hasActiveQuiz,
  onOpenSampleModal
}) => {
  const screensList: { id: ScreenId; label: string; icon: string; shortLabel: string }[] = [
    { id: 'upload', label: '1. Tải tài liệu', shortLabel: 'Tải lên', icon: 'upload_file' },
    { id: 'generating', label: '2. AI Xử lý', shortLabel: 'AI Xử lý', icon: 'smart_toy' },
    { id: 'quiz-detail', label: '3. Bộ câu hỏi', shortLabel: 'Bộ đề', icon: 'quiz' },
    { id: 'quiz-taking', label: '4. Làm bài thi', shortLabel: 'Thi trắc nghiệm', icon: 'assignment' },
    { id: 'quiz-result', label: '5. Kết quả & Phân tích', shortLabel: 'Kết quả', icon: 'analytics' },
    { id: 'quiz-review', label: '6. Lời giải chi tiết', shortLabel: 'Lời giải', icon: 'fact_check' },
    { id: 'quiz-edit', label: '7. Chỉnh sửa', shortLabel: 'Biên tập', icon: 'edit_note' },
    { id: 'library-history', label: '8. Kho tài liệu & Lịch sử', shortLabel: 'Lịch sử', icon: 'folder_open' },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[#e2e4e8] shadow-xs">
      {/* Primary Top Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand / Logo */}
        <div 
          onClick={() => onNavigate('upload')}
          className="flex items-center gap-3 cursor-pointer group select-none"
          id="brand-logo-button"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#3525cd] to-[#4f46e5] flex items-center justify-center text-white shadow-md shadow-[#3525cd]/20 group-hover:scale-105 transition-transform duration-200">
            <span className="material-symbols-outlined text-[24px]">auto_awesome</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display font-extrabold text-xl text-[#191c1e] tracking-tight">QuizAI</span>
              <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[#d1fae5] text-[#065f46] rounded-md border border-[#6cf8bb]/50">
                PRO
              </span>
            </div>
            <p className="text-[11px] text-[#777587] -mt-0.5 hidden sm:block">Trợ lý tạo đề thi thông minh</p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {onOpenSampleModal && (
            <button
              onClick={onOpenSampleModal}
              id="open-samples-header-btn"
              className="px-3 py-1.5 text-xs sm:text-sm font-medium text-[#464555] hover:text-[#3525cd] hover:bg-[#f2f4f6] rounded-lg transition-colors flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">menu_book</span>
              <span className="hidden sm:inline">Tài liệu mẫu</span>
            </button>
          )}

          <button
            onClick={() => onNavigate('library-history')}
            id="open-history-header-btn"
            className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
              currentScreen === 'library-history'
                ? 'bg-[#3525cd]/10 text-[#3525cd] font-semibold'
                : 'text-[#464555] hover:text-[#3525cd] hover:bg-[#f2f4f6]'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">history</span>
            <span className="hidden sm:inline">Lịch sử</span>
          </button>

          {currentScreen !== 'upload' && (
            <button
              onClick={() => onNavigate('upload')}
              id="create-new-quiz-btn"
              className="px-3.5 py-1.5 text-xs sm:text-sm font-semibold bg-[#3525cd] hover:bg-[#291cb0] text-white rounded-lg shadow-sm hover:shadow transition-all flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              <span>Tạo đề mới</span>
            </button>
          )}
        </div>
      </div>

      {/* Screen Navigator Strip */}
      <div className="bg-[#f2f4f6]/80 border-t border-[#e2e4e8]/60 overflow-x-auto no-scrollbar py-1.5 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex items-center gap-1 sm:gap-2 text-xs min-w-max">
          <span className="text-[11px] font-semibold text-[#777587] uppercase tracking-wider mr-1 flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">view_carousel</span>
            Màn hình:
          </span>
          {screensList.map((screen) => {
            const isActive = currentScreen === screen.id;
            return (
              <button
                key={screen.id}
                onClick={() => onNavigate(screen.id)}
                id={`nav-screen-${screen.id}`}
                className={`px-2.5 py-1 rounded-md transition-all font-medium flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-[#3525cd] text-white shadow-xs font-semibold'
                    : 'text-[#464555] hover:bg-white hover:text-[#191c1e] hover:shadow-2xs'
                }`}
                title={screen.label}
              >
                <span className="material-symbols-outlined text-[15px]">{screen.icon}</span>
                <span>{screen.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
};
