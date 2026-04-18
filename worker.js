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
  {
    id: 'work_execution',
    cues: [
      ['项目', 1.1], ['需求', 1.0], ['文档', 0.9], ['代码', 1.1], ['发布', 1.0], ['复盘', 0.8],
      ['迭代', 0.9], ['bug', 1.0], ['修复', 0.8], ['开发', 1.0], ['实现', 0.9], ['设计稿', 0.8],
      ['plan', 0.8], ['project', 1.0], ['code', 1.0], ['release', 1.0], ['deploy', 1.0], ['spec', 0.8],
    ],
  },
  {
    id: 'communication',
    cues: [
      ['会议', 1.1], ['沟通', 1.0], ['对齐', 1.0], ['客户', 0.9], ['邮件', 1.0], ['电话', 1.0], ['汇报', 0.9],
      ['review', 0.8], ['meeting', 1.1], ['email', 1.0], ['call', 1.0], ['sync', 0.9], ['1:1', 0.8],
      ['反馈', 0.8], ['评审', 0.9],
    ],
  },
  {
    id: 'learning',
    cues: [
      ['学习', 1.1], ['阅读', 1.0], ['课程', 1.0], ['练习', 0.9], ['刷题', 1.0], ['教程', 0.9], ['笔记', 0.8],
      ['read', 1.0], ['study', 1.0], ['learn', 1.0], ['course', 1.0], ['tutorial', 0.9], ['research', 0.8],
    ],
  },
  {
    id: 'health',
    cues: [
      ['运动', 1.1], ['跑步', 1.0], ['健身', 1.1], ['睡觉', 1.0], ['散步', 0.8], ['冥想', 0.8], ['体检', 0.9],
      ['exercise', 1.1], ['run', 1.0], ['gym', 1.1], ['sleep', 1.0], ['workout', 1.0], ['meditation', 0.8],
    ],
  },
  {
    id: 'life',
    cues: [
      ['家庭', 1.0], ['家务', 1.1], ['购物', 0.9], ['做饭', 1.0], ['生活', 0.8], ['孩子', 0.9], ['打扫', 1.0],
      ['home', 0.9], ['family', 1.0], ['cook', 1.0], ['clean', 1.0], ['laundry', 1.0], ['groceries', 0.9],
    ],
  },
  {
    id: 'errands',
    cues: [
      ['报销', 1.1], ['缴费', 1.0], ['预约', 1.0], ['快递', 1.0], ['办事', 0.9], ['银行', 0.9], ['证件', 0.9],
      ['发票', 0.9], ['采购', 0.8], ['pay', 1.0], ['book', 0.9], ['appointment', 1.0], ['delivery', 1.0],
      ['renew', 0.8], ['tax', 0.9],
    ],
  },
];

const CATEGORY_DEFINITIONS = [
  'work_execution: shipping/building concrete work outputs',
  'communication: meetings, syncs, emails, stakeholder conversations',
  'learning: reading/studying/training/practice for skill growth',
  'life: household/family/personal life management',
  'health: exercise/sleep/medical/wellness',
  'errands: administrative chores, appointments, payments, logistics',
  'uncategorized: no clear fit',
].join('\n');

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

