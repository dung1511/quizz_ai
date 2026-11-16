import React, { useEffect, useRef, useState } from 'react';
import { QuestionIllustration } from '../types';
import { getMathIllustrationFallback } from '../utils/mathIllustrations';
import { sanitizeTikzCode } from '../utils/tikzValidation';

interface TikzPreviewProps {
  illustration?: QuestionIllustration;
  questionText?: string;
}

interface TikzPreviewResponse {
  svg?: unknown;
  error?: unknown;
}

const previewCache = new Map<string, string>();

function getIllustration(
  illustration: QuestionIllustration | undefined,
  questionText: string | undefined
): QuestionIllustration | undefined {
  return illustration?.needsImage || !questionText
    ? illustration
    : getMathIllustrationFallback(questionText);
}

export const TikzPreview: React.FC<TikzPreviewProps> = ({
  illustration: sourceIllustration,
  questionText,
}) => {
  const illustration = getIllustration(sourceIllustration, questionText);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const code = illustration?.needsImage ? sanitizeTikzCode(illustration.tikzCode) : undefined;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!('IntersectionObserver' in window)) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' }
    );
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!illustration?.needsImage || !code || !isVisible) return;

    let cancelled = false;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    setIsLoading(true);
    setPreviewUrl(undefined);
    setErrorMessage(undefined);

    const setPreview = (svg: string) => {
      objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      setPreviewUrl(objectUrl);
    };

    const cachedSvg = previewCache.get(code);
    const renderPreview = async () => {
      try {
        if (cachedSvg) {
          if (!cancelled) setPreview(cachedSvg);
          return;
        }

        const response = await fetch('/api/questions/tikz-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tikzCode: code }),
          signal: controller.signal,
        });
        const result = (await response.json()) as TikzPreviewResponse;

        if (!response.ok) {
          throw new Error(
            typeof result.error === 'string' ? result.error : 'Không thể dựng hình TikZ.'
          );
        }
        if (typeof result.svg !== 'string' || !result.svg.includes('<svg')) {
          throw new Error('Dữ liệu xem trước hình không hợp lệ.');
        }

        previewCache.set(code, result.svg);
        if (!cancelled) setPreview(result.svg);
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === 'AbortError')) return;
        setErrorMessage(error instanceof Error ? error.message : 'Không thể dựng hình TikZ.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    const renderTimeout = window.setTimeout(() => {
      renderPreview();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(renderTimeout);
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [code, illustration?.needsImage, isVisible]);

  if (!illustration?.needsImage) return null;

  const caption = illustration.caption || illustration.imagePrompt || 'Hình minh họa';

  return (
    <div
      ref={containerRef}
      className="my-3 rounded-xl border border-slate-200 bg-white p-3 text-center"
    >
      {code && previewUrl ? (
        <img src={previewUrl} alt={caption} className="mx-auto max-h-80 max-w-full object-contain" />
      ) : isLoading ? (
        <p className="text-xs text-slate-500">Đang dựng hình toán học...</p>
      ) : errorMessage ? (
        <p role="alert" className="text-xs text-amber-800">
          {errorMessage} Có thể xuất đề LaTeX và biên dịch bằng XeLaTeX.
        </p>
      ) : illustration.tikzCode && !code ? (
        <p role="alert" className="text-xs text-red-700">
          Mã TikZ không hợp lệ; không thể hiển thị hình.
        </p>
      ) : (
        <p className="text-xs text-slate-500">Hình chưa có mã TikZ để dựng.</p>
      )}
      {caption && <p className="mt-2 text-xs text-slate-500">{caption}</p>}
    </div>
  );
};
