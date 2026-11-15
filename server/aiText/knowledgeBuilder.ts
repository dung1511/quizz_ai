import { ThinkingLevel, Type } from '@google/genai';
import {
  DocumentChapter,
  DocumentChunk,
  DocumentSection,
  DocumentSource,
  KnowledgeChapterItem,
  KnowledgeOriginType,
  KnowledgePackage,
  KnowledgeSectionItem,
  KnowledgeUnit,
  ParsedQuizRequest,
  PipelineStepEvent,
  WebResearchSource,
} from '../../src/types';
import {
  AI_MODEL,
  AiServiceError,
  callGeminiWithRetry,
  extractJsonFromText,
} from '../geminiClient';
import { getKnowledgePackage, saveKnowledgePackage } from '../storage';
import { researchWebSources } from './webResearcher';

interface RawKnowledgeChapter {
  chapterNumber?: number;
  title?: string;
  summary?: string;
  sections?: {
    sectionNumber?: string;
    title?: string;
    concepts?: { name?: string; definition?: string }[];
    explanation?: string;
    example?: string;
    keyPoints?: string[];
    sourceRefIds?: string[];
    usedQuotes?: string[];
  }[];
}

interface RawKnowledgeDraft {
  chapters?: RawKnowledgeChapter[];
}

function detectTimeSensitiveWarning(request: ParsedQuizRequest): string | undefined {
  const combined = `${request.rawPrompt} ${request.topic} ${request.knowledgeAreas.join(' ')}`.toLowerCase();
  const timeSensitivePatterns = [
    '2025',
    '2026',
    '2027',
    'mới nhất',
    'hiện nay',
    'hiện hành',
    'luật mới',
    'nghị định',
    'thông tư',
    'vừa ra mắt',
    'tin tức',
    'cập nhật',
    'latest',
    'current',
  ];

  if (timeSensitivePatterns.some((p) => combined.includes(p))) {
    return 'Chủ đề có yếu tố cập nhật theo thời gian nhưng hệ thống không truy xuất được nguồn web trực tiếp. Bạn nên rà soát lại số liệu, phiên bản hoặc quy định mới nhất trong bản xem trước trước khi tạo đề.';
  }
  return undefined;
}

export function compileChaptersToMarkdown(
  topic: string,
  chapters: KnowledgeChapterItem[]
): string {
  const parts: string[] = [`# ${topic}`, ''];

  for (const chap of chapters) {
    parts.push(`Chương ${chap.chapterNumber}: ${chap.title.replace(/^Chương\s+\d+[\s:–—]+/i, '')}`);
    if (chap.summary) {
      parts.push(chap.summary);
    }
    parts.push('');

    for (const sec of chap.sections) {
      parts.push(`${sec.sectionNumber} ${sec.title}`);
      if (sec.concepts && sec.concepts.length > 0) {
        for (const c of sec.concepts) {
          parts.push(`- ${c.name}: ${c.definition}`);
        }
      }
      if (sec.explanation) {
        parts.push(sec.explanation);
      }
      if (sec.example) {
        parts.push(`Ví dụ minh họa: ${sec.example}`);
      }
      if (sec.keyPoints && sec.keyPoints.length > 0) {
        parts.push('Kiến thức trọng tâm:');
        for (const kp of sec.keyPoints) {
          parts.push(`• ${kp}`);
        }
      }
      parts.push('');
    }
  }

  return parts.join('\n').trim();
}

