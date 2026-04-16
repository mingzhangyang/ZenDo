import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface Todo {
  id: string;
  text: string;
  completed: boolean;
}

const TRANSLATIONS = {
  zh: {
    placeholder: '下一步做什么？',
    clear: '清理已完成',
  },
  en: {
    placeholder: 'What to do next?',
    clear: 'Clear completed',
  },
  ja: {
    placeholder: '次は何をしますか？',
    clear: '完了済みをクリア',
  },
  es: {
    placeholder: '¿Qué hacer a continuación?',
    clear: 'Borrar completados',
  },
};

type Locale = keyof typeof TRANSLATIONS;

function getBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith('zh')) return 'zh';
  if (lang.startsWith('ja')) return 'ja';
  if (lang.startsWith('es')) return 'es';
  return 'en';
}

export default function App() {
  const [locale, setLocale] = useState<Locale>('en');

  useEffect(() => {
    setLocale(getBrowserLocale());
  }, []);

  const t = TRANSLATIONS[locale];

  const [todos, setTodos] = useState<Todo[]>(() => {
    const saved = localStorage.getItem('zen-todos');
    return saved ? JSON.parse(saved) : [];
  });
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('zen-todos', JSON.stringify(todos));
  }, [todos]);

  // Focus input automatically on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && input.trim()) {
      setTodos([{ id: crypto.randomUUID(), text: input.trim(), completed: false }, ...todos]);
      setInput('');
    }
  };

  const toggleTodo = (id: string) => {
    setTodos(
      todos.map((todo) =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo
      )
    );
  };

  const clearCompleted = () => {
    setTodos(todos.filter((t) => !t.completed));
  };

  const completedTodos = todos.filter(t => t.completed);

  return (
    <div className="min-h-screen bg-[#fafafa] text-zinc-800 font-sans tracking-tight pb-20 selection:bg-zinc-200">
      <div className="max-w-2xl mx-auto px-5 sm:px-6 pt-16 md:pt-32">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.placeholder}
          className="w-full text-3xl sm:text-4xl font-light bg-transparent border-none outline-none placeholder:text-zinc-300 text-zinc-800 focus:ring-0 mb-10 sm:mb-16 caret-zinc-300"
        />

        <ul className="space-y-2 sm:space-y-6">
          <AnimatePresence initial={false}>
            {todos.map((todo) => (
              <motion.li
                key={todo.id}
                layout
                initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.95, filter: 'blur(4px)' }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                onClick={() => toggleTodo(todo.id)}
                className={`text-xl md:text-2xl font-light cursor-pointer transition-all duration-300 ease-out flex items-start break-words min-h-[44px] items-center sm:min-h-0 sm:block ${
                  todo.completed
                    ? 'text-zinc-300 line-through'
                    : 'text-zinc-800 hover:opacity-70'
                }`}
              >
                <span className="leading-snug">{todo.text}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>

        <AnimatePresence>
          {completedTodos.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mt-10 sm:mt-16"
            >
              <button
                onClick={clearCompleted}
                className="text-xs font-semibold tracking-widest uppercase text-zinc-400 hover:text-zinc-800 transition-colors min-h-[44px] flex items-center pr-6"
              >
                {t.clear}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
