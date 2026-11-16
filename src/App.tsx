import React, { useState, useEffect } from 'react';
import {
  ScreenId,
  QuizSet,
  QuizAttempt,
  QuizAttemptRecord,
  AccountUser,
  DifficultyLevel,
  QuestionType,
  QuizStyle,
  SampleDocument,
  DocumentSource,
} from './types';
import {
  INITIAL_QUIZ_SET,
  INITIAL_QUIZ_ATTEMPT,
  RECENT_QUIZZES_LIST,
  SAMPLE_DOCUMENTS,
} from './data/sampleData';
import {
  getCurrentUserApi,
  listQuizAttemptRecordsApi,
  listSavedQuizzesApi,
  logoutAccountApi,
  saveQuizAttemptApi,
} from './services/api';
import { buildReviewQuizSet } from './utils/quizReview';
import { AuthScreen } from './components/AuthScreen';
import { Header } from './components/Header';
import { UploadScreen } from './components/UploadScreen';
import { GeneratingScreen } from './components/GeneratingScreen';
import { QuizDetailScreen } from './components/QuizDetailScreen';
import { QuizTakingScreen } from './components/QuizTakingScreen';
import { QuizResultScreen } from './components/QuizResultScreen';
import { QuizReviewScreen } from './components/QuizReviewScreen';
import { QuizEditScreen } from './components/QuizEditScreen';
import { LibraryHistoryScreen } from './components/LibraryHistoryScreen';
import { SampleModal } from './components/SampleModal';
import { Footer } from './components/Footer';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenId>('upload');
  const [activeQuizSet, setActiveQuizSet] = useState<QuizSet>(INITIAL_QUIZ_SET);
  const [activeAttempt, setActiveAttempt] = useState<QuizAttempt>(INITIAL_QUIZ_ATTEMPT);
  const [allQuizzes, setAllQuizzes] = useState<QuizSet[]>(RECENT_QUIZZES_LIST);
  const [allAttempts, setAllAttempts] = useState<QuizAttemptRecord[]>([]);
  const [allDocuments, setAllDocuments] = useState<(SampleDocument | DocumentSource)[]>(SAMPLE_DOCUMENTS);
  const [isSampleModalOpen, setIsSampleModalOpen] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<AccountUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [accountDataError, setAccountDataError] = useState<string | null>(null);
  const [attemptSaveError, setAttemptSaveError] = useState<string | null>(null);
  const [unsavedAttempt, setUnsavedAttempt] = useState<{
    attempt: QuizAttempt;
    quizSet: QuizSet;
    attemptType: 'quiz' | 'review';
    sourceAttemptId?: string;
  } | null>(null);
  const [activeAttemptType, setActiveAttemptType] = useState<'quiz' | 'review'>('quiz');
  const [reviewSourceAttemptId, setReviewSourceAttemptId] = useState<string>();
  const [libraryInitialTab, setLibraryInitialTab] = useState<
    'documents' | 'quizzes' | 'history'
  >('documents');

  const loadAccountData = async () => {
    const [records, savedQuizzes] = await Promise.all([
      listQuizAttemptRecordsApi(),
      listSavedQuizzesApi(),
    ]);
    setAllAttempts(records);

    const quizzesById = new Map<string, QuizSet>();
    for (const quiz of RECENT_QUIZZES_LIST) quizzesById.set(quiz.id, quiz);
    for (const quiz of savedQuizzes) quizzesById.set(quiz.id, quiz);
    for (const record of records) {
      if (record.attemptType === 'quiz') quizzesById.set(record.quizSet.id, record.quizSet);
    }
    setAllQuizzes([...quizzesById.values()]);
    setAccountDataError(null);
  };

  const checkCurrentSession = async () => {
    setAuthLoading(true);
    setAuthError(null);
    setAccountDataError(null);
    try {
      const user = await getCurrentUserApi();
      setCurrentUser(user);
      if (user) {
        try {
          await loadAccountData();
        } catch (error) {
          setAccountDataError(
            error instanceof Error ? error.message : 'Không thể tải dữ liệu tài khoản.'
          );
        }
      } else {
        setAllAttempts([]);
      }
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : 'Không thể xác minh phiên đăng nhập.'
      );
    } finally {
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    void checkCurrentSession();
  }, []);

  // Generation parameters state
  const [generationConfig, setGenerationConfig] = useState<{
    content: string;
    documentTitle: string;
    numQuestions: number;
    difficulty: DifficultyLevel;
    questionType: QuestionType;
    quizStyle: QuizStyle;
    scopeChapterId?: string;
    strictSourceOnly: boolean;
  }>({
    content: SAMPLE_DOCUMENTS[0].content,
    documentTitle: SAMPLE_DOCUMENTS[0].fileName,
    numQuestions: 10,
    difficulty: 'medium',
    questionType: 'multiple_choice',
    quizStyle: 'standard',
    strictSourceOnly: true,
  });

  // Handler: Start generation from Upload screen
  const handleStartGenerate = (config: {
    content: string;
    documentTitle: string;
    numQuestions: number;
    difficulty: DifficultyLevel;
    questionType: QuestionType;
    quizStyle: QuizStyle;
    scopeChapterId?: string;
    strictSourceOnly: boolean;
  }) => {
    setGenerationConfig(config);
    setActiveAttemptType('quiz');
    setReviewSourceAttemptId(undefined);
    setCurrentScreen('generating');
  };

  // Handler: Complete AI generation with generated QuizSet
  const handleGenerationComplete = (generatedQuizSet: QuizSet) => {
    setActiveQuizSet(generatedQuizSet);
    setActiveAttemptType('quiz');
    setReviewSourceAttemptId(undefined);
    setAllQuizzes((prev) => [generatedQuizSet, ...prev]);
    setCurrentScreen('quiz-detail');
  };

  const handleAuthenticated = async (user: AccountUser) => {
    setCurrentUser(user);
    try {
      await loadAccountData();
    } catch (error) {
      setAccountDataError(
        error instanceof Error ? error.message : 'Không thể tải dữ liệu tài khoản.'
      );
    }
  };

  const handleLogout = async () => {
    try {
      await logoutAccountApi();
      setCurrentUser(null);
      setAllAttempts([]);
      setAllQuizzes(RECENT_QUIZZES_LIST);
      setActiveQuizSet(INITIAL_QUIZ_SET);
      setActiveAttempt(INITIAL_QUIZ_ATTEMPT);
      setActiveAttemptType('quiz');
      setReviewSourceAttemptId(undefined);
      setUnsavedAttempt(null);
      setAttemptSaveError(null);
      setAccountDataError(null);
      setCurrentScreen('upload');
    } catch (error) {
      setAccountDataError(error instanceof Error ? error.message : 'Không thể đăng xuất.');
    }
  };

  const saveAttemptRecord = async (pending: {
    attempt: QuizAttempt;
    quizSet: QuizSet;
    attemptType: 'quiz' | 'review';
    sourceAttemptId?: string;
  }) => {
    const record = await saveQuizAttemptApi(pending);
    setActiveAttempt(record.attempt);
    setAllAttempts((previous) => [
      record,
      ...previous.filter((item) => item.attempt.id !== record.attempt.id),
    ]);
    if (record.attemptType === 'quiz') {
      setAllQuizzes((previous) => [
        record.quizSet,
        ...previous.filter((quiz) => quiz.id !== record.quizSet.id),
      ]);
    }
    setUnsavedAttempt(null);
    setAttemptSaveError(null);
  };

  const handleSubmitQuiz = async (attempt: QuizAttempt) => {
    setActiveAttempt(attempt);
    const pending = {
      attempt,
      quizSet: activeQuizSet,
      attemptType: activeAttemptType,
      sourceAttemptId: activeAttemptType === 'review' ? reviewSourceAttemptId : undefined,
    };
    try {
      await saveAttemptRecord(pending);
    } catch (error) {
      setUnsavedAttempt(pending);
      setAttemptSaveError(
        error instanceof Error ? error.message : 'Không thể lưu kết quả làm bài.'
      );
    }
    setCurrentScreen('quiz-result');
  };

  const handleRetrySavingAttempt = async () => {
    if (!unsavedAttempt) return;
    try {
      await saveAttemptRecord(unsavedAttempt);
    } catch (error) {
      setAttemptSaveError(
        error instanceof Error ? error.message : 'Không thể lưu kết quả làm bài.'
      );
    }
  };

  const handleStartReview = (record: QuizAttemptRecord) => {
    const reviewQuiz = buildReviewQuizSet(record.quizSet, record.attempt);
    if (reviewQuiz.questions.length === 0) return;
    setActiveQuizSet(reviewQuiz);
    setActiveAttemptType('review');
    setReviewSourceAttemptId(record.attempt.id);
    setAttemptSaveError(null);
    setCurrentScreen('quiz-taking');
  };

  const handleBackToHistory = () => {
    setLibraryInitialTab('history');
    setCurrentScreen('library-history');
  };

  // Handler: Save edits to questions
  const handleSaveQuizEdits = (updatedQuiz: QuizSet) => {
    setActiveQuizSet(updatedQuiz);
    setAllQuizzes((prev) =>
      prev.map((q) => (q.id === updatedQuiz.id ? updatedQuiz : q))
    );
    setCurrentScreen('quiz-detail');
  };

  // Handler: Register newly uploaded/parsed document
  const handleRegisterDocument = (doc: DocumentSource | SampleDocument) => {
    setAllDocuments((prev) => {
      const exists = prev.some((d) => d.id === doc.id || d.fileName === doc.fileName);
      if (exists) {
        return prev.map((d) => (d.id === doc.id || d.fileName === doc.fileName ? doc : d));
      }
      return [doc, ...prev];
    });
  };

  // Handler: Delete document from library
  const handleDeleteDocument = (id: string) => {
    setAllDocuments((prev) => prev.filter((d) => d.id !== id));
  };

  // Handler: Select a document from library to build a quiz
  const handleSelectDocumentForQuiz = (doc: SampleDocument | DocumentSource) => {
    const content = 'rawText' in doc ? doc.rawText : doc.content || '';
    setGenerationConfig({
      ...generationConfig,
      content,
      documentTitle: doc.fileName,
      scopeChapterId: undefined,
    });
    setCurrentScreen('upload');
  };

  const handleStartWorkspace = () => {
    setCurrentScreen('upload');
    setTimeout(() => {
      const el = document.getElementById('tao-de-workspace');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 60);
  };

  if (authLoading) {
    return (
      <main className="min-h-screen w-full bg-[#fafbfd] flex items-center justify-center">
        <p className="text-sm font-semibold text-slate-600">Đang kiểm tra phiên đăng nhập...</p>
      </main>
    );
  }

  if (!currentUser) {
    return (
      <AuthScreen
        onAuthenticated={handleAuthenticated}
        initialError={authError}
        onRetrySession={() => void checkCurrentSession()}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#fafbfd] text-slate-900 flex flex-col font-sans selection:bg-pink-100 selection:text-green-800">
      {/* Top Header with Brand and Simple Menu */}
      <Header
        currentScreen={currentScreen}
        onNavigate={(screen) => {
          if (screen === 'library-history') setLibraryInitialTab('documents');
          setCurrentScreen(screen);
        }}
        quizTitle={activeQuizSet.title}
        hasActiveQuiz={!!activeQuizSet}
        onStartWorkspace={handleStartWorkspace}
        currentUser={currentUser}
        onLogout={() => void handleLogout()}
      />

      {accountDataError && (
        <div role="alert" className="bg-rose-50 px-4 py-2 text-center text-sm text-rose-800">
          {accountDataError}
        </div>
      )}

      {/* Main View Router */}
      <main className="flex-1 w-full">
        {currentScreen === 'upload' && (
          <UploadScreen
            onStartGenerate={handleStartGenerate}
            onSelectRecentQuiz={(quiz) => {
              setActiveQuizSet(quiz);
              setActiveAttemptType('quiz');
              setReviewSourceAttemptId(undefined);
              setCurrentScreen('quiz-detail');
            }}
            onRegisterDocument={handleRegisterDocument}
            onQuizCreated={(quiz) => {
              handleGenerationComplete(quiz);
              if (quiz.compiledKnowledgeText && quiz.chapters) {
                handleRegisterDocument({
                  id: quiz.documentId || `doc-ai-${quiz.id}`,
                  title: quiz.title,
                  fileName: quiz.documentName,
                  fileType: 'txt',
                  fileSize: `${Math.max(1, Math.round(quiz.compiledKnowledgeText.length / 1024))} KB`,
                  pageCount: quiz.chapters.length || 1,
                  status: 'READY',
                  rawText: quiz.compiledKnowledgeText,
                  chapters: quiz.chapters,
                  chunks: [],
                  knowledgeUnits: quiz.knowledgeUnits || [],
                });
              }
            }}
          />
        )}

        {currentScreen === 'generating' && (
          <GeneratingScreen
            documentTitle={generationConfig.documentTitle}
            documentContent={generationConfig.content}
            numQuestions={generationConfig.numQuestions}
            difficulty={generationConfig.difficulty}
            questionType={generationConfig.questionType}
            quizStyle={generationConfig.quizStyle}
            scopeChapterId={generationConfig.scopeChapterId}
            strictSourceOnly={generationConfig.strictSourceOnly}
            onComplete={handleGenerationComplete}
            onCancel={() => setCurrentScreen('upload')}
          />
        )}

        {currentScreen === 'quiz-detail' && (
          <QuizDetailScreen
            quizSet={activeQuizSet}
            onStartQuiz={() => {
              setActiveAttemptType('quiz');
              setReviewSourceAttemptId(undefined);
              setCurrentScreen('quiz-taking');
            }}
            onEditQuestions={() => setCurrentScreen('quiz-edit')}
            onBackToUpload={() => setCurrentScreen('upload')}
          />
        )}

        {currentScreen === 'quiz-taking' && (
          <QuizTakingScreen
            quizSet={activeQuizSet}
            onSubmitQuiz={handleSubmitQuiz}
            onExitQuiz={() =>
              activeAttemptType === 'review'
                ? handleBackToHistory()
                : setCurrentScreen('quiz-detail')
            }
            attemptType={activeAttemptType}
          />
        )}

        {currentScreen === 'quiz-result' && (
          <QuizResultScreen
            attempt={activeAttempt}
            quizSet={activeQuizSet}
            onViewDetailedReview={() => setCurrentScreen('quiz-review')}
            onRetakeQuiz={() => setCurrentScreen('quiz-taking')}
            onBackToHome={() =>
              activeAttemptType === 'review' ? handleBackToHistory() : setCurrentScreen('upload')
            }
            isReviewMode={activeAttemptType === 'review'}
            saveError={attemptSaveError}
            onRetrySave={unsavedAttempt ? handleRetrySavingAttempt : undefined}
          />
        )}

        {currentScreen === 'quiz-review' && (
          <QuizReviewScreen
            attempt={activeAttempt}
            quizSet={activeQuizSet}
            onBackToResult={() => setCurrentScreen('quiz-result')}
            onRetakeQuiz={() => setCurrentScreen('quiz-taking')}
            isReviewMode={activeAttemptType === 'review'}
          />
        )}

        {currentScreen === 'quiz-edit' && (
          <QuizEditScreen
            quizSet={activeQuizSet}
            onSaveQuiz={handleSaveQuizEdits}
            onCancel={() => setCurrentScreen('quiz-detail')}
          />
        )}

        {currentScreen === 'library-history' && (
          <LibraryHistoryScreen
            documents={allDocuments}
            initialTab={libraryInitialTab}
            quizList={allQuizzes}
            attemptsHistory={allAttempts}
            onSelectQuiz={(quiz) => {
              setActiveQuizSet(quiz);
              setActiveAttemptType('quiz');
              setReviewSourceAttemptId(undefined);
              setCurrentScreen('quiz-detail');
            }}
            onSelectAttempt={(record) => {
              setActiveAttempt(record.attempt);
              setActiveQuizSet(record.quizSet);
              setActiveAttemptType(record.attemptType);
              setReviewSourceAttemptId(record.sourceAttemptId);
              setAttemptSaveError(null);
              setCurrentScreen('quiz-result');
            }}
            onStartReview={handleStartReview}
            onCreateNew={() => setCurrentScreen('upload')}
            onDeleteDocument={handleDeleteDocument}
            onSelectDocumentForQuiz={handleSelectDocumentForQuiz}
          />
        )}
      </main>

      {/* Clean Footer */}
      <Footer
        onNavigate={(screen) => setCurrentScreen(screen)}
        onStartWorkspace={handleStartWorkspace}
        onOpenSampleModal={() => setIsSampleModalOpen(true)}
      />

      {/* Sample Modal for Testing */}
      <SampleModal
        isOpen={isSampleModalOpen}
        onClose={() => setIsSampleModalOpen(false)}
        onSelectDocument={(doc) => {
          setGenerationConfig({
            ...generationConfig,
            content: doc.content,
            documentTitle: doc.fileName,
          });
          setCurrentScreen('upload');
        }}
        onSelectQuiz={(quiz) => {
          setActiveQuizSet(quiz);
          setCurrentScreen('quiz-detail');
        }}
      />
    </div>
  );
}
