import { QuizAttempt, QuizSet } from '../src/types';
import { buildReviewQuizSet } from '../src/utils/quizReview';

const ANSWER_KEYS = new Set(['A', 'B', 'C', 'D']);

export class QuizAttemptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuizAttemptValidationError';
  }
}

export function scoreQuizAttempt(attempt: QuizAttempt, quizSet: QuizSet): QuizAttempt {
  if (!attempt.id || !quizSet.id || quizSet.questions.length === 0) {
    throw new QuizAttemptValidationError('Bài làm hoặc bộ câu hỏi không hợp lệ.');
  }
  if (attempt.quizId !== quizSet.id) {
    throw new QuizAttemptValidationError('Lượt làm bài không khớp với bộ câu hỏi.');
  }

  const questionIds = new Set(quizSet.questions.map((question) => question.id));
  const answers: QuizAttempt['answers'] = {};
  for (const [questionId, answer] of Object.entries(attempt.answers || {})) {
    if (!questionIds.has(questionId) || !ANSWER_KEYS.has(answer)) {
      throw new QuizAttemptValidationError('Câu trả lời chứa dữ liệu không hợp lệ.');
    }
    answers[questionId] = answer;
  }

  const categoryStats = new Map<string, { correct: number; total: number }>();
  const difficultyStats = new Map<'easy' | 'medium' | 'hard', { correct: number; total: number }>([
    ['easy', { correct: 0, total: 0 }],
    ['medium', { correct: 0, total: 0 }],
    ['hard', { correct: 0, total: 0 }],
  ]);
  let correctCount = 0;
  let wrongCount = 0;

  for (const question of quizSet.questions) {
    const category = question.topic || 'Kiến thức chung';
    const categoryStat = categoryStats.get(category) || { correct: 0, total: 0 };
    categoryStat.total += 1;

    const difficulty = question.difficulty || 'medium';
    const difficultyStat = difficultyStats.get(difficulty);
    if (!difficultyStat) {
      throw new QuizAttemptValidationError('Độ khó của câu hỏi không hợp lệ.');
    }
    difficultyStat.total += 1;

    const answer = answers[question.id];
    if (answer !== undefined) {
      if (answer === question.correctAnswer) {
        correctCount += 1;
        categoryStat.correct += 1;
        difficultyStat.correct += 1;
      } else {
        wrongCount += 1;
      }
    }

    categoryStats.set(category, categoryStat);
  }

  const totalQuestions = quizSet.questions.length;
  const percentage = Math.round((correctCount / totalQuestions) * 100);

  return {
    ...attempt,
    quizTitle: quizSet.title,
    completedAt: new Date().toISOString(),
    timeSpentSeconds: Math.max(0, Math.floor(Number(attempt.timeSpentSeconds) || 0)),
    answers,
    flaggedQuestions: (attempt.flaggedQuestions || []).filter((id) => questionIds.has(id)),
    score: Number(((correctCount / totalQuestions) * 10).toFixed(1)),
    percentage,
    correctCount,
    wrongCount,
    unansweredCount: totalQuestions - correctCount - wrongCount,
    totalQuestions,
    categoryBreakdown: [...categoryStats.entries()].map(([category, stat]) => ({
      category,
      correct: stat.correct,
      total: stat.total,
      accuracy: Math.round((stat.correct / stat.total) * 100),
    })),
    difficultyBreakdown: [...difficultyStats.entries()].map(([difficulty, stat]) => ({
      difficulty,
      label:
        difficulty === 'easy'
          ? 'Dễ (Nhận biết)'
          : difficulty === 'medium'
          ? 'Trung bình (Thông hiểu)'
          : 'Khó (Vận dụng)',
      correct: stat.correct,
      total: stat.total,
    })),
  };
}

export { buildReviewQuizSet };
