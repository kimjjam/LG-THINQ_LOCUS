import { NextResponse } from "next/server";
import meta from "@/data/meta.json";
import {
  createPublicClient,
  loadAnalysisData,
  loadLowScoreReviews,
} from "@/lib/data.server";
import { generateText, LlmConfigurationError } from "@/lib/llm";

export const runtime = "nodejs";

const PAGE_SIZE = 1_000;

function json(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  const safe = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

async function loadEvidence(marketCode: string, topicIds: number[]) {
  if (topicIds.length === 0) return [];
  const rows = [];
  const supabase = createPublicClient();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("reviews")
      .select("id,topic_id,lang,unit,score,at,app_version,content")
      .eq("market_code", marketCode)
      .in("topic_id", topicIds)
      .eq("is_event", false)
      .lte("score", 2)
      .order("topic_id")
      .order("at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) return rows;
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const marketCode = params.get("market");
  const format = params.get("format");
  if (!marketCode || !/^[A-Z]{2}$/.test(marketCode) || !["md", "csv"].includes(format ?? "")) {
    return json("시장 코드 또는 내보내기 형식이 올바르지 않습니다.", 400);
  }

  try {
    const data = await loadAnalysisData();
    const market = data.markets.find((item) => item.code === marketCode && item.isActive);
    if (!market) return json("활성 시장을 찾을 수 없습니다.", 404);

    const topics = new Map(data.topics.map((topic) => [topic.id, topic]));
    const stats = new Map(
      data.stats
        .filter((stat) => stat.marketCode === marketCode)
        .map((stat) => [stat.topicId, stat]),
    );
    const decisions = data.decisions
      .filter((decision) => decision.marketCode === marketCode)
      .sort((a, b) => b.lift - a.lift || a.topicId - b.topicId);

    if (format === "csv") {
      const reviews = await loadEvidence(marketCode, decisions.map((decision) => decision.topicId));
      const decisionByTopic = new Map(decisions.map((decision) => [decision.topicId, decision]));
      const header = [
        "market_code", "market", "topic_id", "topic", "verdict", "rule_basis", "lift",
        "residual", "review_id", "lang", "unit", "score", "at_utc", "app_version", "content",
      ];
      const rows = reviews.map((review) => {
        const decision = decisionByTopic.get(review.topic_id);
        const topic = topics.get(review.topic_id);
        if (!decision || !topic) throw new Error("근거 리뷰의 토픽 통계를 찾을 수 없습니다.");
        return [
          market.code, market.name, topic.id, topic.label, decision.verdict, decision.ruleBasis,
          decision.lift, decision.residual, review.id, review.lang, review.unit, review.score,
          review.at, review.app_version, review.content,
        ].map(csvCell).join(",");
      });
      return new Response(`\uFEFF${[header.map(csvCell).join(","), ...rows].join("\r\n")}`, {
        headers: {
          "cache-control": "no-store",
          "content-disposition": `attachment; filename="thinq-${marketCode.toLowerCase()}-evidence.csv"`,
          "content-type": "text/csv; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      });
    }

    const evidence = await loadLowScoreReviews(marketCode, decisions.map((decision) => decision.topicId));
    const evidenceByTopic = new Map(evidence.map((item) => [item.topicId, item.count]));
    const facts = {
      market: { code: market.code, name: market.name },
      period: meta.period,
      scope: { score: "1–2", eventExcluded: true },
      complaintRate: market.complaintRate,
      complaintRateWarning: "시장별 평점 관대함이 섞여 있어 시장 간 심각도 비교에 쓰지 않는다.",
      gaps: decisions.map((decision) => ({
        topicId: decision.topicId,
        topic: topics.get(decision.topicId)?.label,
        count: stats.get(decision.topicId)?.count,
        lift: decision.lift,
        residual: decision.residual,
        verdict: decision.verdict,
        ruleBasis: decision.ruleBasis,
        lowScoreEvidenceCount: evidenceByTopic.get(decision.topicId) ?? 0,
      })),
    };
    const prompt = `LG ThinQ VOC 시장 리포트의 마크다운 본문을 작성하라.

규칙:
- 아래 사실 JSON만 사용하고 원인·추이·증감을 추측하지 마라. 사실에 없는 내용은 “확인 필요”로 남겨라.
- 한국어로 간결하게 작성하고, 제목은 시장명을 포함한 H1으로 쓰라.
- “## 핵심 요약”, “## 갭 목록”, “## 해석 주의” 세 섹션을 순서대로 포함하라.
- 갭 목록은 각 토픽의 판정, lift, 잔차, 건수, 규칙 근거를 누락하지 마라.
- 불만율을 시장 간 심각도 비교에 쓰지 말라는 경고를 해석 주의에 명시하라.
- 워터마크, 날짜, 코드 펜스는 출력하지 마라.

사실 JSON:
${JSON.stringify(facts)}`;
    const generated = await generateText(prompt, (text) => {
      if (
        text.includes("```") ||
        !["## 핵심 요약", "## 갭 목록", "## 해석 주의"].every((heading) => text.includes(heading))
      ) {
        throw new Error("LLM 리포트 형식이 올바르지 않습니다.");
      }
    });
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
    const markdown = `> AI 생성 초안 · 미검토 · ${date}\n\n${generated.text}\n`;
    return new Response(markdown, {
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="thinq-${marketCode.toLowerCase()}-brief.md"`,
        "content-type": "text/markdown; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof LlmConfigurationError) {
      return json("LLM API 키가 설정되지 않아 MD 초안을 생성할 수 없습니다.", 503);
    }
    return json(format === "md" ? "MD 초안 생성에 실패했습니다." : "CSV 내보내기에 실패했습니다.", 502);
  }
}
