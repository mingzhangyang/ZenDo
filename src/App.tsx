import { useEffect, useMemo, useRef, useState, KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Lightbulb } from 'lucide-react';
import { classifyTodoDetailed } from './lib/ai';
import { loadDailyMetrics, loadTodos, persistStateSnapshot } from './lib/db';
import { CategoryId, DailyMetric, TodoEvent, TodoItem, TodoEventType } from './lib/types';

interface Translation {
  placeholder: string;
  clear: string;
  analytics: string;
  back: string;
  overview: string;
  sevenDayCompletion: string;
  completionRate: string;
  totalTodos: string;
  topCategory: string;
  categoryBreakdown: string;
  noData: string;
  analyzing: string;
}

const TRANSLATIONS: Record<'zh' | 'en' | 'ja' | 'es', Translation> = {
  zh: {
    placeholder: '下一步做什么？',
    clear: '清理已完成',
    analytics: '分析',
    back: '返回',
    overview: '本周概览',
    sevenDayCompletion: '7日完成趋势',
    completionRate: '完成率',
    totalTodos: '待办总数',
    topCategory: '最投入类别',
    categoryBreakdown: '类别明细',
    noData: '暂无数据',
    analyzing: 'AI 分类中',
  },
  en: {
    placeholder: 'What to do next?',
    clear: 'Clear completed',
    analytics: 'Analytics',
    back: 'Back',
    overview: 'Weekly Overview',
    sevenDayCompletion: '7-Day Completion',
    completionRate: 'Completion',
    totalTodos: 'Total Todos',
    topCategory: 'Top Category',
    categoryBreakdown: 'By Category',
    noData: 'No data',
    analyzing: 'Classifying',
  },
  ja: {
    placeholder: '次は何をしますか？',
    clear: '完了済みをクリア',
    analytics: '分析',
    back: '戻る',
    overview: '今週の概要',
    sevenDayCompletion: '7日間の完了推移',
    completionRate: '完了率',
    totalTodos: 'タスク総数',
    topCategory: '最多カテゴリ',
    categoryBreakdown: 'カテゴリ別',
    noData: 'データなし',
    analyzing: '分類中',
  },
  es: {
    placeholder: '¿Qué hacer a continuación?',
    clear: 'Borrar completados',
    analytics: 'Análisis',
    back: 'Volver',
    overview: 'Resumen semanal',
    sevenDayCompletion: 'Cumplimiento de 7 días',
    completionRate: 'Finalización',
    totalTodos: 'Tareas totales',
    topCategory: 'Categoría principal',
    categoryBreakdown: 'Por categoría',
    noData: 'Sin datos',
    analyzing: 'Clasificando',
  },
};

const CATEGORY_LABELS: Record<CategoryId, Record<'zh' | 'en' | 'ja' | 'es', string>> = {
  work_execution: { zh: '工作推进', en: 'Execution', ja: '実行', es: 'Ejecución' },
  communication: { zh: '沟通协作', en: 'Communication', ja: 'コミュニケーション', es: 'Comunicación' },
  learning: { zh: '学习成长', en: 'Learning', ja: '学習', es: 'Aprendizaje' },
  life: { zh: '生活事务', en: 'Life', ja: '生活', es: 'Vida' },
  health: { zh: '健康管理', en: 'Health', ja: '健康', es: 'Salud' },
  errands: { zh: '杂务办理', en: 'Errands', ja: '雑務', es: 'Gestiones' },
  uncategorized: { zh: '未分类', en: 'Uncategorized', ja: '未分類', es: 'Sin categoría' },
};

type Locale = keyof typeof TRANSLATIONS;
type ViewMode = 'todos' | 'analytics';

function getBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith('zh')) return 'zh';
  if (lang.startsWith('ja')) return 'ja';
  if (lang.startsWith('es')) return 'es';
  return 'en';
}

