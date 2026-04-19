import { CategoryId, DailyMetric, TodoEvent, TodoItem } from './types';

const DB_NAME = 'zendo-db';
const DB_VERSION = 1;

const STORE_TODOS = 'todos';
const STORE_EVENTS = 'todo_events';
const STORE_METRICS = 'metrics_daily';

type ZendoDBStores = {
  [STORE_TODOS]: TodoItem;
  [STORE_EVENTS]: TodoEvent;
  [STORE_METRICS]: DailyMetric;
};

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

function toDateKey(iso: string): string {
  return iso.slice(0, 10);
}

function normalizeTodo(todo: TodoItem): TodoItem {
  return {
    id: todo.id,
    text: todo.text,
    completed: todo.completed,
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
    completedAt: todo.completedAt,
    estimatedMinutes: Number.isFinite(todo.estimatedMinutes) ? todo.estimatedMinutes : 25,
    classificationConfidence: Number.isFinite(todo.classificationConfidence) ? todo.classificationConfidence : 0.1,
    urgency: todo.urgency ?? 'medium',
    categories: Array.isArray(todo.categories) ? todo.categories : [{ id: 'uncategorized', score: 0.4 }],
  };
}

// completedCount is derived from events so it survives clearCompleted.
// createdCount is still derived from the live todos list (categories are unknown at creation time).
function buildDailyMetrics(todos: TodoItem[], allEvents: TodoEvent[]): DailyMetric[] {
  const rows = new Map<string, DailyMetric>();

  const ensureRow = (date: string, categoryId: TodoItem['categories'][number]['id']) => {
    const rowId = `${date}:${categoryId}`;
    const existing = rows.get(rowId);
    if (existing) return existing;

    const created: DailyMetric = {
      id: rowId,
      date,
      categoryId,
      createdCount: 0,
      completedCount: 0,
    };
    rows.set(rowId, created);
    return created;
  };

  const todoCategoryMap = new Map<string, CategoryId[]>();
  for (const todo of todos) {
    const categoryIds: CategoryId[] =
      todo.categories.length > 0 ? todo.categories.map((c) => c.id) : ['uncategorized'];
    todoCategoryMap.set(todo.id, categoryIds);

    const createdDate = toDateKey(todo.createdAt);
    for (const categoryId of categoryIds) {
      ensureRow(createdDate, categoryId).createdCount += 1;
    }
  }

  for (const event of allEvents) {
    if (event.eventType !== 'completed') continue;
    const completedDate = toDateKey(event.ts);

    // Prefer categories stored in the event payload (survives todo deletion).
    // Fall back to the live todo's current categories if not recorded.
    let categoryIds: CategoryId[];
    const payloadCategories = event.payload?.categories;
    if (Array.isArray(payloadCategories) && payloadCategories.length > 0) {
      categoryIds = (payloadCategories as Array<{ id: CategoryId }>).map((c) => c.id);
    } else {
      categoryIds = todoCategoryMap.get(event.todoId) ?? ['uncategorized'];
    }

    for (const categoryId of categoryIds) {
      ensureRow(completedDate, categoryId).completedCount += 1;
    }
  }

  return Array.from(rows.values()).sort((a, b) => {
    if (a.date === b.date) return a.categoryId.localeCompare(b.categoryId);
    return a.date.localeCompare(b.date);
  });
}

let openDbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (openDbPromise) return openDbPromise;

  openDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_TODOS)) {
        const todosStore = db.createObjectStore(STORE_TODOS, { keyPath: 'id' });
        todosStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        todosStore.createIndex('completed', 'completed', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        const eventsStore = db.createObjectStore(STORE_EVENTS, { keyPath: 'id' });
        eventsStore.createIndex('todoId', 'todoId', { unique: false });
        eventsStore.createIndex('ts', 'ts', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_METRICS)) {
        const metricsStore = db.createObjectStore(STORE_METRICS, { keyPath: 'id' });
        metricsStore.createIndex('date', 'date', { unique: false });
        metricsStore.createIndex('categoryId', 'categoryId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return openDbPromise;
}

export async function loadTodos(): Promise<TodoItem[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_TODOS, 'readonly');
  const request = tx.objectStore(STORE_TODOS).getAll();
  const todos = await requestToPromise<ZendoDBStores[typeof STORE_TODOS][]>(request);
  await transactionDone(tx);
  return todos.map(normalizeTodo).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadDailyMetrics(): Promise<DailyMetric[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_METRICS, 'readonly');
  const request = tx.objectStore(STORE_METRICS).getAll();
  const metrics = await requestToPromise<ZendoDBStores[typeof STORE_METRICS][]>(request);
  await transactionDone(tx);
  return metrics.sort((a, b) => a.date.localeCompare(b.date));
}

export async function persistStateSnapshot(todos: TodoItem[], newEvents: TodoEvent[] = []): Promise<void> {
  const db = await openDb();

  // Transaction 1: write todos and new events atomically.
  const tx1 = db.transaction([STORE_TODOS, STORE_EVENTS], 'readwrite');
  const todosStore = tx1.objectStore(STORE_TODOS);
  const eventsStore = tx1.objectStore(STORE_EVENTS);
  todosStore.clear();
  for (const todo of todos) todosStore.put(normalizeTodo(todo));
  for (const event of newEvents) eventsStore.put(event);
  await transactionDone(tx1);

  // Transaction 2: read the full event log (includes events from cleared todos).
  const tx2 = db.transaction(STORE_EVENTS, 'readonly');
  const allEvents = await requestToPromise<ZendoDBStores[typeof STORE_EVENTS][]>(tx2.objectStore(STORE_EVENTS).getAll());
  await transactionDone(tx2);

  // Transaction 3: rebuild metrics from all events + current todos.
  const tx3 = db.transaction(STORE_METRICS, 'readwrite');
  const metricsStore = tx3.objectStore(STORE_METRICS);
  metricsStore.clear();
  const metricRows = buildDailyMetrics(todos, allEvents);
  for (const row of metricRows) metricsStore.put(row);
  await transactionDone(tx3);
}
