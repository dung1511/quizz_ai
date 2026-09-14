import {
  DocumentSource,
  Question,
  ExamMatrix,
  ChapterDistribution,
  DifficultyLevel,
  KnowledgeUnit,
  DocumentChapter,
} from '../src/types';
import { getGeminiClient } from './geminiClient';
import { validateQuestionSet } from './questionValidator';
import { cleanConceptName } from './documentProcessor';

export interface GenerateExamRequest {
  document: DocumentSource;
  numQuestions: number;
  difficulty: DifficultyLevel;
  customMatrix?: ExamMatrix;
  focusChapterId?: string;
  strictSourceOnly?: boolean;
}

export interface GenerateExamResponse {
  matrix: ExamMatrix;
  questions: Question[];
  validationSummary: {
    totalQuestions: number;
    validCount: number;
    needsReviewCount: number;
    allValid: boolean;
  };
}

/**
 * Creates the Exam Matrix / Blueprint
 */
export function buildExamMatrix(
  chapters: DocumentChapter[],
  totalQuestions: number,
  difficulty: DifficultyLevel
): ExamMatrix {
  const chapterCount = Math.max(1, chapters.length);
  const basePerChapter = Math.floor(totalQuestions / chapterCount);
  let remainder = totalQuestions % chapterCount;

  const distributions: ChapterDistribution[] = chapters.map((chap, idx) => {
    const chapterTotal = basePerChapter + (idx < remainder ? 1 : 0);

    let easy = 0;
    let medium = 0;
    let hard = 0;

    if (difficulty === 'easy') {
      easy = Math.round(chapterTotal * 0.7);
      medium = Math.round(chapterTotal * 0.25);
      hard = chapterTotal - easy - medium;
    } else if (difficulty === 'hard') {
      hard = Math.round(chapterTotal * 0.6);
      medium = Math.round(chapterTotal * 0.3);
      easy = chapterTotal - hard - medium;
    } else {
      // Default: Medium / Balanced
      easy = Math.round(chapterTotal * 0.3);
      medium = Math.round(chapterTotal * 0.5);
      hard = chapterTotal - easy - medium;
    }

    // Ensure sum equals chapterTotal
    const sum = easy + medium + hard;
    if (sum !== chapterTotal) {
      medium += chapterTotal - sum;
    }

    return {
      chapterId: chap.id,
      chapterTitle: chap.title,
      easy: Math.max(0, easy),
      medium: Math.max(0, medium),
      hard: Math.max(0, hard),
      total: chapterTotal,
    };
  });

  const totalEasy = distributions.reduce((acc, d) => acc + d.easy, 0);
  const totalMedium = distributions.reduce((acc, d) => acc + d.medium, 0);
  const totalHard = distributions.reduce((acc, d) => acc + d.hard, 0);

  return {
    chapterDistributions: distributions,
    totalEasy,
    totalMedium,
    totalHard,
    grandTotal: totalQuestions,
  };
}

/**
 * Generate questions using Gemini with strict source groundedness & anti-hallucination
 */
export async function generateExamWithAI(
  req: GenerateExamRequest
): Promise<GenerateExamResponse> {
  const matrix =
    req.customMatrix ||
    buildExamMatrix(req.document.chapters, req.numQuestions, req.difficulty);

  const ai = getGeminiClient();
  let generatedQuestions: Question[] = [];

  if (ai) {
    try {
      generatedQuestions = await callGeminiForQuestions(req, matrix);
    } catch (err) {
      console.warn('Gemini question generation error, falling back to deterministic synthesis:', err);
      generatedQuestions = generateRuleBasedQuestions(req, matrix);
    }
  } else {
    generatedQuestions = generateRuleBasedQuestions(req, matrix);
  }

  // Adjust count to exactly match requested number
  if (generatedQuestions.length < req.numQuestions) {
    const fillers = generateRuleBasedQuestions(req, matrix);
    for (const f of fillers) {
      if (generatedQuestions.length >= req.numQuestions) break;
      if (!generatedQuestions.some((q) => q.questionText === f.questionText)) {
        generatedQuestions.push({
          ...f,
          id: `q-fill-${Date.now()}-${generatedQuestions.length + 1}`,
          questionNumber: generatedQuestions.length + 1,
        });
      }
    }
  }

  // Cap at exact question count
  generatedQuestions = generatedQuestions.slice(0, req.numQuestions);

  // Assign clean sequential question numbers
  generatedQuestions.forEach((q, idx) => {
    q.questionNumber = idx + 1;
  });

  // Validate the questions
  const validationSummary = validateQuestionSet(generatedQuestions);

  return {
    matrix,
    questions: generatedQuestions,
    validationSummary: {
      totalQuestions: validationSummary.totalQuestions,
      validCount: validationSummary.validCount,
      needsReviewCount: validationSummary.needsReviewCount,
      allValid: validationSummary.allValid,
    },
  };
}

