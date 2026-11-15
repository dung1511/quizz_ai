import examTemplate from '../templates/exam-template.tex?raw';
import { ExamPaperConfig, Question, QuizSet } from '../types';
import { isSafeMathExpression, sanitizeTikzCode } from './tikzValidation';

function escapePlainLatexText(value: string): string {
  return value
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([{}$%&#_])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}');
}

export function escapeLatexText(value: string): string {
  const segments = value.split(/(\$\$[\s\S]*?\$\$|\$(?:\\.|[^$])+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g);

  return segments
    .map((segment) => {
      const isMath = segment.startsWith('$') || segment.startsWith('\\(') || segment.startsWith('\\[');
      if (!isMath) return escapePlainLatexText(segment);

      const expression = segment.startsWith('$$')
        ? segment.slice(2, -2)
        : segment.startsWith('$')
          ? segment.slice(1, -1)
          : segment.slice(2, -2);
      return isSafeMathExpression(expression) ? segment : escapePlainLatexText(segment);
    })
    .join('');
}

function renderQuestion(question: Question, index: number): string {
  const choices = question.options
    .map((option) => `  \\item ${escapeLatexText(option.text)}`)
    .join('\n');
  const tikzCode = question.illustration?.needsImage
    ? sanitizeTikzCode(question.illustration.tikzCode)
    : undefined;
  const illustration = question.illustration?.needsImage
    ? tikzCode
      ? `\n\\begin{center}\n\\begin{tikzpicture}[scale=0.9,transform shape]\n${tikzCode}\n\\end{tikzpicture}\n\\end{center}`
      : `\n\\begin{quote}\\textit{Hình minh họa chưa có mã TikZ: ${escapeLatexText(
          question.illustration.caption || question.illustration.imagePrompt || 'chưa có mô tả'
        )}.}\\end{quote}`
    : '';

  return `\\Needspace{6\\baselineskip}
\\textbf{Câu ${index + 1}.} ${escapeLatexText(question.questionText)}\\par
\\begin{enumerate}[label=\\Alph*.]
${choices}
\\end{enumerate}${illustration}
\\vspace{0.6em}`;
}

function renderAppendix(quizSet: QuizSet, config: ExamPaperConfig): string {
  const parts: string[] = [];
  const includeAnswers = [
    'exam_with_answers',
    'exam_with_explanations',
    'full_with_source',
  ].includes(config.exportMode);

  if (config.exportMode === 'exam_with_bubble') {
    parts.push(
      `\\clearpage
\\section*{Phiếu trả lời trắc nghiệm}
\\begin{enumerate}[label=\\arabic*.]
${quizSet.questions
  .map(() => '  \\item $\\bigcirc$ A \\quad $\\bigcirc$ B \\quad $\\bigcirc$ C \\quad $\\bigcirc$ D')
  .join('\n')}
\\end{enumerate}`
    );
  }

  if (includeAnswers) {
    parts.push(
      `\\clearpage
\\section*{Bảng đáp án}
\\begin{enumerate}[label=\\arabic*.]
${quizSet.questions
  .map((question) => `  \\item ${escapeLatexText(question.correctAnswer)}`)
  .join('\n')}
\\end{enumerate}`
    );
  }

  if (config.exportMode === 'exam_with_explanations' || config.exportMode === 'full_with_source') {
    parts.push(
      `\\section*{Lời giải}
\\begin{enumerate}[label=\\arabic*.]
${quizSet.questions
  .map(
    (question) =>
      `  \\item \\textbf{Đáp án ${escapeLatexText(question.correctAnswer)}.} ${escapeLatexText(
        question.explanation
      )}`
  )
  .join('\n')}
\\end{enumerate}`
    );
  }

  if (config.exportMode === 'full_with_source') {
    parts.push(
      `\\clearpage
\\section*{Nguồn câu hỏi và căn cứ sư phạm}
\\begin{enumerate}[label=\\arabic*.]
${quizSet.questions
  .map(
    (question) =>
      `  \\item \\textbf{${escapeLatexText(question.source.knowledgeUnit)}} (${escapeLatexText(
        question.source.chapter
      )}, ${escapeLatexText(question.source.section)}). ${escapeLatexText(
        question.source.generationReason
      )}\\begin{quote}${escapeLatexText(question.source.sourceText)}\\end{quote}`
  )
  .join('\n')}
\\end{enumerate}`
    );
  }

  return parts.join('\n\n');
}

export function buildExamLatex(quizSet: QuizSet, config: ExamPaperConfig): string {
  const [fontSize, lineHeight] =
    config.fontSize === 'sm' ? ['10pt', '12pt'] : config.fontSize === 'lg' ? ['14pt', '17pt'] : ['12pt', '14pt'];
  const questions = quizSet.questions.map(renderQuestion).join('\n\n');
  const questionContent =
    config.columns === 2 ? `\\begin{multicols}{2}\n${questions}\n\\end{multicols}` : questions;
  const header = `\\begin{center}
  {\\large\\textbf{${escapeLatexText(config.schoolName)}}}\\\\
  \\textbf{${escapeLatexText(config.facultyName)}}\\\\[0.6em]
  {\\Large\\textbf{${escapeLatexText(config.examName)}}}\\\\
  \\textbf{Môn thi: ${escapeLatexText(config.subjectName)}}\\\\
  Thời gian làm bài: ${Math.max(1, Math.round(config.durationMinutes))} phút \\quad Mã đề: ${escapeLatexText(config.examCode)}
\\end{center}
\\vspace{0.5em}
\\textbf{${escapeLatexText(config.candidateNamePlaceholder)}:} \\rule{6cm}{0.4pt}
\\hfill
\\textbf{${escapeLatexText(config.candidateIdPlaceholder)}:} \\rule{3cm}{0.4pt}
\\vspace{1em}`;

  return examTemplate
    .replace('%@@HEADER@@', header)
    .replace('\\fontsize{12pt}{14pt}\\selectfont', `\\fontsize{${fontSize}}{${lineHeight}}\\selectfont`)
    .replace('%@@QUESTIONS@@', questionContent)
    .replace('%@@APPENDIX@@', renderAppendix(quizSet, config));
}
