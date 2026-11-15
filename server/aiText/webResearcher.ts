import { ParsedQuizRequest, WebResearchSource } from '../../src/types';
import { AI_MODEL, callGeminiWithRetry } from '../geminiClient';

export interface WebResearchProgress {
  phase: 'searching' | 'fetching' | 'filtering' | 'done' | 'fallback';
  message: string;
  detail?: string;
}

export interface WebResearchResult {
  sources: WebResearchSource[];
  discoveredCount: number;
  fetchedCount: number;
  failureReason?: string;
}

interface CandidateLink {
  url: string;
  title: string;
}

const TRUSTED_OFFICIAL_DOMAINS = [
  'docs.python.org',
  'developer.mozilla.org',
  'postgresql.org',
  'dev.mysql.com',
  'learn.microsoft.com',
  'kubernetes.io',
  'react.dev',
  'nodejs.org',
  'typescriptlang.org',
  'rfc-editor.org',
  'ietf.org',
  'w3.org',
  'scikit-learn.org',
  'pytorch.org',
  'tensorflow.org',
  'docs.oracle.com',
  'cisco.com',
];

const BLOCKED_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'facebook.com',
  'tiktok.com',
  'instagram.com',
  'pinterest.com',
  'twitter.com',
  'x.com',
  'reddit.com',
  'quora.com',
  'scribd.com',
  'slideshare.net',
  '123docz.net',
  'studocu.com',
];

