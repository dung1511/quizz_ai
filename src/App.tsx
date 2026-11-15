import React, { useState, useEffect } from 'react';
import {
  ScreenId,
  QuizSet,
  QuizAttempt,
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
import { listSavedQuizzesApi } from './services/api';
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
  const [allAttempts, setAllAttempts] = useState<QuizAttempt[]>([INITIAL_QUIZ_ATTEMPT]);
  const [allDocuments, setAllDocuments] = useState<(SampleDocument | DocumentSource)[]>(SAMPLE_DOCUMENTS);
  const [isSampleModalOpen, setIsSampleModalOpen] = useState<boolean>(false);

  useEffect(() => {
    listSavedQuizzesApi().then((saved) => {
      if (saved.length > 0) {
        setAllQuizzes((prev) => {
          const existingIds = new Set(prev.map((q) => q.id));
          const uniqueSaved = saved.filter((q) => !existingIds.has(q.id));
          return [...uniqueSaved, ...prev];
        });
      }
    });
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
    setCurrentScreen('generating');
  };

  // Handler: Complete AI generation with generated QuizSet
  const handleGenerationComplete = (generatedQuizSet: QuizSet) => {
    setActiveQuizSet(generatedQuizSet);
    setAllQuizzes((prev) => [generatedQuizSet, ...prev]);
    setCurrentScreen('quiz-detail');
  };

  // Handler: Submit Quiz Attempt
  const handleSubmitQuiz = (attempt: QuizAttempt) => {
    setActiveAttempt(attempt);
    setAllAttempts((prev) => [attempt, ...prev]);
    setCurrentScreen('quiz-result');
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

  return (
    <div className="min-h-screen bg-[#fafbfd] text-slate-900 flex flex-col font-sans selection:bg-[#ff4d6d]/15 selection:text-[#3525cd]">
      {/* Top Header with Brand and Simple Menu */}
      <Header
        currentScreen={currentScreen}
        onNavigate={(screen) => setCurrentScreen(screen)}
        quizTitle={activeQuizSet.title}
        hasActiveQuiz={!!activeQuizSet}
        onOpenSampleModal={() => setIsSampleModalOpen(true)}
        onStartWorkspace={handleStartWorkspace}
      />

      {/* Main View Router */}
      <main className="flex-1">
        {currentScreen === 'upload' && (
          <UploadScreen
            onStartGenerate={handleStartGenerate}
            onSelectRecentQuiz={(quiz) => {
              setActiveQuizSet(quiz);
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
            onStartQuiz={() => setCurrentScreen('quiz-taking')}
            onEditQuestions={() => setCurrentScreen('quiz-edit')}
            onBackToUpload={() => setCurrentScreen('upload')}
          />
        )}

        {currentScreen === 'quiz-taking' && (
          <QuizTakingScreen
            quizSet={activeQuizSet}
            onSubmitQuiz={handleSubmitQuiz}
            onExitQuiz={() => setCurrentScreen('quiz-detail')}
          />
        )}

        {currentScreen === 'quiz-result' && (
          <QuizResultScreen
            attempt={activeAttempt}
            quizSet={activeQuizSet}
            onViewDetailedReview={() => setCurrentScreen('quiz-review')}
            onRetakeQuiz={() => setCurrentScreen('quiz-taking')}
            onBackToHome={() => setCurrentScreen('upload')}
          />
        )}

        {currentScreen === 'quiz-review' && (
          <QuizReviewScreen
            attempt={activeAttempt}
            quizSet={activeQuizSet}
            onBackToResult={() => setCurrentScreen('quiz-result')}
            onRetakeQuiz={() => setCurrentScreen('quiz-taking')}
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
            quizList={allQuizzes}
            attemptsHistory={allAttempts}
            onSelectQuiz={(quiz) => {
              setActiveQuizSet(quiz);
              setCurrentScreen('quiz-detail');
            }}
            onSelectAttempt={(attempt) => {
              setActiveAttempt(attempt);
              const foundQuiz = allQuizzes.find((q) => q.id === attempt.quizId) || activeQuizSet;
              setActiveQuizSet(foundQuiz);
              setCurrentScreen('quiz-result');
            }}
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
