import { createConnection, createPool, Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  KnowledgePackage,
  ParsedQuizRequest,
  QuizSet,
  WebResearchSource,
} from '../src/types';
import { withKnowledgeReviewStatus } from './aiText/knowledgeValidation';

const LEGACY_DB_FILE = path.join(process.cwd(), '.data', 'quizai-store.json');
const LEGACY_MIGRATION_KEY = 'legacy_json_store_imported';

interface LegacyStore {
  requests?: Record<string, ParsedQuizRequest>;
  knowledgePackages?: Record<string, KnowledgePackage>;
  webSources?: Record<string, WebResearchSource>;
  quizzes?: Record<string, QuizSet>;
}

interface PayloadRow extends RowDataPacket {
  payload: string;
}

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    throw new Error('QuizAI MySQL storage has not been initialized.');
  }
  return pool;
}

function quoteDatabaseName(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error('MYSQL_DATABASE must contain only letters, numbers, and underscores.');
  }
  return `\`${name}\``;
}

async function storeRequest(connection: PoolConnection, request: ParsedQuizRequest): Promise<void> {
  await connection.execute(
    `INSERT INTO quizai_requests (id, payload, created_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
    [request.id, JSON.stringify(request), request.createdAt]
  );
}

async function storeKnowledgePackage(
  connection: PoolConnection,
  pkg: KnowledgePackage
): Promise<void> {
  await storeRequest(connection, pkg.request);
  await connection.execute(
    `INSERT INTO quizai_knowledge_packages (id, request_id, payload, updated_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       request_id = VALUES(request_id),
       payload = VALUES(payload),
       updated_at = VALUES(updated_at)`,
    [pkg.id, pkg.request.id, JSON.stringify(pkg), pkg.updatedAt]
  );

  await connection.execute('DELETE FROM quizai_web_sources WHERE package_id = ?', [pkg.id]);
  for (const source of pkg.webSources) {
    await connection.execute(
      'INSERT INTO quizai_web_sources (package_id, source_id, payload) VALUES (?, ?, ?)',
      [pkg.id, source.id, JSON.stringify(source)]
    );
  }
}

async function storeQuiz(connection: PoolConnection, quiz: QuizSet): Promise<void> {
  await connection.execute(
    `INSERT INTO quizai_quizzes (id, knowledge_package_id, created_at, payload)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       knowledge_package_id = VALUES(knowledge_package_id),
       created_at = VALUES(created_at),
       payload = VALUES(payload)`,
    [quiz.id, quiz.knowledgePackageId || null, quiz.createdAt, JSON.stringify(quiz)]
  );
}

async function withTransaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function migrateLegacyJsonStore(): Promise<void> {
  const db = getPool();
  const [markers] = await db.execute<RowDataPacket[]>(
    'SELECT metadata_key FROM quizai_storage_metadata WHERE metadata_key = ?',
    [LEGACY_MIGRATION_KEY]
  );
  if (markers.length > 0) return;

  let legacy: LegacyStore = {};
  try {
    const contents = await readFile(LEGACY_DB_FILE, 'utf8');
    const parsed: unknown = JSON.parse(contents);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Legacy QuizAI store must contain a JSON object.');
    }
    legacy = parsed as LegacyStore;
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
  }

  await withTransaction(async (connection) => {
    for (const request of Object.values(legacy.requests || {})) {
      await storeRequest(connection, request);
    }
    for (const pkg of Object.values(legacy.knowledgePackages || {})) {
      await storeKnowledgePackage(connection, pkg);
    }
    for (const quiz of Object.values(legacy.quizzes || {})) {
      await storeQuiz(connection, quiz);
    }
    await connection.execute(
      'INSERT INTO quizai_storage_metadata (metadata_key, metadata_value) VALUES (?, ?)',
      [LEGACY_MIGRATION_KEY, new Date().toISOString()]
    );
  });
}

export async function initializeStorage(): Promise<void> {
  if (pool) return;

  const database = process.env.MYSQL_DATABASE || 'quizz_ai';
  const quotedDatabase = quoteDatabaseName(database);
  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const port = Number(process.env.MYSQL_PORT || 3306);
  const user = process.env.MYSQL_USER || 'root';
  const password = process.env.MYSQL_PASSWORD || '';

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MYSQL_PORT must be a valid TCP port.');
  }

  const schema = await readFile(path.join(process.cwd(), 'server', 'schema.sql'), 'utf8');
  const bootstrap = await createConnection({
    host,
    port,
    user,
    password,
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS ${quotedDatabase} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
       USE ${quotedDatabase};`
    );
    await bootstrap.query(schema);
  } finally {
    await bootstrap.end();
  }

  pool = createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
  });

  try {
    await pool.query('SELECT 1');
    await migrateLegacyJsonStore();
  } catch (error) {
    await pool.end();
    pool = null;
    throw error;
  }
}

