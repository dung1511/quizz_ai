import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { processDocument } from './server/documentProcessor';
import {
  generateExamWithAI,
  SourceGroundingError,
  regenerateSingleQuestion,
  generatePracticeQuestions,
  buildExamMatrix,
} from './server/questionGenerator';
import { generatePaperExamHTML } from './server/exportService';
import { generatePaperExamDOCX } from './server/docxExportService';
import { extractTextFromBuffer, isBinaryZipOrDocx } from './server/documentExtractor';
import { generateDocumentPrintHTML } from './server/documentPrintService';
import { AiServiceError, getConfiguredApiKey } from './server/geminiClient';
import {
  createAccountId,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  isValidEmail,
  normalizeEmail,
  SESSION_MAX_AGE_SECONDS,
  verifyPassword,
} from './server/auth';
import {
  buildReviewQuizSet,
  QuizAttemptValidationError,
  scoreQuizAttempt,
} from './server/quizAttempts';
import { parseUserRequest } from './server/aiText/requestParser';
import {
  buildKnowledgeContent,
  updateKnowledgePackageFromUserEdit,
} from './server/aiText/knowledgeBuilder';
import { generateAndValidateWithRepair } from './server/aiText/questionValidatorRepair';
import {
  getKnowledgePackage,
  createAccountWithSession,
  createAuthSession,
  deleteAuthSession,
  getAccountCredentials,
  getAccountForSession,
  getQuizAttemptRecord,
  listQuizAttemptRecords,
  getQuizById,
  getQuizSources,
  initializeStorage,
  listQuizzes,
  saveQuizAttemptRecord,
  saveQuizAndSources,
} from './server/storage';
import { AccountUser, QuizAttempt, QuizAttemptRecord, QuizSet } from './src/types';
import { renderTikzPreview, TikzPreviewError } from './server/tikzPreviewService';

dotenv.config();

function getSessionToken(req: express.Request): string | null {
  const cookie = req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('quizai_session='));
  return cookie ? cookie.slice('quizai_session='.length) : null;
}

async function getRequestUser(req: express.Request): Promise<AccountUser | null> {
  const token = getSessionToken(req);
  return token ? getAccountForSession(hashSessionToken(token)) : null;
}

function setSessionCookie(res: express.Response, token: string): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `quizai_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`
  );
}

