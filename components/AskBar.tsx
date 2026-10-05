"use client";

import { type FormEvent, useEffect, useState } from "react";

type AskResult = {
  answer: string;
  queryType: "fact" | "case" | "aggregate";
  evidence: { id: number }[];
};

const QUICK_QUESTIONS = ["우리 시장만의 문제인가?", "반증 리뷰 찾기"] as const;
const QUERY_TYPE_LABEL = { fact: "사실 조회", case: "사례 탐색", aggregate: "집계 비교" } as const;

function readResult(value: unknown): AskResult | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  if (
    typeof result.answer !== "string" ||
    !["fact", "case", "aggregate"].includes(String(result.queryType)) ||
    !Array.isArray(result.evidence)
  ) return null;

  return {
    answer: result.answer,
    queryType: result.queryType as AskResult["queryType"],
    evidence: result.evidence.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const id = (item as Record<string, unknown>).id;
      return typeof id === "number" && Number.isSafeInteger(id) ? [{ id }] : [];
    }),
  };
}

export default function AskBar({
  marketCode,
  topicId,
  available,
}: {
  marketCode: string;
  topicId?: number;
  available: boolean;
}) {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<"idle" | "embedding" | "asking">("idle");
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!available) return;
    void import("@/lib/embed")
      .then(({ preloadQueryEmbedder }) => preloadQueryEmbedder())
      .catch(() => undefined);
  }, [available]);

  async function ask(rawQuery: string) {
    const text = rawQuery.trim();
    if (text.length < 2 || text.length > 300) {
      setError("질문은 2~300자로 입력해 주세요.");
      return;
    }
    if (!available) {
      setError("LLM API 키를 설정해야 질문할 수 있습니다.");
      return;
    }

    setError("");
    setResult(null);
    setPhase("embedding");
    try {
      const { embedQuery } = await import("@/lib/embed");
      const vector = await embedQuery(text);
      setPhase("asking");
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: text,
          vector,
          marketCode,
          ...(topicId !== undefined ? { topicId } : {}),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload && typeof payload === "object"
          ? (payload as Record<string, unknown>).error
          : null;
        throw new Error(typeof message === "string" ? message : "질의를 처리하지 못했습니다.");
      }
      const nextResult = readResult(payload);
      if (!nextResult) throw new Error("질의 응답 형식이 올바르지 않습니다.");
      setResult(nextResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "질의를 처리하지 못했습니다.");
    } finally {
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";
  const status = phase === "embedding"
    ? "브라우저에서 임베딩 생성 중…"
    : phase === "asking" ? "근거 검색 및 답변 생성 중…" : "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(query);
  }

  return (
    <footer className="brief-command">
      {result && (
        <section className="llm-result" aria-live="polite">
          <div><strong>RAG 답변</strong><span>{QUERY_TYPE_LABEL[result.queryType]}</span></div>
          <p>{result.answer}</p>
          {result.evidence.length > 0 && (
            <small>검색 근거 {result.evidence.map(({ id }) => `#${id}`).join(" · ")}</small>
          )}
        </section>
      )}
      {error && <p className="empty-note" role="alert">{error}</p>}
      <div>
        {QUICK_QUESTIONS.map((question) => (
          <button
            type="button"
            disabled={!available || busy}
            onClick={() => {
              setQuery(question);
              void ask(question);
            }}
            key={question}
          >
            {question}
          </button>
        ))}
      </div>
      <form className="llm-action" onSubmit={submit}>
        <label style={{ flex: 1 }}>
          <span className="sr-only">리뷰 질의</span>
          <input
            value={query}
            minLength={2}
            maxLength={300}
            disabled={!available || busy}
            placeholder={available ? "저평점 리뷰에 물어보기" : "LLM API 키 설정 후 사용 가능"}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          type="submit"
          aria-label="질문 보내기"
          disabled={!available || busy || query.trim().length < 2}
        >
          ↵
        </button>
      </form>
      {status && <p className="empty-note" aria-live="polite">{status}</p>}
    </footer>
  );
}