export async function closeStorage(): Promise<void> {
  if (!pool) return;
  const activePool = pool;
  pool = null;
  await activePool.end();
}

export async function saveAiRequest(req: ParsedQuizRequest): Promise<ParsedQuizRequest> {
  await getPool().execute(
    `INSERT INTO quizai_requests (id, payload, created_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
    [req.id, JSON.stringify(req), req.createdAt]
  );
  return req;
}

export async function getAiRequest(id: string): Promise<ParsedQuizRequest | null> {
  const [rows] = await getPool().execute<PayloadRow[]>(
    'SELECT payload FROM quizai_requests WHERE id = ?',
    [id]
  );
  return rows.length ? (JSON.parse(rows[0].payload) as ParsedQuizRequest) : null;
}

export async function saveKnowledgePackage(pkg: KnowledgePackage): Promise<KnowledgePackage> {
  await withTransaction((connection) => storeKnowledgePackage(connection, pkg));
  return pkg;
}

export async function getKnowledgePackage(id: string): Promise<KnowledgePackage | null> {
  const [rows] = await getPool().execute<PayloadRow[]>(
    'SELECT payload FROM quizai_knowledge_packages WHERE id = ?',
    [id]
  );
  return rows.length ? (JSON.parse(rows[0].payload) as KnowledgePackage) : null;
}

export async function saveQuizAndSources(
  quiz: QuizSet,
  knowledgePackage?: KnowledgePackage
): Promise<QuizSet> {
  await withTransaction(async (connection) => {
    if (knowledgePackage) {
      const confirmedPackage = withKnowledgeReviewStatus(
        { ...knowledgePackage, updatedAt: new Date().toISOString() },
        'CONFIRMED'
      );
      await storeKnowledgePackage(connection, confirmedPackage);
    }
    await storeQuiz(connection, quiz);
  });
  return quiz;
}

export async function getQuizById(id: string): Promise<QuizSet | null> {
  const [rows] = await getPool().execute<PayloadRow[]>(
    'SELECT payload FROM quizai_quizzes WHERE id = ?',
    [id]
  );
  return rows.length ? (JSON.parse(rows[0].payload) as QuizSet) : null;
}

export async function listQuizzes(): Promise<QuizSet[]> {
  const [rows] = await getPool().query<PayloadRow[]>(
    'SELECT payload FROM quizai_quizzes ORDER BY created_at DESC'
  );
  return rows.map((row) => JSON.parse(row.payload) as QuizSet);
}

export async function getQuizSources(quizId: string): Promise<{
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
} | null> {
  const quiz = await getQuizById(quizId);
  if (!quiz) return null;

  const knowledgePackage = quiz.knowledgePackageId
    ? await getKnowledgePackage(quiz.knowledgePackageId)
    : null;

  return {
    quizId: quiz.id,
    originType: quiz.originType || 'DOCUMENT',
    contentOrigin: quiz.contentOrigin || (knowledgePackage?.contentOrigin ?? 'AI_GENERATED'),
    originNotice: quiz.originNotice || knowledgePackage?.originNotice,
    freshnessWarning: quiz.freshnessWarning || knowledgePackage?.freshnessWarning,
    webSources: quiz.webSources || knowledgePackage?.webSources || [],
    knowledgePackage,
    questionMappings: quiz.questions.map((question) => ({
      questionId: question.id,
      questionNumber: question.questionNumber,
      knowledgeUnit: question.source.knowledgeUnit,
      chapter: question.source.chapter,
      section: question.source.section,
      sourceText: question.source.sourceText,
      generationReason: question.source.generationReason,
      webSourceUrl: question.source.webSourceUrl,
      webSourceTitle: question.source.webSourceTitle,
    })),
  };
}