function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u3000\s]+/g, ' ')
    .replace(/[.,!?;:()[\]{}"'`~@#$%^&*_+=|\\/<>-]+/g, ' ')
    .trim();
}

function hasCue(normalizedText, paddedText, tokenSet, cue) {
  if (!cue) return false;
  const isAsciiWord = /^[a-z0-9][a-z0-9:_-]*$/i.test(cue);
  if (isAsciiWord) {
    if (tokenSet.has(cue)) return true;
    return paddedText.includes(` ${cue} `);
  }
  return normalizedText.includes(cue);
}

function scoreByRules(text) {
  const normalized = normalizeForMatch(text);
  const tokens = normalized ? normalized.split(' ').filter(Boolean) : [];
  const tokenSet = new Set(tokens);
  const padded = ` ${normalized} `;

  const rawScores = CATEGORY_KEYWORDS.map((rule) => {
    const score = rule.cues.reduce((sum, [cue, weight]) => {
      return hasCue(normalized, padded, tokenSet, cue) ? sum + Number(weight || 0) : sum;
    }, 0);
    // Saturation keeps scores in [0,1] while preserving ordering.
    const normalizedScore = Math.max(0, Math.min(1, 1 - Math.exp(-score / 2.6)));
    return { id: rule.id, score: normalizedScore };
  }).filter((item) => item.score > 0);

  if (rawScores.length === 0) return [{ id: 'uncategorized', score: 0.5 }];
  rawScores.sort((a, b) => b.score - a.score);
  return rawScores.slice(0, 3);
}

function mergeCategoryScores(aiCategories, ruleCategories, aiConfidence) {
  const safeAiConfidence = Math.max(0, Math.min(1, Number(aiConfidence) || 0));
  const aiWeight = safeAiConfidence >= 0.75 ? 0.8 : safeAiConfidence >= 0.55 ? 0.68 : 0.55;
  const ruleWeight = 1 - aiWeight;
  const merged = new Map();

  for (const item of aiCategories) {
    merged.set(item.id, (merged.get(item.id) || 0) + item.score * aiWeight);
  }
  for (const item of ruleCategories) {
    merged.set(item.id, (merged.get(item.id) || 0) + item.score * ruleWeight);
  }

  const list = Array.from(merged.entries())
    .map(([id, score]) => ({ id, score: Math.max(0, Math.min(1, score)) }))
    .sort((a, b) => b.score - a.score);

  const nonUncategorized = list.filter((item) => item.id !== 'uncategorized' && item.score >= 0.22);
  if (nonUncategorized.length > 0) return nonUncategorized.slice(0, 3);
  return list.length > 0 ? list.slice(0, 3) : [{ id: 'uncategorized', score: 0.5 }];
}

function fallbackClassify(text) {
  const categories = scoreByRules(text);
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
    'You classify TODO text into a fixed taxonomy. Return strict JSON only with keys: categories, estimatedMinutes, urgency, confidence.\n' +
    'Category definitions:\n' +
    CATEGORY_DEFINITIONS +
    '\nRules:\n' +
    '- categories: array of up to 3 objects {id, score}, score in [0,1], sorted desc.\n' +
    '- Valid ids only: ' + CATEGORY_IDS.join(', ') + '.\n' +
    '- Pick categories by action intent, not by surface nouns.\n' +
    '- If one category is clearly dominant, make it score >=0.75.\n' +
    '- Use uncategorized only when no category clearly fits.\n' +
    '- Return compact JSON only, no markdown.';
  const userPrompt =
    `Locale: ${locale || 'en'}\n` +
    `Todo: ${text}\n` +
    'Examples:\n' +
    '- "和客户同步需求变更" => communication\n' +
    '- "修复支付页面 bug 并上线" => work_execution\n' +
    '- "预约体检" => health or errands (pick primary intent)\n' +
    '- "学习 React hooks" => learning\n' +
    'Respond with strict JSON. No markdown.';

  const aiStartedAt = Date.now();
  try {
    const aiResult = await env.AI.run(model, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
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
    const aiConfidence = Math.max(0, Math.min(1, Number(parsed.confidence) || categories[0].score));
    const ruleCategories = scoreByRules(text);
    const mergedCategories = mergeCategoryScores(categories, ruleCategories, aiConfidence);
    const confidence = Math.max(mergedCategories[0]?.score || 0, aiConfidence * 0.7 + (ruleCategories[0]?.score || 0) * 0.3);

    return {
      result: { categories: mergedCategories, estimatedMinutes, urgency, confidence: Math.max(0, Math.min(1, confidence)) },
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
