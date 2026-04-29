// ─── Approval Queue State Hook ───────────────────────────────────
// Extracted from useTuiState god hook. Manages approval requests.

import { useState, useCallback, useRef } from "react";
import type { ApprovalRequest } from "../types.js";

export function useApprovalQueue() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const idCounter = useRef(0);

  const genId = useCallback(() => {
    idCounter.current += 1;
    return `approval_${Date.now()}_${idCounter.current}`;
  }, []);

  const addApproval = useCallback((req: Omit<ApprovalRequest, "id" | "timestamp" | "status">): string => {
    const id = genId();
    setApprovals(prev => [...prev, { ...req, id, timestamp: Date.now(), status: "pending" }]);
    return id;
  }, [genId]);

  const resolveApproval = useCallback((id: string, decision: "approved" | "rejected") => {
    setApprovals(prev => prev.map(a =>
      a.id === id ? { ...a, status: decision } : a
    ));
  }, []);

  const pendingApprovals = approvals.filter(a => a.status === "pending");

  return {
    approvals,
    pendingApprovals,
    pendingCount: pendingApprovals.length,
    addApproval,
    resolveApproval,
  };
}

export type ApprovalQueueAPI = ReturnType<typeof useApprovalQueue>;
