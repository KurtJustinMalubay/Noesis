export type NodeStatus = "locked" | "unlocked" | "in_progress" | "mastered";

export interface Workspace {
  id: string;
  title: string;
  root_domain: string;
  created_at: number;
  updated_at: number;
}

export interface GraphNode {
  id: string;
  workspace_id: string;
  title: string;
  summary_hint: string;
  status: NodeStatus;
  mastery_score: number;
  in_degree_unmastered: number;
  layer_index: number;
  pos_x: number;
  pos_y: number;
  is_hydrated: number; // 0 = skeleton only, 1 = lesson & flashcards fetched
  lesson_markdown: string | null;
  mermaid_diagram: string | null;
  source_citations: string | null; // JSON array string
  updated_at: number;
}

export interface GraphEdge {
  workspace_id: string;
  source_id: string;
  target_id: string;
}

export interface Flashcard {
  id: string;
  node_id: string;
  front: string;
  back: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_at: number;
}

export type QuizQuestionType = "mcq" | "open_ended" | "coding";

export type QuizLanguage =
  | "auto"
  | "C"
  | "C++"
  | "C#"
  | "Python"
  | "Java"
  | "JavaScript"
  | "TypeScript"
  | "Rust"
  | "SQL"
  | "Go";

export interface QuizGenerationConfig {
  formats: QuizQuestionType[];
  count: 3 | 5 | 8;
  language: QuizLanguage;
}

export type QuizAnswer = string | number;

export interface QuizGradingResult {
  id: string;
  score: number;
  passed: boolean;
  feedback: string;
  optimalSolution: string;
}

export interface QuizQuestion {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  options?: string[];
  answerIndex?: number;
  rubric?: string;
  referenceAnswer?: string;
  language?: string;
  starterCode?: string;
  testCases?: string[];
  explanation: string;
  sourceNodeId: string;
}

export interface QuizDraft {
  answers: Record<string, QuizAnswer>;
  currentQuestionIndex: number;
  languageByQuestion?: Record<string, QuizLanguage>;
  results?: QuizGradingResult[];
  score?: number;
}

export interface QuizRecord {
  questions: QuizQuestion[];
  config: QuizGenerationConfig;
  draft: QuizDraft;
  score: number | null;
}