function createEvent(todoId: string, eventType: TodoEventType, payload?: Record<string, unknown>): TodoEvent {
  return {
    id: crypto.randomUUID(),
    todoId,
    eventType,
    ts: new Date().toISOString(),
    payload,
  };
}

function deriveLegacyTodo(raw: { id: string; text: string; completed: boolean }): TodoItem {
  const now = new Date().toISOString();
  return {
    id: raw.id,
    text: raw.text,
    completed: raw.completed,
    createdAt: now,
    updatedAt: now,
    completedAt: raw.completed ? now : null,
    estimatedMinutes: 25,
    classificationConfidence: 0.4,
    urgency: 'medium',
    categories: [{ id: 'uncategorized', score: 0.5 }],
  };
}

export default function App() {
  const [locale, setLocale] = useState<Locale>('en');
  const [viewMode, setViewMode] = useState<ViewMode>('todos');
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const persistQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    setLocale(getBrowserLocale());
  }, []);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      let nextTodos = await loadTodos();
      if (nextTodos.length === 0) {
        const saved = localStorage.getItem('zen-todos');
        if (saved) {
          try {
            const legacy = JSON.parse(saved) as Array<{ id: string; text: string; completed: boolean }>;
            nextTodos = legacy.map(deriveLegacyTodo);
            await persistStateSnapshot(nextTodos, []);
            localStorage.removeItem('zen-todos');
          } catch {
            nextTodos = [];
          }
        }
      }

      const nextMetrics = await loadDailyMetrics();
      if (!active) return;
      setTodos(nextTodos);
      setDailyMetrics(nextMetrics);
      setLoading(false);
    };

    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (viewMode === 'todos') {
      inputRef.current?.focus();
    }
  }, [viewMode]);

  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 220)}px`;
  }, [input]);

  const t = TRANSLATIONS[locale];

  const persistSnapshot = (nextTodos: TodoItem[], events: TodoEvent[] = []) => {
    persistQueueRef.current = persistQueueRef.current
      .then(async () => {
        await persistStateSnapshot(nextTodos, events);
        const nextMetrics = await loadDailyMetrics();
        setDailyMetrics(nextMetrics);
      })
      .catch((error) => {
        console.error('Persist failed', error);
      });
  };

  const applyClassification = (
    todoId: string,
    text: string,
    mode: 'primary' | 'retry',
    timeoutMs: number,
  ) => {
    void (async () => {
      const outcome = await classifyTodoDetailed(text, locale, { timeoutMs });

      setTodos((prev) => {
        const targetIndex = prev.findIndex((todo) => todo.id === todoId);
        if (targetIndex < 0) return prev;

        const target = prev[targetIndex];
        if (mode === 'retry' && outcome.source !== 'api') return prev;

        const updated: TodoItem = {
          ...target,
          categories: outcome.result.categories,
          estimatedMinutes: outcome.result.estimatedMinutes,
          urgency: outcome.result.urgency,
          classificationConfidence: outcome.result.confidence,
          updatedAt: new Date().toISOString(),
        };

        const next = [...prev];
        next[targetIndex] = updated;
        persistSnapshot(next, [
          createEvent(todoId, 'classified', {
            categories: outcome.result.categories,
            confidence: outcome.result.confidence,
            source: mode === 'retry' ? 'retry' : outcome.source,
            fallbackReason: outcome.fallbackReason,
          }),
        ]);
        return next;
      });

      if (mode === 'primary' && outcome.source === 'fallback') {
        applyClassification(todoId, text, 'retry', 8000);
      }
    })();
  };

  const handleAddTodo = () => {
    const text = input.trim();
    if (!text) return;

    const now = new Date().toISOString();
    const created: TodoItem = {
      id: crypto.randomUUID(),
      text,
      completed: false,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      estimatedMinutes: 25,
      classificationConfidence: 0.1,
      urgency: 'medium',
      categories: [{ id: 'uncategorized', score: 0.4 }],
    };

    setInput('');
    setTodos((prev) => {
      const next = [created, ...prev];
      persistSnapshot(next, [createEvent(created.id, 'created')]);
      return next;
    });

    applyClassification(created.id, text, 'primary', 3500);
  };

  const handleToggleTodo = (id: string) => {
    const now = new Date().toISOString();
    setTodos((prev) => {
      const next = prev.map((todo) => {
        if (todo.id !== id) return todo;

        const toggledToCompleted = !todo.completed;

        return {
          ...todo,
          completed: toggledToCompleted,
          completedAt: toggledToCompleted ? now : null,
          updatedAt: now,
        };
      });

      const toggledTodo = next.find((todo) => todo.id === id);
      if (toggledTodo) {
        persistSnapshot(next, [createEvent(id, toggledTodo.completed ? 'completed' : 'reopened')]);
      }
      return next;
    });
  };

  const clearCompleted = () => {
    setTodos((prev) => {
      const completedIds = prev.filter((todo) => todo.completed).map((todo) => todo.id);
      if (completedIds.length === 0) return prev;

      const next = prev.filter((todo) => !todo.completed);
      const events = completedIds.map((id) => createEvent(id, 'cleared'));
      persistSnapshot(next, events);
      return next;
    });
  };

  const completedTodosCount = useMemo(() => todos.filter((todo) => todo.completed).length, [todos]);

  const categoryStats = useMemo(() => {
    const grouped = new Map<CategoryId, { total: number; completed: number }>();

    for (const todo of todos) {
      const categoryIds = todo.categories.length > 0 ? todo.categories.map((c) => c.id) : (['uncategorized'] as CategoryId[]);

      for (const categoryId of categoryIds) {
        const current = grouped.get(categoryId) ?? { total: 0, completed: 0 };
        current.total += 1;
        if (todo.completed) current.completed += 1;
        grouped.set(categoryId, current);
      }
    }

    return Array.from(grouped.entries())
      .map(([id, value]) => ({
        id,
        ...value,
        completionRate: value.total > 0 ? value.completed / value.total : 0,
      }))
      .sort((a, b) => {
        if (b.completed === a.completed) return b.total - a.total;
        return b.completed - a.completed;
      });
  }, [todos]);

  const overview = useMemo(() => {
    const total = todos.length;
    const completed = completedTodosCount;
    const completionRate = total > 0 ? completed / total : 0;
    const topCategory = categoryStats[0]?.id ?? 'uncategorized';
    return { total, completed, completionRate, topCategory };
  }, [todos, completedTodosCount, categoryStats]);

  const sevenDayCompletion = useMemo(() => {
    const dayMap = new Map<string, number>();
    for (const row of dailyMetrics) {
      dayMap.set(row.date, (dayMap.get(row.date) ?? 0) + row.completedCount);
    }

    const days: Array<{ date: string; value: number }> = [];
    for (let i = 6; i >= 0; i -= 1) {
      const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = day.toISOString().slice(0, 10);
      days.push({ date: key, value: dayMap.get(key) ?? 0 });
    }

    const max = Math.max(1, ...days.map((d) => d.value));
    return { days, max };
  }, [dailyMetrics]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleAddTodo();
    }
  };

  const renderTodoView = () => (
    <>
      <div className="flex items-start gap-3">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.placeholder}
          rows={1}
          className="w-full resize-none overflow-y-auto text-3xl sm:text-4xl font-light leading-tight bg-transparent border-none outline-none placeholder:text-zinc-300 text-zinc-800 focus:ring-0 mb-10 sm:mb-16 caret-zinc-300 break-words [overflow-wrap:anywhere] max-h-[220px]"
        />
      </div>

      <ul className="space-y-3 sm:space-y-5">
        <AnimatePresence initial={false}>
          {todos.map((todo) => {
            const label = todo.categories
              .slice(0, 2)
              .map((cat) => CATEGORY_LABELS[cat.id][locale])
              .join(' · ');

            return (
              <motion.li
                key={todo.id}
                layout
                initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.95, filter: 'blur(4px)' }}
                transition={{ duration: 0.26, ease: 'easeOut' }}
                className="group"
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => handleToggleTodo(todo.id)}
                    className={`text-left flex-1 transition-all duration-300 ease-out ${
                      todo.completed ? 'text-zinc-300 line-through' : 'text-zinc-800 hover:opacity-70'
                    }`}
                  >
                    <span className="text-xl md:text-2xl font-light leading-snug block whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {todo.text}
                    </span>
                    <span className="text-[11px] uppercase tracking-wider text-zinc-400 mt-1 block">{label || t.analyzing}</span>
                  </button>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      <AnimatePresence>
        {completedTodosCount > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-10 sm:mt-16">
            <button
              onClick={clearCompleted}
              className="text-xs font-semibold tracking-widest uppercase text-zinc-400 hover:text-zinc-800 transition-colors min-h-[44px] flex items-center pr-6"
            >
              {t.clear}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  const renderAnalyticsView = () => (
    <div className="pb-12">
      <button
        onClick={() => setViewMode('todos')}
        className="mb-8 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-900 transition-colors"
      >
        <ArrowLeft size={14} />
        {t.back}
      </button>

      <h2 className="text-2xl font-light text-zinc-800 mb-6">{t.overview}</h2>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-8">
        <div className="rounded-2xl bg-white border border-zinc-200 p-4">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">{t.completionRate}</p>
          <p className="text-2xl mt-2 font-light">{Math.round(overview.completionRate * 100)}%</p>
        </div>
        <div className="rounded-2xl bg-white border border-zinc-200 p-4">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">{t.totalTodos}</p>
          <p className="text-2xl mt-2 font-light">{overview.total}</p>
        </div>
        <div className="rounded-2xl bg-white border border-zinc-200 p-4 col-span-2">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">{t.topCategory}</p>
          <p className="text-xl mt-2 font-light">{CATEGORY_LABELS[overview.topCategory][locale]}</p>
        </div>
      </div>

      <div className="mb-8 rounded-2xl bg-white border border-zinc-200 p-4">
        <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-3">{t.sevenDayCompletion}</p>
        <div className="flex items-end gap-2 h-24">
          {sevenDayCompletion.days.map((day) => {
            const height = `${Math.max(10, (day.value / sevenDayCompletion.max) * 100)}%`;
            return (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full rounded-sm bg-zinc-800/75" style={{ height }} />
                <span className="text-[10px] text-zinc-400">{day.date.slice(5)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-3">{t.categoryBreakdown}</p>
        {categoryStats.length === 0 && <p className="text-sm text-zinc-400">{t.noData}</p>}
        <ul className="space-y-2">
          {categoryStats.map((stat) => (
            <li key={stat.id} className="rounded-2xl bg-white border border-zinc-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm">{CATEGORY_LABELS[stat.id][locale]}</p>
                <p className="text-xs text-zinc-500">{Math.round(stat.completionRate * 100)}%</p>
              </div>
              <p className="text-xs text-zinc-500 mt-1">{stat.completed}/{stat.total}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fafafa] text-zinc-800 font-sans tracking-tight px-6 py-16">
        <p className="text-sm text-zinc-500">{t.noData}...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fafafa] text-zinc-800 font-sans tracking-tight pb-20 selection:bg-zinc-200">
      <div className="max-w-2xl mx-auto px-5 sm:px-6 pt-12 md:pt-24">
        {viewMode === 'todos' && (
          <div className="flex justify-end mb-5">
            <button
              onClick={() => setViewMode('analytics')}
              className="h-10 w-10 inline-flex items-center justify-center text-amber-400 hover:text-amber-500 focus-visible:text-amber-500 transition-colors duration-200 focus-visible:outline-none"
              aria-label={t.analytics}
            >
              <Lightbulb size={16} className="shrink-0" />
            </button>
          </div>
        )}

        {viewMode === 'todos' ? renderTodoView() : renderAnalyticsView()}
      </div>
    </div>
  );
}
