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
import { parseUserRequest } from './server/aiText/requestParser';
import {
  buildKnowledgeContent,
  updateKnowledgePackageFromUserEdit,
} from './server/aiText/knowledgeBuilder';
import { generateAndValidateWithRepair } from './server/aiText/questionValidatorRepair';
import {
  getKnowledgePackage,
  getQuizById,
  getQuizSources,
  initializeStorage,
  listQuizzes,
  saveQuizAndSources,
} from './server/storage';
import { QuizSet } from './src/types';
import { renderTikzPreview, TikzPreviewError } from './server/tikzPreviewService';

dotenv.config();

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

        await saveQuizAndSources(quizSet, confirmedPkg);

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
  app.get('/api/quizzes', async (_req, res) => {
    try {
      res.json({ quizzes: await listQuizzes() });
    } catch (error) {
      console.error('[QuizAI][quizzes] Error:', error);
      res.status(500).json({ error: 'Không thể tải danh sách bộ đề.' });
    }
  });

  // Get single quiz by ID
  app.get('/api/quizzes/:id', async (req, res) => {
    try {
      const quiz = await getQuizById(req.params.id);
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
      const sources = await getQuizSources(req.params.id);
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
    console.log(`QuizAI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('[QuizAI] Server startup failed:', error);
  process.exitCode = 1;
});