export function organizeKnowledge(
  chaptersInput: KnowledgeChapterItem[],
  request: ParsedQuizRequest,
  webSources: WebResearchSource[],
  contentOrigin: KnowledgeOriginType,
  options: {
    existingId?: string;
    existingCreatedAt?: string;
    freshnessWarning?: string;
    customMarkdown?: string;
  } = {}
): KnowledgePackage {
  const pkgId = options.existingId || `kp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const docId = `doc-ai-${pkgId}`;
  const nowIso = new Date().toISOString();

  const normalizedChapters: KnowledgeChapterItem[] = chaptersInput.map((chap, cIdx) => {
    const chapNum = chap.chapterNumber || cIdx + 1;
    const cleanTitle = chap.title.replace(/^Chương\s+\d+[\s:–—]+/i, '').trim() || `Chuyên đề ${chapNum}`;
    const fullChapTitle = `Chương ${chapNum} – ${cleanTitle}`;

    const sections: KnowledgeSectionItem[] = (chap.sections || []).map((sec, sIdx) => ({
      id: sec.id || `sec-${chapNum}-${sIdx + 1}`,
      sectionNumber: sec.sectionNumber || `${chapNum}.${sIdx + 1}`,
      title: sec.title || `Mục ${chapNum}.${sIdx + 1}`,
      concepts: (sec.concepts || []).filter((c) => c.name && c.definition),
      explanation: sec.explanation || '',
      example: sec.example || undefined,
      keyPoints: (sec.keyPoints || []).filter(Boolean),
      sourceRefIds: sec.sourceRefIds || [],
    }));

    return {
      id: chap.id || `chap-${chapNum}-${cIdx + 1}`,
      chapterNumber: chapNum,
      title: fullChapTitle,
      summary: chap.summary || '',
      sections,
    };
  });

  const compiledMarkdown =
    options.customMarkdown && options.customMarkdown.trim().length > 40
      ? options.customMarkdown.trim()
      : compileChaptersToMarkdown(request.topic, normalizedChapters);

  // Build DocumentSource (chapters, chunks, knowledgeUnits) for full traceability
  const docChapters: DocumentChapter[] = [];
  const docChunks: DocumentChunk[] = [];
  const docKus: KnowledgeUnit[] = [];
  let runningPage = 1;

  for (const chap of normalizedChapters) {
    const pageStart = runningPage;
    const docSections: DocumentSection[] = [];

    for (const sec of chap.sections) {
      const secPage = runningPage;
      docSections.push({
        id: sec.id,
        chapterId: chap.id,
        sectionNumber: sec.sectionNumber,
        title: sec.title,
        page: secPage,
        summary: sec.explanation.slice(0, 140),
      });

      const sectionTextBlocks: string[] = [];
      for (const c of sec.concepts) {
        sectionTextBlocks.push(`${c.name}: ${c.definition}`);
      }
      if (sec.explanation) sectionTextBlocks.push(sec.explanation);
      if (sec.example) sectionTextBlocks.push(`Ví dụ: ${sec.example}`);
      if (sec.keyPoints.length > 0) {
        sectionTextBlocks.push(`Trọng tâm: ${sec.keyPoints.join(' ')}`);
      }
      const chunkContent = sectionTextBlocks.join('\n').trim() || sec.title;
      const chunkId = `chunk-${chap.chapterNumber}-${sec.sectionNumber.replace(/[^a-zA-Z0-9]/g, '_')}`;

      docChunks.push({
        id: chunkId,
        documentId: docId,
        chapterId: chap.id,
        chapterTitle: chap.title,
        sectionId: sec.id,
        sectionTitle: `${sec.sectionNumber} ${sec.title}`,
        pageNumber: secPage,
        content: chunkContent,
      });

      if (sec.concepts.length > 0) {
        for (const concept of sec.concepts) {
          docKus.push({
            id: `ku-${docKus.length + 1}`,
            documentId: docId,
            chapter: chap.title,
            section: `${sec.sectionNumber} ${sec.title}`,
            name: concept.name,
            type: 'definition',
            description: concept.definition.slice(0, 200),
            importance: 'core',
            sourceChunkId: chunkId,
            sourceText: `${concept.name}: ${concept.definition}${sec.explanation ? ' ' + sec.explanation.slice(0, 220) : ''}`,
            pageNumber: secPage,
          });
        }
      } else {
        docKus.push({
          id: `ku-${docKus.length + 1}`,
          documentId: docId,
          chapter: chap.title,
          section: `${sec.sectionNumber} ${sec.title}`,
          name: sec.title,
          type: 'concept',
          description: (sec.explanation || sec.keyPoints[0] || sec.title).slice(0, 200),
          importance: 'core',
          sourceChunkId: chunkId,
          sourceText: chunkContent.slice(0, 350),
          pageNumber: secPage,
        });
      }

      runningPage++;
    }

    docChapters.push({
      id: chap.id,
      chapterNumber: chap.chapterNumber,
      title: chap.title,
      pageStart,
      pageEnd: Math.max(pageStart, runningPage - 1),
      sections: docSections,
    });
  }

  const documentSource: DocumentSource = {
    id: docId,
    title: request.topic,
    fileName:
      contentOrigin === 'WEB'
        ? `TaiLieu_Web_${request.topic.slice(0, 30).replace(/\s+/g, '_')}.txt`
        : `TaiLieu_AI_${request.topic.slice(0, 30).replace(/\s+/g, '_')}.txt`,
    fileType: 'txt',
    fileSize: `${Math.max(1, Math.round(compiledMarkdown.length / 1024))} KB`,
    pageCount: Math.max(1, runningPage - 1),
    status: 'READY',
    rawText: compiledMarkdown,
    chapters: docChapters,
    chunks: docChunks,
    knowledgeUnits: docKus,
  };

  const originNotice =
    contentOrigin === 'WEB'
      ? `Nội dung học tập được tổng hợp và đối chiếu từ ${webSources.length} nguồn tài liệu web công khai đã truy xuất trực tiếp.`
      : 'Nội dung học tập này do mô hình AI tự tổng hợp từ kiến thức nền tảng (không truy xuất được nguồn web trực tiếp). Không có URL hoặc trích dẫn ngoài được bịa đặt — vui lòng rà soát trước khi tạo đề.';

  return {
    id: pkgId,
    requestId: request.id,
    request,
    topic: request.topic,
    contentOrigin,
    originNotice,
    freshnessWarning: options.freshnessWarning,
    chapters: normalizedChapters,
    webSources,
    compiledMarkdown,
    documentSource,
    createdAt: options.existingCreatedAt || nowIso,
    updatedAt: nowIso,
    status: 'BUILT',
  };
}

export async function buildKnowledgeContent(
  request: ParsedQuizRequest,
  onProgress?: (event: PipelineStepEvent) => void
): Promise<KnowledgePackage> {
  const emit = (
    step: string,
    status: PipelineStepEvent['status'],
    message: string,
    detail?: string
  ) => {
    onProgress?.({
      step,
      status,
      message,
      detail,
      timestamp: new Date().toISOString(),
    });
  };

  // Step 1: Web Research
  emit(
    'web_research',
    'running',
    `Đang nghiên cứu nguồn tài liệu chính thức & học thuật về "${request.topic}"...`
  );

  const research = await researchWebSources(request, (p) => {
    emit(
      'web_research',
      p.phase === 'fallback' ? 'warning' : p.phase === 'done' ? 'completed' : 'running',
      p.message,
      p.detail
    );
  });

  const hasWebSources = research.sources.length > 0;
  const contentOrigin: KnowledgeOriginType = hasWebSources ? 'WEB' : 'AI_GENERATED';
  const freshnessWarning = !hasWebSources ? detectTimeSensitiveWarning(request) : undefined;

  // Step 2: AI Knowledge Synthesis
  emit(
    'knowledge_synthesis',
    'running',
    hasWebSources
      ? `Đang tổng hợp nội dung học tập có cấu trúc từ ${research.sources.length} nguồn web đã đọc...`
      : 'Đang biên soạn nội dung học tập chuyên sâu từ kiến thức nền tảng của AI...',
    research.failureReason
  );

  const webContextBlock = hasWebSources
    ? research.sources
        .map(
          (src, idx) =>
            `[NGUỒN ${src.id}] (${src.title} | ${src.url})\nNỘI DUNG THỰC TẾ ĐÃ ĐỌC:\n"""\n${src.fetchedContent}\n"""`
        )
        .join('\n\n')
    : '';

  const systemInstruction = hasWebSources
    ? `Bạn là Giảng viên Đại học và Kỹ sư biên soạn giáo trình.
Nhiệm vụ: Tổng hợp tài liệu học tập có cấu trúc chặt chẽ (Chương -> Mục -> Khái niệm & Định nghĩa -> Giải thích -> Ví dụ -> Điểm trọng tâm) DỰA TRÊN nội dung thực tế của các nguồn web được cung cấp.
Quy tắc bắt buộc:
- Chỉ sử dụng thông tin có căn cứ từ các nguồn đã cung cấp và kiến thức chuẩn xác liên quan trực tiếp đến chủ đề.
- Với mỗi mục, ghi rõ "sourceRefIds" là mảng ID của các nguồn đã tham khảo (ví dụ: ["${research.sources[0].id}"]) và "usedQuotes" là 1-2 đoạn trích ngắn từ nguồn.
- Không tự bịa URL mới.
- Ngôn ngữ trình bày: ${request.language}.`
    : `Bạn là Giảng viên Đại học và Chuyên gia biên soạn học liệu.
Nhiệm vụ: Biên soạn một tài liệu học tập hoàn chỉnh, chính xác về mặt học thuật để làm cơ sở tạo ${request.questionCount} câu hỏi trắc nghiệm cho chủ đề "${request.topic}" (Đối tượng: ${request.audience}).
Quy tắc bắt buộc:
- Tổ chức rõ ràng thành các Chương (tương ứng với các mảng kiến thức trọng tâm), mỗi Chương có các Mục kiến thức.
- Mỗi Mục bắt buộc có: Khái niệm & Định nghĩa rõ ràng, Nội dung giải thích chi tiết, Ví dụ minh họa thực tế, và Danh sách các kiến thức trọng tâm để tạo câu hỏi.
- TUYỆT ĐỐI KHÔNG tự bịa đặt URL, tên trang web, hoặc trích dẫn tài liệu giả. Đặt sourceRefIds = [] và usedQuotes = [].
- Ngôn ngữ trình bày: ${request.language}.`;

  const userPrompt = `Chủ đề: ${request.topic}
Môn học / Lĩnh vực: ${request.subject}
Đối tượng học: ${request.audience}
Phạm vi kiến thức trọng tâm cần bao phủ:
${request.knowledgeAreas.map((a, i) => `${i + 1}. ${a}`).join('\n')}
Tổng số câu hỏi dự kiến sẽ sinh từ tài liệu này: ${request.questionCount} câu (Dễ: ${request.difficulty.easy}, Trung bình: ${request.difficulty.medium}, Khó: ${request.difficulty.hard}).

${hasWebSources ? `DỮ LIỆU NGUỒN WEB ĐÃ TRUY XUẤT:\n${webContextBlock}` : 'Hãy biên soạn nội dung học tập chi tiết, mạch lạc, đủ chiều sâu để bao phủ cả câu hỏi dễ, trung bình và khó.'}`;

  const draft = await callGeminiWithRetry<RawKnowledgeDraft>({
    step: 'build-knowledge',
    timeoutMs: 75000,
    maxRetries: 2,
    fn: (ai, model) =>
      ai.models.generateContent({
        model,
        contents: userPrompt,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              chapters: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    chapterNumber: { type: Type.INTEGER },
                    title: { type: Type.STRING },
                    summary: { type: Type.STRING },
                    sections: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          sectionNumber: { type: Type.STRING },
                          title: { type: Type.STRING },
                          concepts: {
                            type: Type.ARRAY,
                            items: {
                              type: Type.OBJECT,
                              properties: {
                                name: { type: Type.STRING },
                                definition: { type: Type.STRING },
                              },
                              required: ['name', 'definition'],
                            },
                          },
                          explanation: { type: Type.STRING },
                          example: { type: Type.STRING },
                          keyPoints: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                          },
                          sourceRefIds: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                          },
                          usedQuotes: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                          },
                        },
                        required: [
                          'sectionNumber',
                          'title',
                          'concepts',
                          'explanation',
                          'keyPoints',
                        ],
                      },
                    },
                  },
                  required: ['chapterNumber', 'title', 'summary', 'sections'],
                },
              },
            },
            required: ['chapters'],
          },
        },
      }),
    transform: (res) => {
      if (!res.text) {
        throw new AiServiceError('Mô hình AI không trả về nội dung học tập.', {
          statusCode: 502,
          code: 'EMPTY_KNOWLEDGE',
          step: 'build-knowledge',
          retryable: true,
        });
      }
      const parsed = extractJsonFromText<RawKnowledgeDraft>(res.text, 'build-knowledge');
      if (!parsed.chapters || !Array.isArray(parsed.chapters) || parsed.chapters.length === 0) {
        throw new AiServiceError('Nội dung học tập biên soạn thiếu cấu trúc chương mục.', {
          statusCode: 422,
          code: 'INVALID_KNOWLEDGE_STRUCTURE',
          step: 'build-knowledge',
          retryable: true,
        });
      }
      return parsed;
    },
  });

  emit('knowledge_organize', 'running', 'Đang chuẩn hóa cấu trúc chương mục & trích xuất đơn vị kiến thức...');

  // Attach usedExcerpts back to webSources
  const validSourceIds = new Set(research.sources.map((s) => s.id));
  const formattedChapters: KnowledgeChapterItem[] = (draft.chapters || []).map((c, cIdx) => {
    const chapNum = c.chapterNumber || cIdx + 1;
    return {
      id: `chap-${chapNum}-${cIdx + 1}`,
      chapterNumber: chapNum,
      title: c.title || `Chuyên đề ${chapNum}`,
      summary: c.summary || '',
      sections: (c.sections || []).map((s, sIdx) => {
        const refIds = (s.sourceRefIds || []).filter((id) => validSourceIds.has(id));
        if (hasWebSources && s.usedQuotes && s.usedQuotes.length > 0) {
          for (const src of research.sources) {
            if (refIds.includes(src.id) || refIds.length === 0) {
              for (const q of s.usedQuotes) {
                if (q && q.trim().length > 10 && !src.usedExcerpts.includes(q.trim())) {
                  src.usedExcerpts.push(q.trim());
                }
              }
            }
          }
        }
        return {
          id: `sec-${chapNum}-${sIdx + 1}`,
          sectionNumber: s.sectionNumber || `${chapNum}.${sIdx + 1}`,
          title: s.title || `Mục ${chapNum}.${sIdx + 1}`,
          concepts: (s.concepts || [])
            .filter((kc) => kc.name && kc.definition)
            .map((kc) => ({
              name: kc.name!.trim(),
              definition: kc.definition!.trim(),
            })),
          explanation: (s.explanation || '').trim(),
          example: s.example?.trim() || undefined,
          keyPoints: (s.keyPoints || []).map((kp) => kp.trim()).filter(Boolean),
          sourceRefIds: hasWebSources ? refIds : [],
        };
      }),
    };
  });

  const pkg = organizeKnowledge(
    formattedChapters,
    request,
    hasWebSources ? research.sources : [],
    contentOrigin,
    { freshnessWarning }
  );

  saveKnowledgePackage(pkg);

  emit(
    'knowledge_organize',
    'completed',
    `Hoàn tất biên soạn ${pkg.chapters.length} chương và ${pkg.documentSource.knowledgeUnits.length} đơn vị kiến thức.`
  );

  return pkg;
}

export function updateKnowledgePackageFromUserEdit(
  pkgId: string,
  edits: {
    chapters?: KnowledgeChapterItem[];
    compiledMarkdown?: string;
    request?: ParsedQuizRequest;
  }
): KnowledgePackage {
  const existing = getKnowledgePackage(pkgId);
  if (!existing) {
    throw new AiServiceError('Không tìm thấy gói nội dung kiến thức để cập nhật.', {
      statusCode: 404,
      code: 'KNOWLEDGE_NOT_FOUND',
      step: 'confirm-knowledge',
      retryable: false,
    });
  }

  let updatedChapters = edits.chapters && edits.chapters.length > 0 ? edits.chapters : existing.chapters;

  // If user edited raw markdown directly without modifying structured chapters,
  // update the section explanations / chunks cleanly so questions reflect user edits
  if (edits.compiledMarkdown && edits.compiledMarkdown.trim() !== existing.compiledMarkdown.trim() && !edits.chapters) {
    const editedBlocks = edits.compiledMarkdown
      .split(/\n(?=Chương\s+\d+|##?\s+)/i)
      .map((b) => b.trim())
      .filter((b) => b.length > 20 && !b.startsWith('# '));

    if (editedBlocks.length > 0) {
      updatedChapters = editedBlocks.map((block, idx) => {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
        const heading = lines[0]?.replace(/^#+\s*/, '') || `Chương ${idx + 1}`;
        const body = lines.slice(1).join('\n').trim() || heading;
        const existingChap = existing.chapters[idx];

        return {
          id: existingChap?.id || `chap-edited-${idx + 1}`,
          chapterNumber: idx + 1,
          title: heading,
          summary: existingChap?.summary || body.slice(0, 120),
          sections:
            existingChap && existingChap.sections.length > 0
              ? existingChap.sections.map((sec, sIdx) =>
                  sIdx === 0 ? { ...sec, explanation: body } : sec
                )
              : [
                  {
                    id: `sec-edited-${idx + 1}-1`,
                    sectionNumber: `${idx + 1}.1`,
                    title: heading.replace(/^Chương\s+\d+[\s:–—]+/i, ''),
                    concepts: [{ name: heading.replace(/^Chương\s+\d+[\s:–—]+/i, ''), definition: body.slice(0, 220) }],
                    explanation: body,
                    keyPoints: [body.slice(0, 160)],
                    sourceRefIds: existing.webSources.map((s) => s.id),
                  },
                ],
        };
      });
    }
  }

  const updated = organizeKnowledge(
    updatedChapters,
    edits.request || existing.request,
    existing.webSources,
    existing.contentOrigin,
    {
      existingId: existing.id,
      existingCreatedAt: existing.createdAt,
      freshnessWarning: existing.freshnessWarning,
      customMarkdown: edits.compiledMarkdown,
    }
  );
  updated.status = 'CONFIRMED';

  saveKnowledgePackage(updated);
  return updated;
}
