import MarketTable, { type MarketRow } from "@/components/MarketTable";
import meta from "@/data/meta.json";
import { getTopDecisions, loadAnalysisData, loadDailyReviewCounts } from "@/lib/data.server";
import { hasLlmProvider } from "@/lib/llm";

export const dynamic = "force-dynamic";

async function loadMarkets(): Promise<{ rows: MarketRow[]; groups: { id: number; name: string; marketCodes: readonly string[] }[] }> {
  const { markets, topics, decisions, groups } = await loadAnalysisData();
  const topicLabel = new Map(topics.map((topic) => [topic.id, topic.label]));
  const topGap = getTopDecisions(decisions);

  const rows = markets
    .filter((market) => market.isActive)
    .map((market) => {
      const gap = topGap.get(market.code);
      return {
        code: market.code,
        name: market.name,
        complaintRate: market.complaintRate,
        collectedCount: market.collectedCount,
        analyzedCount: market.analyzedCount,
        lowSample: market.lowSample,
        topicLabel: gap ? (topicLabel.get(gap.topicId) ?? null) : null,
        lift: gap?.lift ?? null,
        verdict: gap?.verdict ?? null,
      };
    })
    .sort(
      (a, b) =>
        (b.lift ?? Number.NEGATIVE_INFINITY) -
          (a.lift ?? Number.NEGATIVE_INFINITY) || a.code.localeCompare(b.code),
    );
  return { rows, groups };
}

export default async function Home() {
  const [{ rows, groups }, dailyReviews] = await Promise.all([loadMarkets(), loadDailyReviewCounts()]);

  return (
    <MarketTable
      rows={rows}
      groups={groups}
      dailyReviews={dailyReviews}
      llmAvailable={hasLlmProvider()}
      meta={{
        latestDate: meta.period.to,
        periodFrom: meta.period.from,
        periodTo: meta.period.to,
        collectedCount: meta.counts.collected,
        analyzedCount: meta.counts.analyzed_no_event,
        topicCount: meta.topics.length,
        eventWindow: meta.event_window,
      }}
    />
  );
}
