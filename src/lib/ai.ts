import type { CategoryId, CategoryScore, ClassifyResult } from './types';
import { CATEGORY_IDS, scoreByRules } from './categoryRules';

const DEFAULT_ESTIMATED_MINUTES = 25;
const DEFAULT_CLASSIFY_TIMEOUT_MS = 3500;

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
    if (!CATEGORY_IDS.includes(rawId)) continue;
    normalized.push({ id: rawId, score: clampScore(rawScore) });
  }
  normalized.sort((a, b) => b.score - a.score);
  return normalized.slice(0, 3);
}

function fallbackClassify(text: string): ClassifyResult {
  const categories = scoreByRules(text);
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
