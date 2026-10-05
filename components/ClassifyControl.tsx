"use client";

import { useEffect, useState } from "react";
import type { GapJudgment } from "@/lib/llm";

type WorkflowState = {
  reviewed: boolean;
  reviewedBy: string;
  reviewedAt: string | null;
  action: {
    owner: string;
    status: string;
    note: string;
    updatedAt: string | null;
  };
};

function responseError(body: unknown, fallback: string) {
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error
    : fallback;
}

export function ReviewTranslation({ reviewId, language }: { reviewId: number; language: string }) {
  const [translation, setTranslation] = useState("");
  const [shown, setShown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const translationId = `review-${reviewId}-translation`;

  if (language.toLowerCase().startsWith("ko")) return null;

  async function toggle() {
    if (translation) {
      setShown((current) => !current);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/workflow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "translate", reviewId }),
      });
      const body: unknown = await response.json();
      if (
        !response.ok ||
        typeof body !== "object" ||
        body === null ||
        !("translation" in body) ||
        typeof body.translation !== "string"
      ) {
        throw new Error(responseError(body, "리뷰 번역에 실패했습니다."));
      }
      setTranslation(body.translation);
      setShown(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "리뷰 번역에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        aria-controls={translationId}
        aria-expanded={shown}
        className="back-link"
        disabled={loading}
        onClick={toggle}
        type="button"
      >
        {loading ? "번역 중" : shown ? "번역 숨기기" : "한국어 번역"}
      </button>
      {shown && <p id={translationId} lang="ko">{translation}</p>}
      {error && <small role="alert">{error}</small>}
    </>
  );
}

export default function ClassifyControl({
  marketCode,
  topicId,
  available,
}: {
  marketCode: string;
  topicId: number;
  available: boolean;
}) {
  const [result, setResult] = useState<GapJudgment | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null);
  const [reviewer, setReviewer] = useState("");
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState("대기");
  const [note, setNote] = useState("");
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [workflowError, setWorkflowError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function loadWorkflow() {
      setWorkflowError("");
      try {
        const query = new URLSearchParams({ marketCode, topicId: String(topicId) });
        const response = await fetch(`/api/workflow?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(responseError(body, "워크플로 상태를 불러오지 못했습니다."));
        const state = body as WorkflowState;
        setWorkflow(state);
        setReviewer(state.reviewedBy);
        setOwner(state.action.owner);
        setStatus(state.action.status);
        setNote(state.action.note);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setWorkflowError(
          caught instanceof Error ? caught.message : "워크플로 상태를 불러오지 못했습니다.",
        );
      }
    }
    loadWorkflow();
    return () => controller.abort();
  }, [marketCode, topicId]);

  async function classify() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/classify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketCode, topicId }),
      });
      const body = (await response.json()) as GapJudgment | { error?: string };
      if (!response.ok || !("verdict" in body)) {
        throw new Error("error" in body && body.error ? body.error : "LLM 판정에 실패했습니다.");
      }
      setResult(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "LLM 판정에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function saveWorkflow(body: Record<string, unknown>) {
    setWorkflowBusy(true);
    setWorkflowError("");
    setWorkflowMessage("");
    try {
      const response = await fetch("/api/workflow", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketCode, topicId, ...body }),
      });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(responseError(result, "워크플로를 저장하지 못했습니다."));
      return result as Record<string, unknown>;
    } catch (caught) {
      setWorkflowError(caught instanceof Error ? caught.message : "워크플로를 저장하지 못했습니다.");
      return null;
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function toggleReviewed() {
    const reviewed = !(workflow?.reviewed ?? false);
    const result = await saveWorkflow({ kind: "review", reviewed, reviewedBy: reviewer });
    if (!result || !workflow) return;
    setWorkflow({
      ...workflow,
      reviewed: result.reviewed as boolean,
      reviewedBy: result.reviewedBy as string,
      reviewedAt: (result.reviewedAt as string | null) ?? null,
    });
    setWorkflowMessage(reviewed ? "검토 완료를 기록했습니다." : "검토 완료를 취소했습니다.");
  }

  async function saveAction() {
    const result = await saveWorkflow({ kind: "action", owner, status, note });
    if (!result || !workflow) return;
    setWorkflow({
      ...workflow,
      action: {
        owner: result.owner as string,
        status: result.status as string,
        note: result.note as string,
        updatedAt: result.updatedAt as string,
      },
    });
    setWorkflowMessage("대응을 저장했습니다.");
  }

  return (
    <>
      <div className="llm-control">
        {result && (
          <div className="llm-result">
            <div><span>LLM 판정</span><strong>{result.verdict}</strong><small>{result.confidence} 신뢰도</small></div>
            <p>{result.reasoning}</p>
            <p><b>반증 검토</b> {result.counter_evidence}</p>
          </div>
        )}
        <div className="llm-action">
          <span aria-live="polite">
            {error || (!available ? "LLM API 키 연결 후 판정을 실행할 수 있습니다." : "수치 판정을 원문 근거로 재검토합니다.")}
          </span>
          <button type="button" disabled={!available || loading} onClick={classify}>
            {loading ? "판정 중" : result ? "다시 판정" : "판정 실행"}
          </button>
        </div>
      </div>
      <div className="llm-control" aria-label="검토와 대응 기록">
        <div className="llm-action">
          <label>
            검토 담당자{" "}
            <input
              disabled={workflowBusy || workflow?.reviewed}
              maxLength={60}
              onChange={(event) => setReviewer(event.target.value)}
              size={12}
              value={reviewer}
            />
          </label>
          <button
            disabled={!workflow || workflowBusy || (!workflow.reviewed && !reviewer.trim())}
            onClick={toggleReviewed}
            type="button"
          >
            {workflow?.reviewed ? "검토 취소" : "검토 완료"}
          </button>
        </div>
        <div className="llm-action">
          <label>
            대응 담당자{" "}
            <input
              disabled={!workflow || workflowBusy}
              maxLength={60}
              onChange={(event) => setOwner(event.target.value)}
              size={10}
              value={owner}
            />
          </label>
          <label>
            상태{" "}
            <select
              disabled={!workflow || workflowBusy}
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              <option>대기</option>
              <option>진행 중</option>
              <option>완료</option>
              <option>보류</option>
            </select>
          </label>
        </div>
        <div className="llm-action">
          <label style={{ display: "flex", flex: 1, gap: 6 }}>
            메모
            <input
              disabled={!workflow || workflowBusy}
              maxLength={1000}
              onChange={(event) => setNote(event.target.value)}
              style={{ flex: 1, minWidth: 0 }}
              value={note}
            />
          </label>
          <button disabled={!workflow || workflowBusy || !owner.trim()} onClick={saveAction} type="button">
            {workflowBusy ? "저장 중" : "대응 저장"}
          </button>
        </div>
        <div className="llm-action">
          <span aria-live="polite">
            {workflowMessage ||
              (workflow?.reviewedAt
                ? `${workflow.reviewedBy} · ${new Date(workflow.reviewedAt).toLocaleString("ko-KR")}`
                : "검토 완료와 최신 대응 1건을 기록합니다.")}
          </span>
          {workflowError && <span role="alert">{workflowError}</span>}
        </div>
      </div>
    </>
  );
}
