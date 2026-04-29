// ─── Interaction Domain Hook ─────────────────────────────────────
// User questions (AskUserQuestion)

import { useState, useCallback } from "react";
import type { UserQuestionRequest } from "../types.js";

export function useInteraction() {
  const [userQuestions, setUserQuestions] = useState<UserQuestionRequest[]>([]);
  const [selectedQuestionIdx, setSelectedQuestionIdx] = useState(0);

  const eventIdCounter = { current: 0 };
  const genId = useCallback((prefix: string) => {
    eventIdCounter.current += 1;
    return `${prefix}_${Date.now()}_${eventIdCounter.current}`;
  }, []);

  const addUserQuestion = useCallback((req: Omit<UserQuestionRequest, "id" | "timestamp" | "status">): string => {
    const id = genId("question");
    setUserQuestions(prev => [...prev, { ...req, id, timestamp: Date.now(), status: "pending" }]);
    return id;
  }, [genId]);

  const resolveUserQuestion = useCallback((id: string, answer: string) => {
    setUserQuestions(prev => prev.map(q =>
      q.id === id ? { ...q, status: "answered", answer } : q
    ));
  }, []);

  return {
    userQuestions,
    selectedQuestionIdx,
    setSelectedQuestionIdx,
    addUserQuestion,
    resolveUserQuestion,
  };
}