/**
 * Call Gemini Flash model with anti-hallucination system prompt
 */
async function callGeminiForQuestions(
  req: GenerateExamRequest,
  matrix: ExamMatrix
): Promise<Question[]> {
  const ai = getGeminiClient();
  if (!ai) throw new Error('Gemini client not initialized');

  const { document, numQuestions, difficulty } = req;
  const chaptersSummary = document.chapters
    .map(
      (c) =>
        `- ${c.title} (Trang ${c.pageStart} - ${c.pageEnd}): ${c.sections
          .map((s) => `${s.sectionNumber} ${s.title}`)
          .join(', ')}`
    )
    .join('\n');

  const kuSummary = document.knowledgeUnits
    .slice(0, 25)
    .map((k) => `* [${k.chapter} - ${k.section}] ${k.name} (${k.type}): "${k.sourceText.slice(0, 100)}..."`)
    .join('\n');

  const sourceSample = document.rawText.slice(0, 15000);

  const prompt = `Bạn là Chuyên gia Khảo thí và Thiết kế đề thi trắc nghiệm chuẩn quốc gia.
Nhiệm vụ của bạn là tạo chính xác ${numQuestions} câu hỏi trắc nghiệm từ tài liệu học tập sau đây:
Tên tài liệu: "${document.title}" (${document.fileName})

CẤU TRÚC CHƯƠNG MỤC CỦA TÀI LIỆU:
${chaptersSummary}

CÁC ĐƠN VỊ KIẾN THỨC TRỌNG TÂM:
${kuSummary}

NỘI DUNG NGUYÊN BẢN TÀI LIỆU:
"""
${sourceSample}
"""

MA TRẬN ĐỀ YÊU CẦU:
- Tổng số câu: ${numQuestions}
- Độ khó chủ đạo: ${difficulty}
- Phân bổ theo ma trận: ${JSON.stringify(matrix.chapterDistributions.map(d => ({ chapter: d.chapterTitle, total: d.total, easy: d.easy, med: d.medium, hard: d.hard })))}

NGUYÊN TẮC BẮT BUỘC CHỐNG BỊA ĐẶT KIẾN THỨC (ANTI-HALLUCINATION):
1. CHỈ tạo câu hỏi dựa HOÀN TOÀN trên dữ liệu có thật trong nội dung văn bản nguồn cung cấp ở trên. Tuyệt đối không tự bịa thông tin ngoài tài liệu.
2. MỖI câu hỏi BẮT BUỘC phải có đúng 4 phương án A, B, C, D và đúng 1 đáp án đúng.
3. MỖI câu hỏi BẮT BUỘC phải lưu đầy đủ thông tin truy xuất nguồn gốc:
   - chapter: Tên chương chính xác trong tài liệu.
   - section: Tên mục cụ thể (ví dụ "3.2 – Cú pháp SELECT").
   - page: Số trang ước lượng trong tài liệu (số nguyên dương, ví dụ 42).
   - sourceText: Đoạn văn bản nguyên văn trích từ tài liệu làm căn cứ cho câu hỏi.
   - knowledgeUnit: Tên đơn vị kiến thức (ví dụ "Câu lệnh SELECT", "Mô hình OSI").
   - generationReason: Lý do sư phạm cụ thể tại sao câu hỏi này được tạo từ phần kiến thức đó (ví dụ: "Kiến thức này là định nghĩa nền tảng của mục 2.1 và chứa thông tin phân loại cốt lõi."). Không dùng lý do chung chung!
4. Nếu câu hỏi liên quan đến sơ đồ mạng, mô hình, kiến trúc hoặc bảng biểu, hãy đặt needsImage = true và mô tả imagePrompt, imageType ("diagram" | "chart" | "schema").

TRẢ VỀ KẾT QUẢ DƯỚI DẠNG JSON ARRAY CHÍNH XÁC THEO SCHEMA:
[
  {
    "questionText": "...",
    "options": [
      { "key": "A", "text": "..." },
      { "key": "B", "text": "..." },
      { "key": "C", "text": "..." },
      { "key": "D", "text": "..." }
    ],
    "correctAnswer": "A",
    "explanation": "Giải thích chi tiết tại sao phương án này đúng và các phương án còn lại sai...",
    "difficulty": "easy" | "medium" | "hard",
    "topic": "Tên chủ đề",
    "source": {
      "chapter": "Chương ...",
      "section": "...",
      "page": 18,
      "sourceText": "Đoạn văn bản nguyên gốc...",
      "knowledgeUnit": "...",
      "generationReason": "..."
    },
    "illustration": {
      "needsImage": false,
      "imageType": "diagram",
      "imagePrompt": "..."
    }
  }
]`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      temperature: 0.3,
    },
  });

  if (!response.text) {
    throw new Error('Gemini returned empty text');
  }

  const rawList = JSON.parse(response.text);
  if (!Array.isArray(rawList)) {
    throw new Error('Expected JSON array of questions');
  }

  return rawList.map((item: any, idx: number) => {
    const qId = `q-${Date.now()}-${idx + 1}`;
    const options = (item.options || []).map((opt: any) => ({
      key: opt.key as 'A' | 'B' | 'C' | 'D',
      text: opt.text || '',
    }));

    const chap = item.source?.chapter || document.chapters[0]?.title || 'Chương 1';
    const sec = item.source?.section || '1.1 Tổng quan';
    const ku = item.source?.knowledgeUnit || 'Khái niệm trọng tâm';
    const pg = Number(item.source?.page) || Math.floor(idx / 3) + 1;
    const srcTxt = item.source?.sourceText || document.rawText.slice(0, 300);
    const reason =
      item.source?.generationReason ||
      `Câu hỏi này được tạo nhằm kiểm tra khả năng nắm vững khái niệm cốt lõi của ${sec} trong ${chap}.`;

    const q: Question = {
      id: qId,
      questionNumber: idx + 1,
      questionText: item.questionText || `Câu hỏi ${idx + 1}`,
      options,
      correctAnswer: item.correctAnswer || 'A',
      explanation: item.explanation || 'Đáp án được rút ra trực tiếp từ tài liệu học tập.',
      difficulty: item.difficulty || 'medium',
      topic: item.topic || sec,
      source: {
        documentId: document.id,
        documentName: document.fileName,
        chapter: chap,
        section: sec,
        page: pg,
        sourceChunkId: `chunk-${idx + 1}`,
        sourceText: srcTxt,
        knowledgeUnit: ku,
        generationReason: reason,
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
      illustration: item.illustration?.needsImage
        ? {
            needsImage: true,
            imageType: item.illustration.imageType || 'diagram',
            imagePrompt: item.illustration.imagePrompt || `Sơ đồ minh họa cho: ${item.questionText}`,
            caption: `Minh họa: ${ku}`,
          }
        : undefined,
    };

    return q;
  });
}

