import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { processDocument } from './server/documentProcessor';
import {
  generateExamWithAI,
  regenerateSingleQuestion,
  generatePracticeQuestions,
  buildExamMatrix,
} from './server/questionGenerator';
import { generatePaperExamHTML } from './server/exportService';
import { generatePaperExamDOCX } from './server/docxExportService';
import { extractTextFromBuffer, isBinaryZipOrDocx } from './server/documentExtractor';
import { generateDocumentPrintHTML } from './server/documentPrintService';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // ==========================================
  // API SPECIFICATION
  // ==========================================

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      hasGeminiApiKey: Boolean(process.env.GEMINI_API_KEY),
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
      res.status(500).json({ error: err.message || 'Failed to generate exam' });
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

startServer();