export function classifyDomainReliability(
  urlStr: string
): WebResearchSource['reliabilityTier'] {
  try {
    const hostname = new URL(urlStr).hostname.toLowerCase();
    if (
      TRUSTED_OFFICIAL_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`)) ||
      hostname.startsWith('docs.')
    ) {
      return 'official_docs';
    }
    if (
      hostname.endsWith('.edu') ||
      hostname.endsWith('.edu.vn') ||
      hostname.endsWith('.ac.uk') ||
      hostname.includes('mit.edu') ||
      hostname.includes('stanford.edu') ||
      hostname.includes('harvard.edu')
    ) {
      return 'academic';
    }
    if (
      hostname.includes('wikipedia.org') ||
      hostname.includes('khanacademy.org') ||
      hostname.includes('coursera.org') ||
      hostname.includes('geeksforgeeks.org') ||
      hostname.includes('w3schools.com') ||
      hostname.includes('vietjack.com') ||
      hostname.includes('loigiaihay.com')
    ) {
      return 'educational';
    }
    if (
      hostname.includes('github.io') ||
      hostname.includes('mozilla.org') ||
      hostname.includes('cloudflare.com') ||
      hostname.includes('ibm.com') ||
      hostname.includes('aws.amazon.com')
    ) {
      return 'technical';
    }
    return 'general';
  } catch {
    return 'general';
  }
}

function scoreCandidateUrl(urlStr: string): number {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    if (BLOCKED_DOMAINS.some((b) => host === b || host.endsWith(`.${b}`))) {
      return -100;
    }
    const tier = classifyDomainReliability(urlStr);
    switch (tier) {
      case 'official_docs':
        return 100;
      case 'academic':
        return 90;
      case 'technical':
        return 75;
      case 'educational':
        return 65;
      default:
        return 30;
    }
  } catch {
    return -100;
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
}

export function extractReadableTextFromHtml(html: string): { title?: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/\s+/g, ' ').trim()) : undefined;

  // Remove non-content tags
  let stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ');

  // Prefer <main> or <article> if sizable
  const mainMatch = stripped.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
  if (mainMatch && mainMatch[1].length > 500) {
    stripped = mainMatch[1];
  }

  const plain = decodeHtmlEntities(
    stripped
      .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|section|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title: pageTitle, text: plain };
}

function isUsefulAcademicText(text: string, topic: string): boolean {
  if (!text || text.length < 250) return false;
  const lower = text.toLowerCase();
  if (
    lower.includes('enable javascript') ||
    lower.includes('access denied') ||
    lower.includes('just a moment...') ||
    lower.includes('verify you are human') ||
    lower.includes('403 forbidden') ||
    lower.includes('404 not found')
  ) {
    return false;
  }

  // Ensure basic topical overlap
  const tokens = topic
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((t) => t.length >= 2);

  if (tokens.length === 0) return true;
  const matches = tokens.filter((t) => lower.includes(t));
  return matches.length >= 1;
}

async function fetchSingleWebPage(
  candidate: CandidateLink,
  topic: string,
  timeoutMs: number = 5500
): Promise<WebResearchSource | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(candidate.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; QuizAI-ResearchBot/1.0; +https://quizai.edu)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
      },
    });

    if (!res.ok) {
      return null;
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return null;
    }

    const rawBody = await res.text();
    const finalUrl = res.url || candidate.url;

    // Re-check blocked domains after redirect resolution
    if (scoreCandidateUrl(finalUrl) < 0) {
      return null;
    }

    let extractedTitle = candidate.title;
    let extractedText = rawBody;
    if (contentType.includes('text/html')) {
      const parsed = extractReadableTextFromHtml(rawBody);
      extractedText = parsed.text;
      if (parsed.title && parsed.title.length > 3) {
        extractedTitle = parsed.title;
      }
    }

    if (!isUsefulAcademicText(extractedText, topic)) {
      return null;
    }

    const normalizedContent = extractedText.slice(0, 4500).trim();
    const domain = new URL(finalUrl).hostname.replace(/^www\./, '');

    return {
      id: `src-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: extractedTitle || domain,
      url: finalUrl,
      domain,
      fetchedContent: normalizedContent,
      usedExcerpts: [],
      retrievedAt: new Date().toISOString(),
      reliabilityTier: classifyDomainReliability(finalUrl),
      fetchMethod: 'direct_fetch',
    };
  } catch (err: any) {
    console.warn(`[QuizAI][web-research] Failed to fetch ${candidate.url}: ${err?.message || err}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function researchWebSources(
  request: ParsedQuizRequest,
  onProgress?: (p: WebResearchProgress) => void
): Promise<WebResearchResult> {
  if (!request.needsWebResearch) {
    onProgress?.({
      phase: 'fallback',
      message: 'Chuyển sang chế độ AI tổng hợp theo cấu hình yêu cầu.',
    });
    return {
      sources: [],
      discoveredCount: 0,
      fetchedCount: 0,
      failureReason: 'Người dùng hoặc cấu hình không yêu cầu tra cứu web.',
    };
  }

  onProgress?.({
    phase: 'searching',
    message: `Đang tìm kiếm tài liệu học thuật & chính thức về "${request.topic}"...`,
    detail: request.knowledgeAreas.slice(0, 4).join(', '),
  });

  let candidates: CandidateLink[] = [];

  try {
    const searchQueryPrompt = `Hãy tìm kiếm các nguồn tài liệu chính thức, giáo trình đại học, tài liệu kỹ thuật hoặc bách khoa học thuật uy tín nhất về chủ đề: "${request.topic}" (Môn học: ${request.subject}).
Các mảng kiến thức trọng tâm cần tra cứu: ${request.knowledgeAreas.join('; ')}.
Tóm tắt ngắn gọn các khái niệm cốt lõi từ nguồn tìm được.`;

    const searchResponse = await callGeminiWithRetry({
      step: 'web-search-discovery',
      timeoutMs: 15000,
      maxRetries: 0,
      fn: (ai) =>
        ai.models.generateContent({
          model: AI_MODEL,
          contents: searchQueryPrompt,
          config: {
            tools: [{ googleSearch: {} }],
          },
        }),
    });

    const chunks = searchResponse.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const seenUrls = new Set<string>();

    for (const chunk of chunks) {
      const uri = chunk?.web?.uri;
      const title = chunk?.web?.title || '';
      if (!uri || !uri.startsWith('http')) continue;
      const normalizedUrl = uri.trim();
      if (seenUrls.has(normalizedUrl)) continue;
      seenUrls.add(normalizedUrl);
      candidates.push({ url: normalizedUrl, title });
    }
  } catch (err: any) {
    console.warn(`[QuizAI][web-research] Google Search grounding unavailable: ${err?.message || err}`);
    onProgress?.({
      phase: 'fallback',
      message: 'Không thể truy vấn tìm kiếm web, chuyển sang AI tự biên soạn nội dung.',
      detail: err?.message,
    });
    return {
      sources: [],
      discoveredCount: 0,
      fetchedCount: 0,
      failureReason: err?.message || 'Dịch vụ tìm kiếm web tạm thời không khả dụng.',
    };
  }

  if (candidates.length === 0) {
    onProgress?.({
      phase: 'fallback',
      message: 'Không tìm thấy liên kết web phù hợp. Chuyển sang chế độ AI tổng hợp.',
    });
    return {
      sources: [],
      discoveredCount: 0,
      fetchedCount: 0,
      failureReason: 'Không tìm thấy nguồn web công khai phù hợp cho chủ đề này.',
    };
  }

  // Sort by domain reliability score & filter out blocked domains
  const rankedCandidates = candidates
    .map((c) => ({ ...c, score: scoreCandidateUrl(c.url) }))
    .filter((c) => c.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  onProgress?.({
    phase: 'fetching',
    message: `Tìm thấy ${rankedCandidates.length} nguồn tiềm năng. Đang đọc nội dung thực tế từng trang...`,
    detail: rankedCandidates.map((c) => c.title || c.url).slice(0, 3).join(' • '),
  });

  // Fetch up to 5 pages concurrently with strict timeout
  const settled = await Promise.allSettled(
    rankedCandidates.map((c) => fetchSingleWebPage(c, request.topic, 5500))
  );

  const validSources: WebResearchSource[] = [];
  const seenFinalUrls = new Set<string>();
  const seenDomains = new Set<string>();

  for (const item of settled) {
    if (item.status === 'fulfilled' && item.value) {
      const src = item.value;
      const canonical = src.url.split('#')[0];
      if (seenFinalUrls.has(canonical)) continue;
      // Avoid multiple pages from exact same domain unless we have fewer than 2 sources
      if (seenDomains.has(src.domain) && validSources.length >= 2) continue;

      seenFinalUrls.add(canonical);
      seenDomains.add(src.domain);
      validSources.push(src);
      if (validSources.length >= 3) break;
    }
  }

  if (validSources.length === 0) {
    onProgress?.({
      phase: 'fallback',
      message: 'Không thể đọc trực tiếp nội dung từ các trang web (bị chặn hoặc timeout). Chuyển sang chế độ AI tổng hợp.',
    });
    return {
      sources: [],
      discoveredCount: candidates.length,
      fetchedCount: 0,
      failureReason: 'Các trang web được tìm thấy không thể truy xuất nội dung trực tiếp hoặc bị timeout.',
    };
  }

  onProgress?.({
    phase: 'done',
    message: `Đã đọc và xác thực nội dung thực tế từ ${validSources.length} nguồn web đáng tin cậy.`,
    detail: validSources.map((s) => s.domain).join(', '),
  });

  return {
    sources: validSources,
    discoveredCount: candidates.length,
    fetchedCount: validSources.length,
  };
}
