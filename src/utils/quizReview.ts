import { QuizAttempt, QuizSet } from '../types';

export function getIncorrectlyAnsweredQuestions(quizSet: QuizSet, attempt: QuizAttempt) {
  return quizSet.questions.filter(
    (question) =>
      attempt.answers[question.id] !== undefined &&
      attempt.answers[question.id] !== question.correctAnswer
  );
}

export function buildReviewQuizSet(quizSet: QuizSet, attempt: QuizAttempt): QuizSet {
  const questions = getIncorrectlyAnsweredQuestions(quizSet, attempt);

  return {
    ...quizSet,
    id: `review-${attempt.id}`,
    title: `Ôn tập và củng cố — ${quizSet.title}`,
    totalQuestions: questions.length,
    recommendedMinutes: Math.max(1, Math.ceil(questions.length * 1.5)),
    questions,
  };
}
