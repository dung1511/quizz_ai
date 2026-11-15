import fs from 'fs';
import path from 'path';
import {
  KnowledgePackage,
  ParsedQuizRequest,
  QuizSet,
  WebResearchSource,
} from '../src/types';

export interface QuizAiDatabase {
  requests: Record<string, ParsedQuizRequest>;
  knowledgePackages: Record<string, KnowledgePackage>;
  webSources: Record<string, WebResearchSource>;
  quizzes: Record<string, QuizSet>;
}

const DATA_DIR = path.join(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'quizai-store.json');

let memoryCache: QuizAiDatabase | null = null;

function ensureStoreLoaded(): QuizAiDatabase {
  if (memoryCache) return memoryCache;

  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      memoryCache = {
        requests: parsed.requests || {},
        knowledgePackages: parsed.knowledgePackages || {},
        webSources: parsed.webSources || {},
        quizzes: parsed.quizzes || {},
      };
      return memoryCache;
    }
  } catch (err) {
    console.warn('[QuizAI][storage] Could not load persisted store, starting fresh:', err);
  }

  memoryCache = {
    requests: {},
    knowledgePackages: {},
    webSources: {},
    quizzes: {},
  };
  return memoryCache;
}

function persistStore(): void {
  const db = ensureStoreLoaded();
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DB_FILE);
  } catch (err) {
    console.error('[QuizAI][storage] Failed to persist store to disk:', err);
  }
}

export function saveAiRequest(req: ParsedQuizRequest): ParsedQuizRequest {
  const db = ensureStoreLoaded();
  db.requests[req.id] = req;
  persistStore();
  return req;
}

export function getAiRequest(id: string): ParsedQuizRequest | null {
  const db = ensureStoreLoaded();
  return db.requests[id] || null;
}

export function saveKnowledgePackage(pkg: KnowledgePackage): KnowledgePackage {
  const db = ensureStoreLoaded();
  db.requests[pkg.request.id] = pkg.request;
  db.knowledgePackages[pkg.id] = pkg;
  for (const src of pkg.webSources) {
    db.webSources[src.id] = src;
  }
  persistStore();
  return pkg;
}

export function getKnowledgePackage(id: string): KnowledgePackage | null {
  const db = ensureStoreLoaded();
  return db.knowledgePackages[id] || null;
}

export function saveQuizAndSources(
  quiz: QuizSet,
  knowledgePackage?: KnowledgePackage
): QuizSet {
  const db = ensureStoreLoaded();

  if (knowledgePackage) {
    db.requests[knowledgePackage.request.id] = knowledgePackage.request;
    db.knowledgePackages[knowledgePackage.id] = {
      ...knowledgePackage,
      status: 'CONFIRMED',
      updatedAt: new Date().toISOString(),
    };
    for (const src of knowledgePackage.webSources) {
      db.webSources[src.id] = src;
    }
  }

  db.quizzes[quiz.id] = quiz;
  persistStore();
  return quiz;
}

export function getQuizById(id: string): QuizSet | null {
  const db = ensureStoreLoaded();
  return db.quizzes[id] || null;
}

export function listQuizzes(): QuizSet[] {
  const db = ensureStoreLoaded();
  return Object.values(db.quizzes).sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || '')
  );
}

export function getQuizSources(quizId: string): {
  quizId: string;
  originType: string;
  contentOrigin: string;
  originNotice?: string;
  freshnessWarning?: string;
  webSources: WebResearchSource[];
  knowledgePackage: KnowledgePackage | null;
  questionMappings: {
    questionId: string;
    questionNumber: number;
    knowledgeUnit: string;
    chapter: string;
    section: string;
    sourceText: string;
    generationReason: string;
    webSourceUrl?: string;
    webSourceTitle?: string;
  }[];
} | null {
  const db = ensureStoreLoaded();
  const quiz = db.quizzes[quizId];
  if (!quiz) return null;

  const knowledgePackage = quiz.knowledgePackageId
    ? db.knowledgePackages[quiz.knowledgePackageId] || null
    : null;

  return {
    quizId: quiz.id,
    originType: quiz.originType || 'DOCUMENT',
    contentOrigin: quiz.contentOrigin || (knowledgePackage?.contentOrigin ?? 'AI_GENERATED'),
    originNotice: quiz.originNotice || knowledgePackage?.originNotice,
    freshnessWarning: quiz.freshnessWarning || knowledgePackage?.freshnessWarning,
    webSources: quiz.webSources || knowledgePackage?.webSources || [],
    knowledgePackage,
    questionMappings: quiz.questions.map((q) => ({
      questionId: q.id,
      questionNumber: q.questionNumber,
      knowledgeUnit: q.source.knowledgeUnit,
      chapter: q.source.chapter,
      section: q.source.section,
      sourceText: q.source.sourceText,
      generationReason: q.source.generationReason,
      webSourceUrl: q.source.webSourceUrl,
      webSourceTitle: q.source.webSourceTitle,
    })),
  };
}
