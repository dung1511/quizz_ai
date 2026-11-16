import assert from 'node:assert/strict';
import test from 'node:test';
import { Question, QuizAttempt, QuizSet } from '../src/types';
import { buildReviewQuizSet, scoreQuizAttempt } from './quizAttempts';
import { getIncorrectlyAnsweredQuestions } from '../src/utils/quizReview';

function makeQuestion(id: string): Question {
  return {
    id,
    questionNumber: Number(id.slice(-1)),
    questionText: `Question ${id}`,
    options: [
      { key: 'A', text: 'Correct' },
      { key: 'B', text: 'Wrong one' },
      { key: 'C', text: 'Wrong two' },
      { key: 'D', text: 'Wrong three' },
    ],
    correctAnswer: 'A',
    explanation: `Explanation ${id}`,
    difficulty: 'easy',
    topic: 'Basics',
    source: {
      documentId: 'document-1',
      documentName: 'lesson.pdf',
      chapter: 'Chapter 1',
      section: '1.1',
      page: 1,
      sourceChunkId: `chunk-${id}`,
      sourceText: `Source ${id}`,
      knowledgeUnit: 'Basics',
      generationReason: 'Test source mapping',
    },
    validation: {
      isValid: true,
      status: 'VALID',
      checks: {
        hasFourOptions: true,
        hasSingleCorrect: true,
        answerInSource: true,
        explanationMatchesSource: true,
        hasSourceMapping: true,
        hasReason: true,
        noDuplicateOptions: true,
      },
    },
  };
}

const quizSet: QuizSet = {
  id: 'quiz-1',
  title: 'Test quiz',
  documentName: 'lesson.pdf',
  createdAt: '2026-11-16T00:00:00.000Z',
  totalQuestions: 3,
  recommendedMinutes: 5,
  difficulty: 'easy',
  questionType: 'multiple_choice',
  quizStyle: 'standard',
  questions: [makeQuestion('q-1'), makeQuestion('q-2'), makeQuestion('q-3')],
};

function makeAttempt(answers: QuizAttempt['answers']): QuizAttempt {
  return {
    id: 'attempt-1',
    quizId: quizSet.id,
    quizTitle: quizSet.title,
    completedAt: '2026-11-16T00:00:00.000Z',
    timeSpentSeconds: 30,
    answers,
    flaggedQuestions: [],
    score: 10,
    percentage: 100,
    correctCount: 3,
    wrongCount: 0,
    unansweredCount: 0,
    totalQuestions: 3,
    categoryBreakdown: [],
    difficultyBreakdown: [],
  };
}

test('review set contains only answered-wrong questions from its source attempt', () => {
  const attempt = makeAttempt({ 'q-1': 'B', 'q-2': 'A' });
  const wrongQuestions = getIncorrectlyAnsweredQuestions(quizSet, attempt);
  const review = buildReviewQuizSet(quizSet, attempt);
  const secondAttempt = {
    ...attempt,
    id: 'attempt-2',
    answers: { 'q-2': 'D' as const },
  };
  const secondReview = buildReviewQuizSet(quizSet, secondAttempt);

  assert.deepEqual(wrongQuestions.map((question) => question.id), ['q-1']);
  assert.equal(review.id, `review-${attempt.id}`);
  assert.equal(review.totalQuestions, 1);
  assert.equal(review.questions[0], quizSet.questions[0]);
  assert.deepEqual(
    secondReview.questions.map((question) => question.id),
    ['q-2']
  );
});

test('creating a review set does not modify the original quiz', () => {
  const originalQuestions = [...quizSet.questions];
  const originalQuestionIds = quizSet.questions.map((question) => question.id);

  buildReviewQuizSet(quizSet, makeAttempt({ 'q-2': 'D' }));

  assert.deepEqual(quizSet.questions, originalQuestions);
  assert.deepEqual(
    quizSet.questions.map((question) => question.id),
    originalQuestionIds
  );
});

test('server scoring ignores submitted totals and counts unanswered separately', () => {
  const attempt = scoreQuizAttempt(
    makeAttempt({ 'q-1': 'A', 'q-2': 'C' }),
    quizSet
  );

  assert.equal(attempt.totalQuestions, 3);
  assert.equal(attempt.correctCount, 1);
  assert.equal(attempt.wrongCount, 1);
  assert.equal(attempt.unansweredCount, 1);
  assert.equal(attempt.score, 3.3);
  assert.equal(attempt.percentage, 33);
});
