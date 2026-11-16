import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sanitizeTikzCode } from '../src/utils/tikzValidation';

export class TikzPreviewError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'TikzPreviewError';
  }
}

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
      (error) => {
        if (error) reject(error);
        else resolve();
      }
    );
  });
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

async function runPreviewCommand(
  command: string,
  args: string[],
  cwd: string,
  phase: 'compile' | 'convert'
): Promise<void> {
  try {
    await runCommand(command, args, cwd);
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      throw new TikzPreviewError(
        'Không tìm thấy XeLaTeX hoặc pdftocairo trên máy chủ.',
        503
      );
    }

    if (getErrorCode(error) === 'ETIMEDOUT' || getErrorCode(error) === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new TikzPreviewError('Dựng hình quá thời gian cho phép.', 422);
    }

    throw new TikzPreviewError(
      phase === 'compile' ? 'Mã TikZ không biên dịch được.' : 'Không thể chuyển hình sang SVG.',
      422
    );
  }
}

export async function renderTikzPreview(tikzCode: string): Promise<string> {
  const safeCode = sanitizeTikzCode(tikzCode);
  if (!safeCode) {
    throw new TikzPreviewError('Mã TikZ không hợp lệ hoặc có lệnh không được hỗ trợ.', 400);
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), 'quiz-tikz-'));

  try {
    const texPath = path.join(directory, 'preview.tex');
    const pdfPath = path.join(directory, 'preview.pdf');
    const svgPrefix = path.join(directory, 'preview');
    const texSource = String.raw`\documentclass[12pt]{article}
\usepackage{fontspec}
\usepackage{amsmath,amssymb,tikz,pgfplots}
\pgfplotsset{compat=1.18}
\usetikzlibrary{arrows.meta,calc,intersections,positioning,angles,quotes}
\usepackage[active,tightpage]{preview}
\PreviewEnvironment{tikzpicture}
\pagestyle{empty}
\begin{document}
\begin{tikzpicture}[scale=0.9,transform shape]
${safeCode}
\end{tikzpicture}
\end{document}`;

    await writeFile(texPath, texSource, 'utf8');
    await runPreviewCommand(
      process.env.XELATEX_PATH || 'xelatex',
      ['-no-shell-escape', '-interaction=batchmode', '-halt-on-error', `-output-directory=${directory}`, texPath],
      directory,
      'compile'
    );
    await runPreviewCommand(
      process.env.PDFTOCAIRO_PATH || 'pdftocairo',
      ['-svg', '-f', '1', '-l', '1', pdfPath, svgPrefix],
      directory,
      'convert'
    );

    let svg: string;
    try {
      svg = await readFile(svgPrefix, 'utf8');
    } catch (error) {
      if (getErrorCode(error) === 'ENOENT') {
        throw new TikzPreviewError('Không tạo được bản xem trước SVG.', 422);
      }
      throw error;
    }

    if (!svg.includes('<svg')) {
      throw new TikzPreviewError('Dữ liệu xem trước SVG không hợp lệ.', 422);
    }
    return svg;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