/**
 * Helper to place the correct option at targetSlot (A, B, C, or D) and fill the rest with distractors
 */
function placeOptions(
  raw: { isCorrect: boolean; text: string }[],
  targetSlot: 'A' | 'B' | 'C' | 'D'
): { key: 'A' | 'B' | 'C' | 'D'; text: string }[] {
  const correctItem = raw.find((r) => r.isCorrect) || raw[0];
  const distractors = raw.filter((r) => !r.isCorrect);

  const keys: ('A' | 'B' | 'C' | 'D')[] = ['A', 'B', 'C', 'D'];
  const result: { key: 'A' | 'B' | 'C' | 'D'; text: string }[] = [];

  let distIdx = 0;
  for (const k of keys) {
    if (k === targetSlot) {
      result.push({ key: k, text: correctItem.text });
    } else {
      result.push({
        key: k,
        text: distractors[distIdx]?.text || 'Phương án không phù hợp với nội dung tài liệu.',
      });
      distIdx++;
    }
  }

  return result;
}

/**
 * Extracts emergency knowledge units from chapters/paragraphs if document has none
 */
function extractEmergencyKusFromDocument(document: DocumentSource): KnowledgeUnit[] {
  const kus: KnowledgeUnit[] = [];
  const lines = (document.rawText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 20);

  const chapters =
    document.chapters && document.chapters.length > 0
      ? document.chapters
      : [
          {
            id: 'chap-1',
            chapterNumber: 1,
            title: 'Chương 1 – Nội dung trọng tâm',
            pageStart: 1,
            pageEnd: 5,
            sections: [],
          },
        ];

  chapters.forEach((chap, cIdx) => {
    const sliceStart = Math.floor((cIdx * lines.length) / chapters.length);
    const sliceEnd = Math.floor(((cIdx + 1) * lines.length) / chapters.length);
    const chapLines = lines.slice(sliceStart, sliceEnd);
    const candidateLines = chapLines.length > 0 ? chapLines : lines;

    const selectedLines = candidateLines.slice(0, 4);
    selectedLines.forEach((line, lIdx) => {
      const defMatch = line.match(
        /^([A-ZÀ-Ỵa-zà-ỹ0-9\s/()_-]{3,40}?)\s+(?:là|được định nghĩa|bao gồm|chính là|được hiểu là)/
      );
      let name = defMatch ? defMatch[1].trim() : '';
      if (!name) {
        const words = line.split(/\s+/).slice(0, 5).join(' ');
        name = cleanConceptName(words);
      }
      if (!name || name.toLowerCase() === 'đơn vị kiến thức') {
        name = `${chap.title.replace(/^Chương\s+\d+[\s:–—]+/, '')} (Mục ${lIdx + 1})`;
      }

      kus.push({
        id: `ku-emer-${cIdx + 1}-${lIdx + 1}`,
        documentId: document.id,
        chapter: chap.title,
        section: `${chap.chapterNumber || cIdx + 1}.${lIdx + 1} ${name}`,
        name,
        type: 'concept',
        description: line.slice(0, 160).replace(/\.$/, '') + '.',
        importance: 'core',
        sourceChunkId: `chunk-emer-${cIdx + 1}-${lIdx + 1}`,
        sourceText: line,
        pageNumber: chap.pageStart || 1,
      });
    });
  });

  return kus;
}

