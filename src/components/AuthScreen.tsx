import React, { useState } from 'react';
import { AccountUser } from '../types';
import { loginAccountApi, registerAccountApi } from '../services/api';

interface AuthScreenProps {
  onAuthenticated: (user: AccountUser) => Promise<void>;
  initialError?: string | null;
  onRetrySession?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onAuthenticated,
  initialError,
  onRetrySession,
}) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const user = isRegistering
        ? await registerAccountApi(email, password, displayName)
        : await loginAccountApi(email, password);
      await onAuthenticated(user);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Không thể xác thực tài khoản lúc này.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen w-full bg-gradient-to-br from-emerald-50 via-[#fafbfd] to-pink-50 px-4 py-10 flex items-center justify-center">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 sm:p-9 shadow-xl shadow-emerald-900/5">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-pink-500 to-emerald-600 text-white shadow-sm">
            <span className="material-symbols-outlined">school</span>
          </div>
          <h1 className="font-display text-2xl font-extrabold text-slate-900">
            {isRegistering ? 'Tạo tài khoản QuizAI' : 'Đăng nhập QuizAI'}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Lịch sử làm bài và ôn tập được lưu riêng cho tài khoản của bạn.
          </p>
        </div>

        {(errorMessage || initialError) && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
          >
            <p>{errorMessage || initialError}</p>
            {initialError && onRetrySession && (
              <button
                type="button"
                onClick={onRetrySession}
                className="mt-2 font-bold underline"
              >
                Thử kiểm tra lại
              </button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegistering && (
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-slate-700">Tên hiển thị</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={191}
                autoComplete="name"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                placeholder="Tên của bạn"
              />
            </label>
          )}

          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-slate-700">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              placeholder="ban@example.com"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-slate-700">Mật khẩu</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              maxLength={128}
              autoComplete={isRegistering ? 'new-password' : 'current-password'}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              placeholder={isRegistering ? 'Ít nhất 8 ký tự' : 'Nhập mật khẩu'}
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-[#15803d] px-4 py-3 text-sm font-bold text-white shadow-md shadow-emerald-700/20 transition hover:bg-[#166534] disabled:cursor-wait disabled:opacity-60"
          >
            {isSubmitting
              ? 'Đang xử lý...'
              : isRegistering
              ? 'Tạo tài khoản'
              : 'Đăng nhập'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          {isRegistering ? 'Đã có tài khoản?' : 'Chưa có tài khoản?'}{' '}
          <button
            type="button"
            onClick={() => {
              setIsRegistering((value) => !value);
              setErrorMessage(null);
            }}
            className="font-bold text-emerald-700 hover:text-emerald-900"
          >
            {isRegistering ? 'Đăng nhập' : 'Đăng ký'}
          </button>
        </p>
      </div>
    </main>
  );
};