function clearSessionCookie(res: express.Response): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `quizai_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isQuizAttemptPayload(value: unknown): value is QuizAttempt {
  if (!isObjectRecord(value) || !isObjectRecord(value.answers)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.quizId === 'string' &&
    typeof value.timeSpentSeconds === 'number' &&
    Number.isFinite(value.timeSpentSeconds) &&
    value.timeSpentSeconds >= 0 &&
    Object.values(value.answers).every(
      (answer) => typeof answer === 'string' && ['A', 'B', 'C', 'D'].includes(answer)
    ) &&
    Array.isArray(value.flaggedQuestions) &&
    value.flaggedQuestions.every((id) => typeof id === 'string')
  );
}

function isQuizSetPayload(value: unknown): value is QuizSet {
  if (
    !isObjectRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.documentName !== 'string' ||
    !Array.isArray(value.questions) ||
    value.questions.length === 0 ||
    value.questions.length > 100
  ) {
    return false;
  }

  const questionIds = new Set<string>();
  return value.questions.every((question) => {
    if (
      !isObjectRecord(question) ||
      typeof question.id !== 'string' ||
      questionIds.has(question.id) ||
      typeof question.questionText !== 'string' ||
      typeof question.explanation !== 'string' ||
      !['easy', 'medium', 'hard'].includes(String(question.difficulty)) ||
      typeof question.topic !== 'string' ||
      !Array.isArray(question.options) ||
      question.options.length !== 4 ||
      !isObjectRecord(question.source) ||
      typeof question.source.chapter !== 'string' ||
      typeof question.source.page !== 'number'
    ) {
      return false;
    }

    const optionKeys = question.options.map((option) =>
      isObjectRecord(option) ? option.key : undefined
    );
    if (
      optionKeys.some((key) => !['A', 'B', 'C', 'D'].includes(String(key))) ||
      new Set(optionKeys).size !== 4 ||
      !optionKeys.includes(question.correctAnswer) ||
      question.options.some(
        (option) => !isObjectRecord(option) || typeof option.text !== 'string'
      )
    ) {
      return false;
    }

    questionIds.add(question.id);
    return true;
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  await initializeStorage();
  app.use(express.json({ limit: '50mb' }));

  // ==========================================
  // API SPECIFICATION
  // ==========================================

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      hasGeminiApiKey: Boolean(getConfiguredApiKey()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/auth/me', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json({ user: await getRequestUser(req) });
    } catch (error) {
      console.error('[QuizAI][auth-session] Error:', error);
      res.status(500).json({ error: 'Không thể xác minh phiên đăng nhập.' });
    }
  });

  app.post('/api/auth/register', async (req, res) => {
    const body: unknown = req.body;
    if (!isObjectRecord(body)) {
      res.status(400).json({ error: 'Thông tin đăng ký không hợp lệ.' });
      return;
    }

    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const requestedName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Vui lòng nhập địa chỉ email hợp lệ.' });
      return;
    }
    if (password.length < 8 || password.length > 128) {
      res.status(400).json({ error: 'Mật khẩu cần có từ 8 đến 128 ký tự.' });
      return;
    }

    const user: AccountUser = {
      id: createAccountId(),
      email,
      displayName: (requestedName || email.split('@')[0]).slice(0, 191),
    };
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
    try {
      const passwordHash = await hashPassword(password);
      await createAccountWithSession(user, passwordHash, hashSessionToken(token), expiresAt);
      setSessionCookie(res, token);
      res.status(201).json({ user });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ER_DUP_ENTRY'
      ) {
        res.status(409).json({ error: 'Email này đã được đăng ký.' });
        return;
      }
      console.error('[QuizAI][auth-register] Error:', error);
      res.status(500).json({ error: 'Không thể tạo tài khoản lúc này.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const body: unknown = req.body;
    if (!isObjectRecord(body)) {
      res.status(400).json({ error: 'Thông tin đăng nhập không hợp lệ.' });
      return;
    }

    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!isValidEmail(email) || password.length === 0 || password.length > 128) {
      res.status(401).json({ error: 'Email hoặc mật khẩu không chính xác.' });
      return;
    }

    try {
      const credentials = await getAccountCredentials(email);
      const passwordMatches = credentials
        ? await verifyPassword(password, credentials.passwordHash)
        : await verifyPassword(
            password,
            `scrypt$00000000000000000000000000000000$${'0'.repeat(128)}`
          );
      if (!credentials || !passwordMatches) {
        res.status(401).json({ error: 'Email hoặc mật khẩu không chính xác.' });
        return;
      }

      const token = createSessionToken();
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
      await createAuthSession(credentials.user.id, hashSessionToken(token), expiresAt);
      setSessionCookie(res, token);
      res.json({ user: credentials.user });
    } catch (error) {
      console.error('[QuizAI][auth-login] Error:', error);
      res.status(500).json({ error: 'Không thể đăng nhập lúc này.' });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      const token = getSessionToken(req);
      if (token) await deleteAuthSession(hashSessionToken(token));
      clearSessionCookie(res);
      res.status(204).end();
    } catch (error) {
      console.error('[QuizAI][auth-logout] Error:', error);
      res.status(500).json({ error: 'Không thể đăng xuất lúc này.' });
    }
  });

  app.get('/api/attempts', async (req, res) => {
    try {
      const user = await getRequestUser(req);
      if (!user) {
        res.status(401).json({ error: 'Vui lòng đăng nhập để xem lịch sử làm bài.' });
        return;
      }
      res.set('Cache-Control', 'no-store');
      res.json({ attempts: await listQuizAttemptRecords(user.id) });
    } catch (error) {
      console.error('[QuizAI][attempts-list] Error:', error);
      res.status(500).json({ error: 'Không thể tải lịch sử làm bài.' });
    }
  });

  app.post('/api/attempts', async (req, res) => {
    try {
      const user = await getRequestUser(req);
      if (!user) {
        res.status(401).json({ error: 'Vui lòng đăng nhập trước khi lưu kết quả.' });
        return;
      }

      const body: unknown = req.body;
      if (
        !isObjectRecord(body) ||
        !isQuizAttemptPayload(body.attempt) ||
        (body.attemptType !== 'quiz' && body.attemptType !== 'review')
      ) {
        res.status(400).json({ error: 'Dữ liệu kết quả làm bài không hợp lệ.' });
        return;
      }

      let quizSet: QuizSet;
      let sourceAttemptId: string | undefined;
      if (body.attemptType === 'quiz') {
        if (!isQuizSetPayload(body.quizSet)) {
          res.status(400).json({ error: 'Thiếu bộ câu hỏi của lượt làm bài.' });
          return;
        }
        quizSet = body.quizSet;
      } else {
        sourceAttemptId =
          typeof body.sourceAttemptId === 'string' ? body.sourceAttemptId : undefined;
        if (!sourceAttemptId) {
          res.status(400).json({ error: 'Thiếu lượt thi gốc của bài ôn tập.' });
          return;
        }
        const sourceRecord = await getQuizAttemptRecord(user.id, sourceAttemptId);
        if (!sourceRecord || sourceRecord.attemptType !== 'quiz') {
          res.status(404).json({ error: 'Không tìm thấy lượt thi gốc trong tài khoản này.' });
          return;
        }
        quizSet = buildReviewQuizSet(sourceRecord.quizSet, sourceRecord.attempt);
        if (quizSet.questions.length === 0) {
          res.status(422).json({ error: 'Lượt thi gốc không có câu sai cần ôn tập.' });
          return;
        }
      }

      const attempt = scoreQuizAttempt(body.attempt, quizSet);
      const record: QuizAttemptRecord = {
        attempt,
        quizSet,
        attemptType: body.attemptType,
        sourceAttemptId,
      };
      const savedRecord = await saveQuizAttemptRecord(user.id, record);
      res.set('Cache-Control', 'no-store');
      res.status(201).json({ record: savedRecord });
    } catch (error) {
      if (error instanceof QuizAttemptValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error('[QuizAI][attempt-save] Error:', error);
      res.status(500).json({ error: 'Không thể lưu kết quả làm bài.' });
    }
  });

  // POST /api/documents/extract
  // Safe extraction for DOCX (via mammoth), PDF (via pdf-parse), and TXT
  app.post('/api/documents/extract', async (req, res) => {
    try {
      const { fileBase64, fileName, fileType } = req.body;
      if (!fileBase64 || typeof fileBase64 !== 'string') {
        res.status(400).json({ error: 'Missing fileBase64 payload' });
        return;
      }

      // Convert base64 to buffer
      const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');

      const result = await extractTextFromBuffer(
        buffer,
        fileName || 'TaiLieu.docx',
        fileType
      );

      res.json(result);
    } catch (err: any) {
      console.error('Error extracting document text:', err);
      res.status(500).json({
        extractionStatus: 'failed',
        error: err.message || 'Lỗi khi trích xuất tài liệu',
      });
    }
  });

  // POST /api/documents/print-html
  // Tạo bản in HTML chuyên nghiệp cho tài liệu trong kho
  app.post('/api/documents/print-html', (req, res) => {
    try {
      const { document, uploadDate } = req.body;
      if (!document) {
        res.status(400).json({ error: 'Missing document payload' });
        return;
      }

      const html = generateDocumentPrintHTML(document, { uploadDate });
      res.json({ html });
    } catch (err: any) {
      console.error('Error generating document print HTML:', err);
      res.status(500).json({ error: err.message || 'Failed to generate document print HTML' });
    }
  });

  // POST /api/documents/process
  // Trích xuất cấu trúc tài liệu, chapters, sections, chunks, knowledge units
  app.post('/api/documents/process', async (req, res) => {
    try {
      const { text, fileName, fileType, fileSize } = req.body;
      if (!text || typeof text !== 'string') {
        res.status(400).json({ error: 'Missing document text content' });
        return;
      }

      // Safeguard against raw binary DOCX strings
      if (isBinaryZipOrDocx(text)) {
        res.status(400).json({
          error:
            'Tài liệu nhận được chứa chuỗi nhị phân ZIP/DOCX (PK.../[Content_Types].xml). Vui lòng trích xuất qua endpoint /api/documents/extract trước khi xử lý.',
        });
        return;
      }

      const docSource = await processDocument(
        text,
        fileName || 'TaiLieu.pdf',
        fileType || 'pdf',
        fileSize || '1.8 MB'
      );

      res.json(docSource);
    } catch (err: any) {
      console.error('Error processing document:', err);
      res.status(500).json({ error: err.message || 'Failed to process document' });
    }
  });

  // POST /api/quizzes/generate
  // Tạo đề thi dựa trên ma trận đề, gắn nguồn chi tiết, validator
  app.post('/api/quizzes/generate', async (req, res) => {
    try {
      const { document, numQuestions, difficulty, customMatrix, strictSourceOnly } = req.body;
      if (!document || !document.rawText) {
        res.status(400).json({ error: 'Invalid document payload' });
        return;
      }

      const questionCount = Math.max(1, Math.min(50, Number(numQuestions) || 10));
      const diffLevel = difficulty || 'medium';

      const result = await generateExamWithAI({
        document,
        numQuestions: questionCount,
        difficulty: diffLevel,
        customMatrix,
        strictSourceOnly: strictSourceOnly !== false,
      });

      res.json(result);
    } catch (err: any) {
      console.error('Error generating exam:', err);
      const status = err instanceof SourceGroundingError ? err.statusCode : 500;
      res.status(status).json({
        error: err.message || 'Failed to generate exam',
        code: err instanceof SourceGroundingError ? err.code : 'GENERATE_EXAM_ERROR',
      });
    }
  });

  // POST /api/quizzes/matrix
  // Tạo ma trận đề tham khảo theo danh sách chương
  app.post('/api/quizzes/matrix', (req, res) => {
    try {
      const { chapters, totalQuestions, difficulty } = req.body;
      if (!chapters || !Array.isArray(chapters)) {
        res.status(400).json({ error: 'Chapters array is required' });
        return;
      }

      const matrix = buildExamMatrix(chapters, Number(totalQuestions) || 10, difficulty || 'medium');
      res.json(matrix);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/questions/regenerate
  // Tạo lại một câu hỏi cụ thể
  app.post('/api/questions/regenerate', async (req, res) => {
    try {
      const { document, knowledgeUnitName, questionNumber, difficulty } = req.body;
      if (!document || !knowledgeUnitName) {
        res.status(400).json({ error: 'Missing document or knowledge unit name' });
        return;
      }

      const regenerated = await regenerateSingleQuestion(
        document,
        knowledgeUnitName,
        Number(questionNumber) || 1,
        difficulty || 'medium'
      );

      res.json(regenerated);
    } catch (err: any) {
      console.error('Error regenerating question:', err);
      res.status(500).json({ error: err.message || 'Failed to regenerate question' });
    }
  });

  // POST /api/questions/practice
  // Flow học lại: tạo 3-5 câu luyện tập cho đơn vị kiến thức bị sai
  app.post('/api/questions/practice', async (req, res) => {
    try {
      const { document, knowledgeUnitName, count } = req.body;
      if (!document || !knowledgeUnitName) {
        res.status(400).json({ error: 'Missing document or knowledge unit' });
        return;
      }

      const practiceQuestions = await generatePracticeQuestions(
        document,
        knowledgeUnitName,
        Number(count) || 3
      );

      res.json(practiceQuestions);
    } catch (err: any) {
      console.error('Error generating practice questions:', err);
      res.status(500).json({ error: err.message || 'Failed to generate practice questions' });
    }
  });

  app.post('/api/questions/tikz-preview', async (req, res) => {
    const tikzCode = req.body?.tikzCode;
    if (typeof tikzCode !== 'string') {
      res.status(400).json({ error: 'Thiếu mã TikZ.' });
      return;
    }

    try {
      const svg = await renderTikzPreview(tikzCode);
      res.json({ svg });
    } catch (error) {
      if (error instanceof TikzPreviewError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }

      console.error('Error rendering TikZ preview:', error);
      res.status(500).json({ error: 'Không thể dựng hình TikZ.' });
    }
  });

  // POST /api/quizzes/export
  // Xuất đề thi giấy chuẩn trường đại học / THPT (HTML / PDF print)
  app.post('/api/quizzes/export', (req, res) => {
    try {
      const { quizSet, config } = req.body;
      if (!quizSet || !quizSet.questions) {
        res.status(400).json({ error: 'Missing quizSet data' });
        return;
      }

      const html = generatePaperExamHTML(quizSet, config || {});
      res.json({ html });
    } catch (err: any) {
      console.error('Error exporting exam:', err);
      res.status(500).json({ error: err.message || 'Failed to export exam' });
    }
  });

  // POST /api/quizzes/export-docx
  // Xuất đề thi dạng Microsoft Word .docx thực thụ bằng thư viện docx
  app.post('/api/quizzes/export-docx', async (req, res) => {
    try {
      const { quizSet, config } = req.body;
      if (!quizSet || !quizSet.questions) {
        res.status(400).json({ error: 'Missing quizSet data' });
        return;
      }

      const docxBuffer = await generatePaperExamDOCX(quizSet, config || {});
      const examCode = config?.examCode || '001';
      const safeFilename = `DeThi_${examCode}.docx`;

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.send(docxBuffer);
    } catch (err: any) {
      console.error('Error exporting docx exam:', err);
      res.status(500).json({ error: err.message || 'Failed to export DOCX exam' });
    }
  });

  // ==========================================
  // AI_TEXT PIPELINE API ENDPOINTS
  // ==========================================

  // Step 2: Parse natural language request into normalized quiz specification
  app.post(['/api/ai/parse-request', '/api/ai/parse-request/'], async (req, res) => {
    try {
      const { rawPrompt, quizTitle, questionCount, difficultyMode } = req.body || {};
      const parsed = await parseUserRequest({
        rawPrompt,
        quizTitle,
        questionCount: questionCount ? Number(questionCount) : undefined,
        difficultyMode,
      });
      res.json(parsed);
    } catch (err: any) {
      const status = err instanceof AiServiceError ? err.statusCode : 500;
      console.error('[QuizAI][parse-request] Error:', err);
      res.status(status).json({
        error: err.message || 'Không thể phân tích yêu cầu tạo đề.',
        code: err instanceof AiServiceError ? err.code : 'PARSE_ERROR',
        step: err instanceof AiServiceError ? err.step : 'parse-request',
      });
    }
  });

  // Step 3: Build learning knowledge content (Web Research -> Fallback AI Synthesis)
  // Supports both SSE real-time step streaming (Accept: text/event-stream or body.stream=true) and JSON
  app.post(['/api/ai/build-knowledge', '/api/ai/build-knowledge/'], async (req, res) => {
    const wantsStream =
      req.body?.stream === true ||
      (req.headers.accept || '').includes('text/event-stream');

    const { request: parsedRequest } = req.body || {};
    if (!parsedRequest || !parsedRequest.topic) {
      res.status(400).json({
        error: 'Thiếu thông tin yêu cầu đã phân tích (request.topic).',
        code: 'INVALID_REQUEST',
        step: 'build-knowledge',
      });
      return;
    }

    if (wantsStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const sendEvent = (eventName: string, data: unknown) => {
        res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const pkg = await buildKnowledgeContent(parsedRequest, (stepEvent) => {
          sendEvent('progress', stepEvent);
        });
        sendEvent('result', pkg);
        res.end();
      } catch (err: any) {
        const status = err instanceof AiServiceError ? err.statusCode : 500;
        console.error('[QuizAI][build-knowledge][stream] Error:', err);
        sendEvent('error', {
          statusCode: status,
          error: err.message || 'Không thể xây dựng nội dung học tập.',
          code: err instanceof AiServiceError ? err.code : 'BUILD_KNOWLEDGE_ERROR',
          step: err instanceof AiServiceError ? err.step : 'build-knowledge',
        });
        res.end();
      }
      return;
    }

    try {
      const pkg = await buildKnowledgeContent(parsedRequest);
      res.json(pkg);
    } catch (err: any) {
      const status = err instanceof AiServiceError ? err.statusCode : 500;
      console.error('[QuizAI][build-knowledge] Error:', err);
      res.status(status).json({
        error: err.message || 'Không thể xây dựng nội dung học tập.',
        code: err instanceof AiServiceError ? err.code : 'BUILD_KNOWLEDGE_ERROR',
        step: err instanceof AiServiceError ? err.step : 'build-knowledge',
      });
    }
  });

  // Step 4: Retrieve knowledge preview by ID
  app.get('/api/ai/knowledge-preview/:id', async (req, res) => {
    try {
      const pkg = await getKnowledgePackage(req.params.id);
      if (!pkg) {
        res.status(404).json({ error: 'Không tìm thấy nội dung học tập.' });
        return;
      }
      res.json(pkg);
    } catch (error) {
      console.error('[QuizAI][knowledge-preview] Error:', error);
      res.status(500).json({ error: 'Không thể tải nội dung học tập.' });
    }
  });

  // Step 5 & 6: Generate questions strictly from confirmed knowledge, validate, repair, and save
  app.post(
    ['/api/ai/generate-from-knowledge', '/api/ai/generate-from-knowledge/'],
    async (req, res) => {
      let authenticatedUser: AccountUser | null;
      try {
        authenticatedUser = await getRequestUser(req);
      } catch (error) {
        console.error('[QuizAI][generate-from-knowledge][auth] Error:', error);
        res.status(500).json({ error: 'Không thể xác minh tài khoản.' });
        return;
      }
      if (!authenticatedUser) {
        res.status(401).json({ error: 'Vui lòng đăng nhập để lưu bộ đề vào tài khoản.' });
        return;
      }

      const wantsStream =
        req.body?.stream === true ||
        (req.headers.accept || '').includes('text/event-stream');

      const { knowledgePackageId, editedMarkdown, editedChapters, editedRequest } =
        req.body || {};

      if (!knowledgePackageId) {
        res.status(400).json({
          error: 'Thiếu mã nội dung học tập (knowledgePackageId).',
          code: 'MISSING_KNOWLEDGE_ID',
          step: 'generate-from-knowledge',
        });
        return;
      }

      const executeGeneration = async (
        onProgress?: (ev: any) => void
      ): Promise<QuizSet> => {
        const confirmedPkg = await updateKnowledgePackageFromUserEdit(knowledgePackageId, {
          chapters: editedChapters,
          compiledMarkdown: editedMarkdown,
          request: editedRequest,
        });

        const { matrix, questions } = await generateAndValidateWithRepair(
          confirmedPkg,
          onProgress
        );

        onProgress?.({
          step: 'saving',
          status: 'running',
          message: 'Đang lưu bộ đề, đáp án, nội dung học tập và nguồn tham khảo...',
          timestamp: new Date().toISOString(),
        });

        const quizSet: QuizSet = {
          id: `quiz-ai-${Date.now()}`,
          title: confirmedPkg.request.quizTitle,
          documentId: confirmedPkg.documentSource.id,
          documentName: confirmedPkg.documentSource.fileName,
          documentExcerpt: confirmedPkg.compiledMarkdown.slice(0, 200),
          createdAt: new Date().toISOString(),
          totalQuestions: questions.length,
          recommendedMinutes: Math.max(5, Math.round(questions.length * 1.5)),
          difficulty: confirmedPkg.request.difficultyMode,
          questionType: 'multiple_choice',
          quizStyle: 'standard',
          matrix,
          chapters: confirmedPkg.documentSource.chapters,
          knowledgeUnits: confirmedPkg.documentSource.knowledgeUnits,
          questions,
          rawDocumentText: confirmedPkg.compiledMarkdown,
          originType: 'AI_TEXT',
          aiRequest: confirmedPkg.request,
          knowledgePackageId: confirmedPkg.id,
          contentOrigin: confirmedPkg.contentOrigin,
          originNotice: confirmedPkg.originNotice,
          freshnessWarning: confirmedPkg.freshnessWarning,
          webSources: confirmedPkg.webSources,
          compiledKnowledgeText: confirmedPkg.compiledMarkdown,
        };

        await saveQuizAndSources(quizSet, confirmedPkg, authenticatedUser.id);

        onProgress?.({
          step: 'saving',
          status: 'completed',
          message: `Đã lưu thành công bộ đề "${quizSet.title}" (${quizSet.totalQuestions} câu).`,
          timestamp: new Date().toISOString(),
        });

        return quizSet;
      };

      if (wantsStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        const sendEvent = (eventName: string, data: unknown) => {
          res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        try {
          const quizSet = await executeGeneration((stepEvent) => {
            sendEvent('progress', stepEvent);
          });
          sendEvent('result', quizSet);
          res.end();
        } catch (err: any) {
          const status = err instanceof AiServiceError ? err.statusCode : 500;
          console.error('[QuizAI][generate-from-knowledge][stream] Error:', err);
          sendEvent('error', {
            statusCode: status,
            error: err.message || 'Không thể tạo bộ đề trắc nghiệm.',
            code: err instanceof AiServiceError ? err.code : 'GENERATE_ERROR',
            step: err instanceof AiServiceError ? err.step : 'generate-from-knowledge',
          });
          res.end();
        }
        return;
      }

      try {
        const quizSet = await executeGeneration();
        res.json(quizSet);
      } catch (err: any) {
        const status = err instanceof AiServiceError ? err.statusCode : 500;
        console.error('[QuizAI][generate-from-knowledge] Error:', err);
        res.status(status).json({
          error: err.message || 'Không thể tạo bộ đề trắc nghiệm.',
          code: err instanceof AiServiceError ? err.code : 'GENERATE_ERROR',
          step: err instanceof AiServiceError ? err.step : 'generate-from-knowledge',
        });
      }
    }
  );

  // List saved AI_TEXT quizzes
  app.get('/api/quizzes', async (req, res) => {
    try {
      const user = await getRequestUser(req);
      if (!user) {
        res.status(401).json({ error: 'Vui lòng đăng nhập để xem bộ đề đã lưu.' });
        return;
      }
      res.set('Cache-Control', 'no-store');
      res.json({ quizzes: await listQuizzes(user.id) });
    } catch (error) {
      console.error('[QuizAI][quizzes] Error:', error);
      res.status(500).json({ error: 'Không thể tải danh sách bộ đề.' });
    }
  });

  // Get single quiz by ID
  app.get('/api/quizzes/:id', async (req, res) => {
    try {
      const user = await getRequestUser(req);
      if (!user) {
        res.status(401).json({ error: 'Vui lòng đăng nhập để xem bộ đề.' });
        return;
      }
      const quiz = await getQuizById(req.params.id, user.id);
      if (!quiz) {
        res.status(404).json({ error: 'Không tìm thấy bộ đề.' });
        return;
      }
      res.json(quiz);
    } catch (error) {
      console.error('[QuizAI][quiz] Error:', error);
      res.status(500).json({ error: 'Không thể tải bộ đề.' });
    }
  });

  // Get quiz sources & knowledge links
  app.get(['/api/quizzes/:id/sources', '/api/quizzes/:id/sources/'], async (req, res) => {
    try {
      const user = await getRequestUser(req);
      if (!user) {
        res.status(401).json({ error: 'Vui lòng đăng nhập để xem nguồn bộ đề.' });
        return;
      }
      const sources = await getQuizSources(req.params.id, user.id);
      if (!sources) {
        res.status(404).json({ error: 'Không tìm thấy nguồn của bộ đề.' });
        return;
      }
      res.json(sources);
    } catch (error) {
      console.error('[QuizAI][quiz-sources] Error:', error);
      res.status(500).json({ error: 'Không thể tải nguồn của bộ đề.' });
    }
  });

  // ==========================================
  // VITE & STATIC SERVING
  // ==========================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`QuizAI server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('[QuizAI] Server startup failed:', error);
  process.exitCode = 1;
});
