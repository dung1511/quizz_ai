import React from 'react';
import { ScreenId } from '../types';

interface FooterProps {
  onNavigate: (screen: ScreenId) => void;
  onStartWorkspace: () => void;
  onOpenSampleModal?: () => void;
}

export const Footer: React.FC<FooterProps> = ({
  onNavigate,
  onStartWorkspace,
  onOpenSampleModal,
}) => {
  return (
    <footer className="border-t border-slate-200/80 bg-white mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-md">
          <button
            type="button"
            onClick={() => {
              onNavigate('upload');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="inline-flex items-center gap-2.5 text-left group cursor-pointer"
          >
            <span className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#ff4d6d] via-[#ff8c42] to-[#4f46e5] flex items-center justify-center text-white shadow-xs group-hover:scale-105 transition-transform">
              <span className="material-symbols-outlined text-[18px]">search</span>
            </span>
            <span className="font-brand font-extrabold text-xl tracking-tight text-slate-900">
              quizz
              <span className="bg-gradient-to-r from-[#ff4d6d] via-[#ff8c42] to-[#4f46e5] bg-clip-text text-transparent">
                Ai
              </span>
            </span>
          </button>
          <p className="text-sm text-slate-500 leading-relaxed">
            Không gian học tập nhẹ nhàng, trực quan và đầy cảm hứng cho sinh viên, giảng viên và người tự học.
          </p>
        </div>

        <nav
          aria-label="Liên kết chân trang"
          className="flex flex-wrap items-center gap-x-7 gap-y-3 text-sm font-medium text-slate-600"
        >
          <button
            type="button"
            onClick={() => {
              onNavigate('upload');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="hover:text-[#4f46e5] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Trang chủ
          </button>
          <button
            type="button"
            onClick={onStartWorkspace}
            className="hover:text-[#ff4d6d] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Tạo đề thi
          </button>
          <button
            type="button"
            onClick={() => onNavigate('quiz-detail')}
            className="hover:text-[#00b894] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Bộ câu hỏi
          </button>
          <button
            type="button"
            onClick={() => onNavigate('library-history')}
            className="hover:text-[#4f46e5] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Kho tài liệu
          </button>
          {onOpenSampleModal && (
            <button
              type="button"
              onClick={onOpenSampleModal}
              className="hover:text-[#ff8c42] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Tài liệu mẫu
            </button>
          )}
        </nav>
      </div>

      <div className="border-t border-slate-100 bg-slate-50/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>© 2026 quizzAi. Thiết kế ưu tiên trải nghiệm học tập tiếng Việt.</span>
          <span>Trực quan · Mềm mại · Dễ sử dụng</span>
        </div>
      </div>
    </footer>
  );
};
