const CATEGORY_IDS = [
  'work_execution',
  'communication',
  'learning',
  'life',
  'health',
  'errands',
  'uncategorized',
];

const CATEGORY_KEYWORDS = [
  { id: 'work_execution', keywords: ['项目', '需求', '文档', '代码', '发布', '复盘', 'plan', 'project', 'code'] },
  { id: 'communication', keywords: ['会议', '沟通', '客户', '邮件', 'review', 'meeting', 'email', 'call'] },
  { id: 'learning', keywords: ['学习', '阅读', '课程', '练习', 'learn', 'study', 'read', 'course'] },
  { id: 'health', keywords: ['运动', '跑步', '健身', '睡觉', 'exercise', 'run', 'gym', 'sleep'] },
  { id: 'life', keywords: ['家庭', '家务', '购物', '做饭', '生活', 'home', 'family', 'cook', 'clean'] },
  { id: 'errands', keywords: ['报销', '缴费', '预约', '快递', '办事', 'pay', 'book', 'delivery'] },
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
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
  if (!env.AI) return fallbackClassify(text);
  const model = typeof env.AI_MODEL === 'string' ? env.AI_MODEL.trim() : '';
  if (!model) return fallbackClassify(text);

  const systemPrompt =
    'You classify todo text. Return JSON only with keys: categories, estimatedMinutes, urgency, confidence. ' +
    'categories is an array of up to 3 objects: {id, score}. Valid ids: ' +
    CATEGORY_IDS.join(', ') +
    '.';
  const userPrompt =
    `Locale: ${locale || 'en'}\n` +
    `Todo: ${text}\n` +
    'Respond with strict JSON. No markdown.';

  try {
    const aiResult = await env.AI.run(model, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 300,
    });

    const parsed = tryParseJsonObject(pickOutputText(aiResult));
    if (!parsed || typeof parsed !== 'object') return fallbackClassify(text);

    const categories = normalizeCategories(parsed.categories);
    if (categories.length === 0) return fallbackClassify(text);

    const urgency = parsed.urgency === 'low' || parsed.urgency === 'high' ? parsed.urgency : 'medium';
    const estimatedMinutes = Math.max(5, Math.round(Number(parsed.estimatedMinutes) || 25));
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || categories[0].score));

    return { categories, estimatedMinutes, urgency, confidence };
  } catch {
    return fallbackClassify(text);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/v1/classify') {
      try {
        const body = await request.json();
        const text = String(body?.text || '').trim();
        const locale = String(body?.locale || 'en');
        if (!text) return json({ error: 'text is required' }, 400);
        const result = await classifyWithWorkersAI(env, text, locale);
        return json(result);
      } catch {
        return json({ error: 'invalid request' }, 400);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
