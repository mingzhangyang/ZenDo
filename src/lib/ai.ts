import { CategoryId, CategoryScore, ClassifyResult } from './types';

const DEFAULT_ESTIMATED_MINUTES = 25;
const DEFAULT_CLASSIFY_TIMEOUT_MS = 3500;

const CATEGORY_KEYWORDS: Array<{ id: CategoryId; keywords: string[] }> = [
  { id: 'work_execution', keywords: ['项目', '需求', '文档', '代码', '发布', '复盘', 'plan', 'project', 'code', 'release'] },
  { id: 'communication', keywords: ['会议', '沟通', '对齐', '客户', '邮件', 'call', 'meeting', 'email', 'review'] },
  { id: 'learning', keywords: ['学习', '阅读', '课程', '练习', 'read', 'study', 'learn', 'course'] },
  { id: 'health', keywords: ['运动', '跑步', '健身', '睡觉', '散步', 'exercise', 'run', 'gym', 'sleep'] },
  { id: 'life', keywords: ['家庭', '家务', '购物', '做饭', '生活', 'home', 'family', 'cook', 'clean'] },
  { id: 'errands', keywords: ['报销', '缴费', '预约', '快递', '办事', 'pay', 'book', 'appointment', 'delivery'] },
];

const ALL_CATEGORY_IDS: CategoryId[] = [
  'work_execution',
  'communication',
  'learning',
  'life',
  'health',
  'errands',
  'uncategorized',
];

function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.max(0, Math.min(1, score));
}

function normalizeCategories(input: unknown): CategoryScore[] {
  if (!Array.isArray(input)) return [];
  const normalized: CategoryScore[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;
    const rawId = String((entry as { id?: string }).id || '').trim() as CategoryId;
    const rawScore = Number((entry as { score?: number }).score ?? 0);
    if (!ALL_CATEGORY_IDS.includes(rawId)) continue;
    normalized.push({ id: rawId, score: clampScore(rawScore) });
  }
  normalized.sort((a, b) => b.score - a.score);
  return normalized.slice(0, 3);
}

function fallbackClassify(text: string): ClassifyResult {
  const lowered = text.toLowerCase();
  const found = CATEGORY_KEYWORDS
    .map((rule) => ({
      id: rule.id,
      score: rule.keywords.some((k) => lowered.includes(k.toLowerCase())) ? 0.7 : 0,
    }))
    .filter((c) => c.score > 0);

  const categories = found.length > 0 ? found : [{ id: 'uncategorized' as CategoryId, score: 0.5 }];

  return {
    categories,
    estimatedMinutes: DEFAULT_ESTIMATED_MINUTES,
    urgency: 'medium',
    confidence: categories[0]?.score ?? 0.5,
  };
}

type ClassifySource = 'api' | 'fallback';
type FallbackReason = 'empty_text' | 'timeout' | 'request_failed' | 'bad_status' | 'invalid_payload';

export interface ClassifyTodoDetailedResult {
  result: ClassifyResult;
  source: ClassifySource;
  fallbackReason?: FallbackReason;
}

interface ClassifyTodoOptions {
  timeoutMs?: number;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export async function classifyTodoDetailed(
  text: string,
  locale: string,
  options: ClassifyTodoOptions = {},
): Promise<ClassifyTodoDetailedResult> {
  const safeText = text.trim();
  if (!safeText) {
    return {
      result: fallbackClassify(safeText),
      source: 'fallback',
      fallbackReason: 'empty_text',
    };
  }

  try {
    const timeoutMs = Math.max(1000, Math.round(options.timeoutMs ?? DEFAULT_CLASSIFY_TIMEOUT_MS));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch('/api/v1/classify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: safeText, locale }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return {
        result: fallbackClassify(safeText),
        source: 'fallback',
        fallbackReason: 'bad_status',
      };
    }

    const data = (await response.json()) as Partial<ClassifyResult>;
    const categories = normalizeCategories(data.categories);
    if (categories.length === 0) {
      return {
        result: fallbackClassify(safeText),
        source: 'fallback',
        fallbackReason: 'invalid_payload',
      };
    }

    return {
      result: {
        categories,
        estimatedMinutes: Math.max(5, Math.round(Number(data.estimatedMinutes) || DEFAULT_ESTIMATED_MINUTES)),
        urgency: data.urgency === 'low' || data.urgency === 'high' ? data.urgency : 'medium',
        confidence: clampScore(Number(data.confidence) || categories[0].score),
      },
      source: 'api',
    };
  } catch (error) {
    return {
      result: fallbackClassify(safeText),
      source: 'fallback',
      fallbackReason: isAbortError(error) ? 'timeout' : 'request_failed',
    };
  }
}

export async function classifyTodo(text: string, locale: string): Promise<ClassifyResult> {
  const detailed = await classifyTodoDetailed(text, locale);
  return detailed.result;
}