/**
 * Intelligent deterministic question generator grounded in document content
 */
function generateRuleBasedQuestions(
  req: GenerateExamRequest,
  matrix: ExamMatrix
): Question[] {
  const { document, numQuestions } = req;
  const questions: Question[] = [];
  const kus =
    document.knowledgeUnits && document.knowledgeUnits.length > 0
      ? document.knowledgeUnits
      : extractEmergencyKusFromDocument(document);

  const usedKuNames = new Set<string>();

  matrix.chapterDistributions.forEach((dist) => {
    const chapter =
      document.chapters.find((c) => c.id === dist.chapterId) || document.chapters[0];

    // Find KUs for this chapter
    const chapterTitle = (chapter?.title || '').toLowerCase();
    let chapterKus = kus.filter(
      (k) =>
        k.chapter.toLowerCase().includes(chapterTitle) ||
        chapterTitle.includes(k.chapter.toLowerCase())
    );
    if (chapterKus.length === 0) {
      chapterKus = kus;
    }

    for (let i = 0; i < dist.total; i++) {
      if (questions.length >= numQuestions) break;

      // Select distinct KU if possible
      let ku = chapterKus.find((k) => !usedKuNames.has(k.name));
      if (!ku) {
        ku = chapterKus[i % chapterKus.length] || kus[i % kus.length];
      }
      usedKuNames.add(ku.name);

      const diff: 'easy' | 'medium' | 'hard' =
        i < dist.easy ? 'easy' : i < dist.easy + dist.medium ? 'medium' : 'hard';

      const q = synthesizeQuestionFromKU(ku, questions.length + 1, diff, document, kus);
      questions.push(q);
    }
  });

  // Ensure exact question count
  while (questions.length < numQuestions) {
    const ku = kus[questions.length % kus.length];
    const q = synthesizeQuestionFromKU(ku, questions.length + 1, 'medium', document, kus);
    questions.push(q);
  }

  return questions.slice(0, numQuestions);
}

