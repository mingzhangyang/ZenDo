import type { CategoryId, CategoryScore } from './types';

export const CATEGORY_IDS: CategoryId[] = [
  'work_execution',
  'communication',
  'learning',
  'life',
  'health',
  'errands',
  'uncategorized',
];

export const CATEGORY_RULES: Array<{ id: CategoryId; cues: Array<[string, number]> }> = [
  {
    id: 'work_execution',
    cues: [
      ['项目', 1.1], ['需求', 1.0], ['文档', 0.9], ['代码', 1.1], ['发布', 1.0], ['复盘', 0.8],
      ['迭代', 0.9], ['bug', 1.0], ['修复', 0.8], ['开发', 1.0], ['实现', 0.9], ['design', 0.8],
      ['设计稿', 0.8], ['plan', 0.8], ['project', 1.0], ['code', 1.0], ['release', 1.0], ['deploy', 1.0], ['spec', 0.8],
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

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u3000\s]+/g, ' ')
    .replace(/[.,!?;:()[\]{}"'`~@#$%^&*_+=|\\/<>-]+/g, ' ')
    .trim();
}

export function hasCue(normalizedText: string, paddedText: string, tokenSet: Set<string>, cue: string): boolean {
  if (!cue) return false;
  const isAsciiWord = /^[a-z0-9][a-z0-9:_-]*$/i.test(cue);
  if (isAsciiWord) {
    if (tokenSet.has(cue)) return true;
    return paddedText.includes(` ${cue} `);
  }
  return normalizedText.includes(cue);
}

export function scoreByRules(text: string): CategoryScore[] {
  const normalized = normalizeForMatch(text);
  const tokens = normalized ? normalized.split(' ').filter(Boolean) : [];
  const tokenSet = new Set(tokens);
  const padded = ` ${normalized} `;

  const scores = CATEGORY_RULES.map((rule) => {
    const raw = rule.cues.reduce((sum, [cue, weight]) => {
      return hasCue(normalized, padded, tokenSet, cue) ? sum + weight : sum;
    }, 0);
    const score = Math.max(0, Math.min(1, 1 - Math.exp(-raw / 2.6)));
    return { id: rule.id, score };
  }).filter((entry) => entry.score > 0);

  if (scores.length === 0) return [{ id: 'uncategorized' as CategoryId, score: 0.5 }];
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, 3);
}
