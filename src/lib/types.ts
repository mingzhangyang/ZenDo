export type CategoryId =
  | 'work_execution'
  | 'communication'
  | 'learning'
  | 'life'
  | 'health'
  | 'errands'
  | 'uncategorized';

export interface CategoryScore {
  id: CategoryId;
  score: number;
}

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  estimatedMinutes: number;
  classificationConfidence: number;
  urgency: 'low' | 'medium' | 'high';
  categories: CategoryScore[];
}

export type TodoEventType =
  | 'created'
  | 'classified'
  | 'completed'
  | 'reopened'
  | 'cleared';

export interface TodoEvent {
  id: string;
  todoId: string;
  eventType: TodoEventType;
  ts: string;
  payload?: Record<string, unknown>;
}

export interface DailyMetric {
  id: string;
  date: string;
  categoryId: CategoryId;
  createdCount: number;
  completedCount: number;
}

export interface ClassifyResult {
  categories: CategoryScore[];
  estimatedMinutes: number;
  urgency: 'low' | 'medium' | 'high';
  confidence: number;
}
