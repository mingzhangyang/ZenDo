const CATEGORY_IDS = [
  'work_execution',
  'communication',
  'learning',
  'life',
  'health',
  'errands',
  'uncategorized',
];

const MAX_REQUEST_BODY_BYTES = 8 * 1024;
const MAX_TODO_TEXT_BYTES = 2 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 40;
const MAX_LOG_ERROR_LENGTH = 180;

const ipRequestWindows = new Map();
let lastRateLimitCleanupAt = 0;

const CATEGORY_KEYWORDS = [
  { id: 'work_execution', keywords: ['项目', '需求', '文档', '代码', '发布', '复盘', 'plan', 'project', 'code'] },
  { id: 'communication', keywords: ['会议', '沟通', '客户', '邮件', 'review', 'meeting', 'email', 'call'] },
  { id: 'learning', keywords: ['学习', '阅读', '课程', '练习', 'learn', 'study', 'read', 'course'] },
  { id: 'health', keywords: ['运动', '跑步', '健身', '睡觉', 'exercise', 'run', 'gym', 'sleep'] },
  { id: 'life', keywords: ['家庭', '家务', '购物', '做饭', '生活', 'home', 'family', 'cook', 'clean'] },
  { id: 'errands', keywords: ['报销', '缴费', '预约', '快递', '办事', 'pay', 'book', 'delivery'] },
];

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

function byteLength(input) {
  return new TextEncoder().encode(String(input ?? '')).length;
}

function getClientIp(request) {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp && cfIp.trim()) return cfIp.trim();

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  return 'unknown';
}

function anonymizeIp(ip) {
  if (!ip || ip === 'unknown') return 'unknown';
  if (ip.includes(':')) {
    const chunks = ip.split(':').filter(Boolean);
    return `${chunks.slice(0, 3).join(':')}:*`;
  }
  const parts = ip.split('.');
  if (parts.length !== 4) return ip;
  return `${parts[0]}.${parts[1]}.x.x`;
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toErrorMessage(error) {
  if (error instanceof Error) return error.message.slice(0, MAX_LOG_ERROR_LENGTH);
  return String(error ?? '').slice(0, MAX_LOG_ERROR_LENGTH);
}

function logClassifyEvent(event) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event: 'classify_request',
    ...event,
  });
  if (event.level === 'error') {
    console.error(line);
    return;
  }
  console.log(line);
}

function cleanupRateLimitWindows(now) {
  if (now - lastRateLimitCleanupAt < RATE_LIMIT_WINDOW_MS || ipRequestWindows.size === 0) return;
  lastRateLimitCleanupAt = now;

  for (const [ip, state] of ipRequestWindows) {
    if (state.resetAt <= now) ipRequestWindows.delete(ip);
  }
}

function checkRateLimit(ip) {
  const now = Date.now();
  cleanupRateLimitWindows(now);

  const existing = ipRequestWindows.get(ip);

  if (!existing || existing.resetAt <= now) {
    ipRequestWindows.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { limited: false, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > RATE_LIMIT_MAX_REQUESTS) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return { limited: false, retryAfterSeconds: 0 };
}

function normalizeCategories(categories) {
  if (!Array.isArray(categories)) return [];
  const normalized = [];
  for (const item of categories) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    if (!CATEGORY_IDS.includes(id)) continue;
    const score = Math.max(0, Math.min(1, Number(item.score) || 0));
    normalized.push({ id, score });
  }
  normalized.sort((a, b) => b.score - a.score);
  return normalized.slice(0, 3);
}

function fallbackClassify(text) {
  const lowered = String(text || '').toLowerCase();
  const matched = CATEGORY_KEYWORDS
    .map((rule) => ({
      id: rule.id,
      score: rule.keywords.some((keyword) => lowered.includes(keyword.toLowerCase())) ? 0.7 : 0,
    }))
    .filter((item) => item.score > 0);

  const categories = matched.length > 0 ? matched : [{ id: 'uncategorized', score: 0.5 }];
  return {
    categories,
    estimatedMinutes: 25,
    urgency: 'medium',
    confidence: categories[0].score,
  };
}

function pickOutputText(aiResult) {
  if (!aiResult) return '';
  if (typeof aiResult === 'string') return aiResult;
  if (typeof aiResult.response === 'string') return aiResult.response;
  if (typeof aiResult.output_text === 'string') return aiResult.output_text;
  return JSON.stringify(aiResult);
}