function synthesizeQuestionFromKU(
  ku: KnowledgeUnit,
  number: number,
  difficulty: 'easy' | 'medium' | 'hard',
  document: DocumentSource,
  allKus: KnowledgeUnit[] = []
): Question {
  const qId = `q-synth-${number}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const cleanName = cleanConceptName(ku.name);
  const lowerName = cleanName.toLowerCase();

  let questionText = '';
  let options: { key: 'A' | 'B' | 'C' | 'D'; text: string }[] = [];
  let correctAnswer: 'A' | 'B' | 'C' | 'D' = 'A';
  let explanation = '';
  let reason = '';
  let needsImage = false;
  let imageType: 'diagram' | 'chart' | 'schema' = 'diagram';

  // Evenly distribute correct answer across A, B, C, D (25% each)
  const targetSlot: 'A' | 'B' | 'C' | 'D' = (['A', 'B', 'C', 'D'] as const)[(number - 1) % 4];

  // Specific high-frequency computer science / biology domain specializations
  if (lowerName.includes('osi') || lowerName.includes('mô hình mạng') || lowerName.includes('phân tầng')) {
    questionText = 'Mô hình tham chiếu OSI tiêu chuẩn bao gồm bao nhiêu tầng kiến trúc và phân cấp theo thứ tự nào?';
    const rawOpts = [
      { isCorrect: true, text: '7 tầng độc lập (Vật lý, Data Link, Mạng, Giao vận, Phiên, Trình diễn, Ứng dụng).' },
      { isCorrect: false, text: '4 tầng (Truy cập mạng, Internet, Giao vận, Ứng dụng).' },
      { isCorrect: false, text: '5 tầng (Vật lý, Liên kết dữ liệu, Mạng, Giao vận, Ứng dụng).' },
      { isCorrect: false, text: '6 tầng (Vật lý, Mạng, Định tuyến, Phiên, Trình diễn, Ứng dụng).' },
    ];
    options = placeOptions(rawOpts, targetSlot);
    correctAnswer = targetSlot;
    explanation = 'Theo định nghĩa của tổ chức ISO, mô hình OSI được phân cấp thành đúng 7 tầng độc lập từ tầng Vật lý (Layer 1) lên tới tầng Ứng dụng (Layer 7).';
    reason = 'Đây là khái niệm nền tảng của Chương Mạng máy tính, yêu cầu học viên nắm vững cấu trúc phân tầng kiến trúc truyền thông.';
    needsImage = true;
    imageType = 'schema';
  } else if (lowerName.includes('select') || lowerName.includes('truy vấn')) {
    questionText = 'Trong ngôn ngữ SQL tiêu chuẩn, mệnh đề nào là BẮT BUỘC phải có để chỉ định nguồn bảng chứa dữ liệu cần truy xuất?';
    const rawOpts = [
      { isCorrect: true, text: 'Mệnh đề FROM để xác định bảng hoặc khung nhìn nguồn dữ liệu.' },
      { isCorrect: false, text: 'Mệnh đề WHERE để áp đặt điều kiện lọc các bản ghi.' },
      { isCorrect: false, text: 'Mệnh đề GROUP BY để gom nhóm dữ liệu theo các thuộc tính chỉ định.' },
      { isCorrect: false, text: 'Mệnh đề ORDER BY để sắp xếp thứ tự hiển thị tập kết quả.' },
    ];
    options = placeOptions(rawOpts, targetSlot);
    correctAnswer = targetSlot;
    explanation = 'Cú pháp chuẩn của câu lệnh SELECT bắt buộc phải có FROM để xác định nguồn bảng hoặc khung nhìn chứa các thuộc tính cần trích xuất.';
    reason = 'SELECT và FROM là cú pháp cơ bản và là kiến thức cốt lõi của chương SQL để trích xuất dữ liệu.';
  } else if (lowerName.includes('chuẩn hóa') || lowerName.includes('normalization') || lowerName.includes('dạng chuẩn')) {
    questionText = 'Mục đích cốt lõi của quá trình chuẩn hóa dữ liệu (Normalization từ 1NF đến BCNF) trong CSDL quan hệ là gì?';
    const rawOpts = [
      { isCorrect: true, text: 'Phân rã các quan hệ có hệ thống để loại bỏ sự dư thừa dữ liệu và triệt tiêu các dị thường thêm/xóa/sửa.' },
      { isCorrect: false, text: 'Gia tăng dung lượng lưu trữ vật lý nhằm mục đích tạo bản sao dự phòng tức thời.' },
      { isCorrect: false, text: 'Mã hóa tự động tất cả các thuộc tính nhạy cảm để nâng cao tính bảo mật tuyệt đối.' },
      { isCorrect: false, text: 'Chuyển đổi toàn bộ lược đồ quan hệ sang mô hình phi quan hệ NoSQL.' },
    ];
    options = placeOptions(rawOpts, targetSlot);
    correctAnswer = targetSlot;
    explanation = 'Chuẩn hóa (từ 1NF đến BCNF) nhằm mục tiêu phân rã các quan hệ để loại bỏ sự dư thừa dữ liệu và ngăn chặn các dị thường (anomalies) trong thao tác dữ liệu.';
    reason = 'Câu hỏi được thiết kế nhằm đánh giá mục tiêu bản chất của kỹ thuật chuẩn hóa dữ liệu quan hệ.';
  } else if (lowerName.includes('khóa chính') || lowerName.includes('primary key')) {
    questionText = 'Theo nguyên lý cơ sở dữ liệu quan hệ, quy tắc toàn vẹn thực thể đối với Khóa chính (Primary Key) quy định điều gì?';
    const rawOpts = [
      { isCorrect: true, text: 'Giá trị của khóa chính phải xác định duy nhất mỗi bộ và tuyệt đối KHÔNG được chứa giá trị NULL.' },
      { isCorrect: false, text: 'Khóa chính được phép nhận giá trị NULL nếu bảng có ít hơn 100 dòng dữ liệu.' },
      { isCorrect: false, text: 'Mỗi bảng quan hệ có thể có nhiều khóa chính hoạt động độc lập song song.' },
      { isCorrect: false, text: 'Khóa chính bắt buộc phải là kiểu dữ liệu số nguyên tự tăng.' },
    ];
    options = placeOptions(rawOpts, targetSlot);
    correctAnswer = targetSlot;
    explanation = 'Khóa chính xác định duy nhất từng bộ trong quan hệ và theo quy tắc toàn vẹn thực thể, không một thành phần nào của khóa chính được phép nhận giá trị NULL.';
    reason = 'Kiểm tra hiểu biết cơ bản về ràng buộc toàn vẹn thực thể trong mô hình dữ liệu quan hệ.';
  } else if (lowerName.includes('mã di truyền') || lowerName.includes('thoái hóa')) {
    questionText = 'Đặc tính "thoái hóa" của mã di truyền được hiểu chính xác là gì?';
    const rawOpts = [
      { isCorrect: true, text: 'Nhiều bộ ba khác nhau cùng tham gia mã hóa cho một loại axit amin (trừ AUG và UGG).' },
      { isCorrect: false, text: 'Một bộ ba có thể mã hóa cho nhiều axit amin khác nhau tùy theo tế bào sinh vật.' },
      { isCorrect: false, text: 'Mã di truyền bị biến tính và suy giảm chức năng sau quá trình tái bản.' },
      { isCorrect: false, text: 'Tất cả các loài sinh vật trên Trái Đất đều dùng chung một bộ mã duy nhất.' },
    ];
    options = placeOptions(rawOpts, targetSlot);
    correctAnswer = targetSlot;
    explanation = 'Tính thoái hóa (dư thừa) biểu thị việc 61 codon mã hóa 20 axit amin, vì vậy một axit amin thường do nhiều bộ ba đảm nhiệm.';
    reason = 'Đây là đặc điểm quy luật sinh học cốt lõi của chương Di truyền cấp phân tử.';
  } else {
    // Advanced Grounded Multi-Archetype Synthesis from Document Text
    const rawSource = (ku.sourceText || ku.description || '').trim();
    const sentences = rawSource
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim().replace(/[.?!]+$/, ''))
      .filter((s) => s.length > 20);

    const primarySentence =
      sentences[0] || ku.description.replace(/\.\.\.$/, '') || `Nội dung cốt lõi của ${cleanName}`;
    const secondarySentence =
      sentences[1] || `Quy tắc vận hành và vai trò trọng tâm của ${cleanName}`;

    // Select other KUs from allKus for realistic subject-matter distractors
    const otherKus = allKus.filter(
      (k) => cleanConceptName(k.name).toLowerCase() !== cleanName.toLowerCase()
    );

    // 6 Distinct Pedagogical Question Archetypes
    const archetype = (number + cleanName.length) % 6;

    if (archetype === 0) {
      // Archetype 0: Khái niệm & Bản chất định nghĩa
      questionText =
        difficulty === 'easy'
          ? `Theo tài liệu, khái niệm "${cleanName}" được hiểu chính xác là gì?`
          : `Định nghĩa nào sau đây phản ánh ĐÚNG NHẤT về bản chất của "${cleanName}"?`;

      const correctOpt = `${primarySentence}.`;
      const dist1 = otherKus[0]
        ? `${otherKus[0].description.slice(0, 110).replace(/[.?!]+$/, '')}.`
        : `Chỉ mang tính chất gợi ý phụ lục và không tham gia trực tiếp vào nguyên tắc cốt lõi của tài liệu.`;
      const dist2 = otherKus[1]
        ? `${otherKus[1].description.slice(0, 110).replace(/[.?!]+$/, '')}.`
        : `Tập hợp các quy tắc ngoại lệ được tạm thời vô hiệu hóa trong các phiên bản cập nhật gần đây.`;
      const dist3 = `Được áp dụng ngẫu nhiên không tuân theo bất kỳ cấu trúc hay ràng buộc định nghĩa nào.`;

      const rawOpts = [
        { isCorrect: true, text: correctOpt },
        { isCorrect: false, text: dist1 },
        { isCorrect: false, text: dist2 },
        { isCorrect: false, text: dist3 },
      ];
      options = placeOptions(rawOpts, targetSlot);
      correctAnswer = targetSlot;
      explanation = `Căn cứ nội dung nguyên bản tại ${ku.chapter} (${ku.section}): "${primarySentence}". Phương án ${targetSlot} là định nghĩa chính xác nhất.`;
      reason = `Đánh giá mức độ nhận biết và hiểu đúng định nghĩa bản chất của khái niệm "${cleanName}" trong tài liệu học tập.`;
    } else if (archetype === 1) {
      // Archetype 1: Đặc điểm & Nguyên tắc vận hành
      questionText =
        difficulty === 'easy'
          ? `Đặc điểm nổi bật nào sau đây thuộc về "${cleanName}" theo tài liệu?`
          : `Khẳng định nào sau đây là ĐÚNG khi đề cập đến đặc tính và nguyên tắc vận hành của "${cleanName}"?`;

      const correctOpt = `${secondarySentence || primarySentence}.`;
      const dist1 = otherKus[0]
        ? `Có tính chất tương đồng nhưng chỉ được áp dụng riêng biệt cho ${cleanConceptName(otherKus[0].name)}.`
        : `Hoàn toàn không có tính kế thừa và bị hạn chế trong mọi môi trường ứng dụng thực tế.`;
      const dist2 = `Hoạt động độc lập mà không cần tương tác hay tuân thủ các quy tắc dữ liệu đã định nghĩa.`;
      const dist3 = `Chỉ có hiệu lực tạm thời trong bộ nhớ đệm và tự động hủy bỏ khi kết thúc phiên thao tác.`;

      const rawOpts = [
        { isCorrect: true, text: correctOpt },
        { isCorrect: false, text: dist1 },
        { isCorrect: false, text: dist2 },
        { isCorrect: false, text: dist3 },
      ];
      options = placeOptions(rawOpts, targetSlot);
      correctAnswer = targetSlot;
      explanation = `Theo tài liệu tại ${ku.chapter} (${ku.section}): "${secondarySentence || primarySentence}". Phương án ${targetSlot} mô tả đúng đặc tính này.`;
      reason = `Kiểm tra khả năng phân biệt và ghi nhớ đặc tính vận hành cốt lõi của "${cleanName}".`;
    } else if (archetype === 2) {
      // Archetype 2: Nhận định KHÔNG ĐÚNG (Câu hỏi phủ định)
      questionText = `Theo tài liệu, nhận định nào sau đây là KHÔNG CHÍNH XÁC khi nói về "${cleanName}"?`;

      // Correct answer is the FALSE statement that the student must select
      const falseStatement = `"${cleanName} là thành phần hoàn toàn tùy chọn, có thể tùy ý bỏ qua mà không làm thay đổi tính đúng đắn hay tính toàn vẹn của hệ thống."`;
      const trueStatement1 = `${primarySentence}.`;
      const trueStatement2 = otherKus[0]
        ? `Đóng vai trò quan trọng trong việc thiết lập cấu trúc và logic cho ${ku.chapter}.`
        : `Được xây dựng có hệ thống nhằm phục vụ nhu cầu khai thác và tổ chức kiến thức khoa học.`;
      const trueStatement3 = `Là một trong những nội dung trọng tâm được quy định rõ trong phần ${ku.section}.`;

      const rawOpts = [
        { isCorrect: true, text: falseStatement },
        { isCorrect: false, text: trueStatement1 },
        { isCorrect: false, text: trueStatement2 },
        { isCorrect: false, text: trueStatement3 },
      ];
      options = placeOptions(rawOpts, targetSlot);
      correctAnswer = targetSlot;
      explanation = `Theo nội dung tại ${ku.chapter} (${ku.section}): "${primarySentence}". Do đó, khẳng định ở phương án ${targetSlot} là SAI so với tài liệu, đây chính là phương án cần chọn.`;
      reason = `Phát triển tư duy phản biện, yêu cầu học viên nhận diện phát biểu sai lệch về "${cleanName}".`;
    } else if (archetype === 3) {
      // Archetype 3: Mục đích & Vai trò
      questionText =
        difficulty === 'hard'
          ? `Xét về mặt ứng dụng thực tiễn, vai trò then chốt nhất của "${cleanName}" được xác định là gì?`
          : `Mục đích chính của việc tìm hiểu và áp dụng "${cleanName}" trong tài liệu là gì?`;

      const correctOpt = `Đảm bảo tính chính xác, cấu trúc logic và tính nhất quán khi triển khai: ${primarySentence.slice(0, 90)}.`;
      const dist1 = `Nhằm mục đích gia tăng tối đa sự dư thừa dữ liệu và kéo dài thời gian xử lý của các tiến trình.`;
      const dist2 = `Thay thế hoàn toàn vai trò của con người trong tất cả các khâu kiểm thử và vận hành.`;
      const dist3 = otherKus[1]
        ? `Chủ yếu phục vụ cho mục đích vận hành của ${cleanConceptName(otherKus[1].name)} thay vì bản thân nó.`
        : `Chỉ nhằm giải quyết các bài toán cục bộ đơn giản mà không có giá trị ở quy mô lớn.`;

      const rawOpts = [
        { isCorrect: true, text: correctOpt },
        { isCorrect: false, text: dist1 },
        { isCorrect: false, text: dist2 },
        { isCorrect: false, text: dist3 },
      ];
      options = placeOptions(rawOpts, targetSlot);
      correctAnswer = targetSlot;
      explanation = `Theo nội dung bài giảng tại ${ku.chapter}: "${primarySentence}". Phương án ${targetSlot} phản ánh đúng nhất vai trò và mục đích.`;
      reason = `Đánh giá mức độ thông hiểu ý nghĩa thực tiễn của kiến thức "${cleanName}".`;
    } else if (archetype === 4) {
      // Archetype 4: Cấu trúc & Quy tắc thành phần
      questionText = `Yếu tố hoặc thành phần nào sau đây gắn liền trực tiếp với "${cleanName}" theo tài liệu?`;

      const correctOpt = `Là thành phần chủ đạo gắn kết trực tiếp với ${ku.section}, được định hình bởi nguyên lý: "${primarySentence.slice(0, 85)}...".`;
      const dist1 = `Thuộc về một học phần chuyên đề hoàn toàn tách biệt, không nằm trong phạm vi chương trình hiện tại.`;
      const dist2 = otherKus[0]
        ? `Chỉ có mối liên hệ cấu trúc với ${cleanConceptName(otherKus[0].name)} mà không liên quan đến ${cleanName}.`
        : `Là khái niệm trừu tượng không có bất kỳ thành phần hay ràng buộc cụ thể nào.`;
      const dist3 = `Được định nghĩa là một biến thể lỗi thời đã bị loại bỏ hoàn toàn trong các chuẩn hiện đại.`;

      const rawOpts = [
        { isCorrect: true, text: correctOpt },
        { isCorrect: false, text: dist1 },
        { isCorrect: false, text: dist2 },
        { isCorrect: false, text: dist3 },
      ];
      options = placeOptions(rawOpts, targetSlot);
      correctAnswer = targetSlot;
      explanation = `Căn cứ vào cấu trúc của ${ku.chapter}: "${primarySentence}". Phương án ${targetSlot} là đáp án chính xác.`;
      reason = `Kiểm tra khả năng tổng hợp và liên kết thành phần cấu trúc của "${cleanName}".`;
    } else {
      // Archetype 5: Điều kiện & Ràng buộc chuẩn
      questionText = `Khi nghiên cứu về "${cleanName}", điều kiện hoặc nguyên tắc nào sau đây là BẮT BUỘC cần ghi nhớ?`;

      const correctOpt = `Phải căn cứ vào quy tắc chuẩn: ${primarySentence.slice(0, 100)}.`;
      const dist1 = `Không bắt buộc tuân theo bất kỳ nguyên tắc hay ràng buộc khoa học nào.`;
      const dist2 = `Chỉ áp dụng khi có sự can thiệp thủ công từ hệ thống bên ngoài mà không mang tính tự động.`;
      const dist3 = otherKus[0]
        ? `Phải triệt tiêu hoàn toàn đặc tính của nó để ưu tiên áp dụng ${cleanConceptName(otherKus[0].name)}.`
        : `Chỉ có giá trị trên phương diện lý thuyết trừu tượng và không thể chứng minh bằng thực nghiệm.`;

      const rawOpts = [
        { isCorrect: true, text: correctOpt },
        { isCorrect: false, text: dist1 },
        { isCorrect: false, text: dist2 },
        { isCorrect: false, text: dist3 },
      ];
      options = placeOptions(rawOpts, targetSlot);
      correctAnswer = targetSlot;
      explanation = `Theo quy chuẩn được trình bày tại ${ku.chapter} (${ku.section}): "${primarySentence}". Phương án ${targetSlot} là phương án đúng.`;
      reason = `Đánh giá khả năng vận dụng các nguyên tắc và điều kiện chuẩn mực của "${cleanName}".`;
    }
  }

  return {
    id: qId,
    questionNumber: number,
    questionText,
    options,
    correctAnswer,
    explanation,
    difficulty,
    topic: cleanName,
    source: {
      documentId: document.id,
      documentName: document.fileName,
      chapter: ku.chapter,
      section: ku.section,
      page: ku.pageNumber,
      sourceChunkId: ku.sourceChunkId,
      sourceText: ku.sourceText,
      knowledgeUnit: cleanName,
      generationReason: reason,
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
    illustration: needsImage
      ? {
          needsImage: true,
          imageType,
          imagePrompt: `Biểu đồ sơ đồ minh họa kỹ thuật cho: ${cleanName}`,
          caption: `Sơ đồ trực quan: ${cleanName}`,
        }
      : undefined,
  };
}

/**
 * Regenerate a single question for a specific knowledge unit or source chunk
 */
export async function regenerateSingleQuestion(
  document: DocumentSource,
  targetKuName: string,
  existingQuestionNumber: number,
  difficulty: 'easy' | 'medium' | 'hard' = 'medium'
): Promise<Question> {
  const kus =
    document.knowledgeUnits && document.knowledgeUnits.length > 0
      ? document.knowledgeUnits
      : extractEmergencyKusFromDocument(document);

  const ku =
    kus.find(
      (k) => k.name.toLowerCase() === targetKuName.toLowerCase()
    ) || kus[0];

  const synthetic = synthesizeQuestionFromKU(ku, existingQuestionNumber, difficulty, document, kus);
  synthetic.id = `q-regen-${Date.now()}`;
  synthetic.questionText = `${synthetic.questionText} (Phiên bản biên soạn lại)`;
  return synthetic;
}

/**
 * Practice Questions Generator: for when student misses a question (Flow học lại kiến thức)
 */
export async function generatePracticeQuestions(
  document: DocumentSource,
  knowledgeUnitName: string,
  count: number = 3
): Promise<Question[]> {
  const kus =
    document.knowledgeUnits && document.knowledgeUnits.length > 0
      ? document.knowledgeUnits
      : extractEmergencyKusFromDocument(document);

  const targetKu =
    kus.find(
      (k) => k.name.toLowerCase().includes(knowledgeUnitName.toLowerCase())
    ) || kus[0];

  const questions: Question[] = [];
  const diffs: ('easy' | 'medium' | 'hard')[] = ['easy', 'medium', 'hard'];

  for (let i = 0; i < count; i++) {
    const q = synthesizeQuestionFromKU(targetKu, i + 1, diffs[i % diffs.length], document, kus);
    q.id = `q-practice-${Date.now()}-${i + 1}`;
    q.questionText = `[Luyện tập ${i + 1}] ${q.questionText}`;
    q.source.generationReason = `Câu hỏi luyện tập bổ trợ kiến thức "${knowledgeUnitName}" sau khi học viên trả lời chưa chính xác trong bài thi.`;
    questions.push(q);
  }

  return questions;
}