function tryParseJsonObject(rawText) {
  if (!rawText) return null;
  const direct = rawText.trim();
  try {
    return JSON.parse(direct);
  } catch {
    const start = direct.indexOf('{');
    const end = direct.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const candidate = direct.slice(start, end + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function classifyWithWorkersAI(env, text, locale) {
  if (!env.AI) {
    return {
      result: fallbackClassify(text),
      source: 'fallback',
      reason: 'missing_ai_binding',
      model: null,
      aiLatencyMs: 0,
    };
  }
  const model = typeof env.AI_MODEL === 'string' ? env.AI_MODEL.trim() : '';
  if (!model) {
    return {
      result: fallbackClassify(text),
      source: 'fallback',
      reason: 'missing_model',
      model: null,
      aiLatencyMs: 0,
    };
  }

  const systemPrompt =
    'You classify todo text. Return JSON only with keys: categories, estimatedMinutes, urgency, confidence. ' +
    'categories is an array of up to 3 objects: {id, score}. Valid ids: ' +
    CATEGORY_IDS.join(', ') +
    '.';
  const userPrompt =
    `Locale: ${locale || 'en'}\n` +
    `Todo: ${text}\n` +
    'Respond with strict JSON. No markdown.';

  const aiStartedAt = Date.now();
  try {
    const aiResult = await env.AI.run(model, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 300,
    });
    const aiLatencyMs = Date.now() - aiStartedAt;

    const parsed = tryParseJsonObject(pickOutputText(aiResult));
    if (!parsed || typeof parsed !== 'object') {
      return {
        result: fallbackClassify(text),
        source: 'fallback',
        reason: 'invalid_ai_json',
        model,
        aiLatencyMs,
      };
    }

    const categories = normalizeCategories(parsed.categories);
    if (categories.length === 0) {
      return {
        result: fallbackClassify(text),
        source: 'fallback',
        reason: 'invalid_categories',
        model,
        aiLatencyMs,
      };
    }

    const urgency = parsed.urgency === 'low' || parsed.urgency === 'high' ? parsed.urgency : 'medium';
    const estimatedMinutes = Math.max(5, Math.round(Number(parsed.estimatedMinutes) || 25));
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || categories[0].score));

    return {
      result: { categories, estimatedMinutes, urgency, confidence },
      source: 'ai',
      reason: 'ok',
      model,
      aiLatencyMs,
    };
  } catch (error) {
    return {
      result: fallbackClassify(text),
      source: 'fallback',
      reason: 'ai_error',
      model,
      aiLatencyMs: Date.now() - aiStartedAt,
      errorMessage: toErrorMessage(error),
    };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/v1/classify') {
      const requestStartedAt = Date.now();
      const requestId = createRequestId();
      const appEnv = String(env.APP_ENV || 'unknown');
      const clientIp = getClientIp(request);
      const clientIpMasked = anonymizeIp(clientIp);
      let locale = 'en';
      let textBytes = 0;

      const rateLimit = checkRateLimit(clientIp);
      if (rateLimit.limited) {
        logClassifyEvent({
          level: 'warn',
          requestId,
          appEnv,
          clientIp: clientIpMasked,
          status: 'rejected',
          reason: 'rate_limited',
          httpStatus: 429,
          latencyMs: Date.now() - requestStartedAt,
        });
        return json(
          { error: 'too many requests' },
          429,
          { 'retry-after': String(rateLimit.retryAfterSeconds) },
        );
      }

      try {
        const contentLength = Number(request.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
          logClassifyEvent({
            level: 'warn',
            requestId,
            appEnv,
            clientIp: clientIpMasked,
            status: 'rejected',
            reason: 'payload_too_large_header',
            httpStatus: 413,
            latencyMs: Date.now() - requestStartedAt,
            contentLength,
          });
          return json({ error: 'payload too large' }, 413);
        }

        const rawBody = await request.text();
        if (byteLength(rawBody) > MAX_REQUEST_BODY_BYTES) {
          logClassifyEvent({
            level: 'warn',
            requestId,
            appEnv,
            clientIp: clientIpMasked,
            status: 'rejected',
            reason: 'payload_too_large_body',
            httpStatus: 413,
            latencyMs: Date.now() - requestStartedAt,
            bodyBytes: byteLength(rawBody),
          });
          return json({ error: 'payload too large' }, 413);
        }

        const body = JSON.parse(rawBody || '{}');
        const text = String(body?.text || '').trim();
        textBytes = byteLength(text);
        if (textBytes > MAX_TODO_TEXT_BYTES) {
          logClassifyEvent({
            level: 'warn',
            requestId,
            appEnv,
            clientIp: clientIpMasked,
            status: 'rejected',
            reason: 'text_too_large',
            httpStatus: 413,
            latencyMs: Date.now() - requestStartedAt,
            textBytes,
          });
          return json({ error: 'text is too long' }, 413);
        }

        locale = String(body?.locale || 'en').slice(0, 10);
        if (!text) {
          logClassifyEvent({
            level: 'warn',
            requestId,
            appEnv,
            clientIp: clientIpMasked,
            status: 'rejected',
            reason: 'text_required',
            httpStatus: 400,
            latencyMs: Date.now() - requestStartedAt,
          });
          return json({ error: 'text is required' }, 400);
        }

        const classify = await classifyWithWorkersAI(env, text, locale);
        logClassifyEvent({
          level: classify.reason === 'ai_error' ? 'error' : classify.source === 'fallback' ? 'warn' : 'info',
          requestId,
          appEnv,
          clientIp: clientIpMasked,
          status: classify.source === 'ai' ? 'ok' : 'fallback',
          reason: classify.reason,
          httpStatus: 200,
          latencyMs: Date.now() - requestStartedAt,
          aiLatencyMs: classify.aiLatencyMs,
          model: classify.model,
          locale,
          textBytes,
          confidence: classify.result.confidence,
          errorMessage: classify.errorMessage,
        });
        return json(classify.result);
      } catch (error) {
        logClassifyEvent({
          level: 'error',
          requestId,
          appEnv,
          clientIp: clientIpMasked,
          status: 'rejected',
          reason: 'invalid_request',
          httpStatus: 400,
          latencyMs: Date.now() - requestStartedAt,
          locale,
          textBytes,
          errorMessage: toErrorMessage(error),
        });
        return json({ error: 'invalid request' }, 400);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
