import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import meta from "@/data/meta.json";
import {
  classifyGaps,
  type GapDecision,
  type MarketGroup,
  type MarketStat,
} from "@/lib/classify";

export type Market = {
  code: string;
  name: string;
  groupId: number;
  analyzedCount: number;
  collectedCount: number;
  complaintRate: number;
  lowSample: boolean;
  isActive: boolean;
};

export type Topic = {
  id: number;
  label: string;
  overallShare: number;
  isPositive: boolean;
  isNoise: boolean;
};

export type TopicStat = MarketStat & {
  count: number;
  share: number;
};

export type AnalysisData = {
  markets: Market[];
  topics: Topic[];
  groups: MarketGroup[];
  stats: TopicStat[];
  decisions: GapDecision[];
};

export type ReviewEvidence = {
  id: number;
  topicId: number;
  lang: string;
  unit: string;
  score: number;
  at: string;
  appVersion: string | null;
  content: string;
};

export type SimilarReview = {
  id: number;
  marketCode: string;
  topicId: number;
  lang: string;
  score: number;
  at: string;
  content: string;
  similarity: number;
};

/** UTC day and market counts for each star rating, including the flagged event period. */
export type DailyReviewCount = {
  date: string;
  marketCode: string;
  stars: [number, number, number, number, number];
};

export class ReviewSearchUnavailableError extends Error {}

type SimilarReviewRow = {
  id: number;
  market_code: string;
  topic_id: number;
  lang: string;
  score: number;
  at: string;
  content: string;
  similarity: number;
};

export function createPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase 공개 연결 정보가 없습니다.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function queryDailyReviewCounts(): Promise<DailyReviewCount[]> {
  const supabase = createPublicClient();
  const pageSize = 1000;
  const first = await supabase
    .from("reviews")
    .select("market_code,score,at", { count: "exact" })
    .order("id")
    .range(0, pageSize - 1);
  if (first.error) throw new Error(first.error.message);

  if (first.count === null) throw new Error("리뷰 전체 건수를 확인하지 못했습니다.");
  const total = first.count;
  const rows = [...(first.data ?? [])];
  const pageCount = Math.ceil(total / pageSize);
  for (let page = 1; page < pageCount; page += 6) {
    const pages = await Promise.all(
      Array.from({ length: Math.min(6, pageCount - page) }, (_, index) => {
        const start = (page + index) * pageSize;
        return supabase
          .from("reviews")
          .select("market_code,score,at")
          .order("id")
          .range(start, start + pageSize - 1);
      }),
    );
    for (const result of pages) {
      if (result.error) throw new Error(result.error.message);
      rows.push(...(result.data ?? []));
    }
  }
  if (rows.length !== total) throw new Error("일별 리뷰 집계 중 일부 행을 읽지 못했습니다.");

  const counts = new Map<string, DailyReviewCount>();
  for (const review of rows) {
    const date = review.at.slice(0, 10);
    const key = `${date}:${review.market_code}`;
    let daily = counts.get(key);
    if (!daily) {
      daily = { date, marketCode: review.market_code, stars: [0, 0, 0, 0, 0] };
      counts.set(key, daily);
    }
    daily.stars[review.score - 1] += 1;
  }
  return [...counts.values()].sort((a, b) =>
    a.date === b.date ? a.marketCode.localeCompare(b.marketCode) : a.date.localeCompare(b.date),
  );
}

export const loadDailyReviewCounts = unstable_cache(
  queryDailyReviewCounts,
  ["daily-review-counts"],
  { revalidate: 3600 },
);

export async function searchReviews(
  vector: readonly number[],
  marketCode: string,
  topicId?: number,
  limit = 8,
): Promise<SimilarReview[]> {
  const { data, error } = await createPublicClient().rpc("match_reviews", {
    query_embedding: vector,
    filter_market_code: marketCode,
    filter_topic_id: topicId ?? null,
    match_count: limit,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new ReviewSearchUnavailableError("match_reviews 함수가 아직 적용되지 않았습니다.");
    }
    throw new Error(error.message);
  }
  return ((data ?? []) as SimilarReviewRow[]).map((review) => ({
    id: review.id,
    marketCode: review.market_code,
    topicId: review.topic_id,
    lang: review.lang,
    score: review.score,
    at: review.at,
    content: review.content,
    similarity: review.similarity,
  }));
}

export async function loadLowScoreReviews(marketCode: string, topicIds: readonly number[]) {
  const supabase = createPublicClient();
  const results = await Promise.all(
    topicIds.map((topicId) =>
      supabase
        .from("reviews")
        .select("id,topic_id,lang,unit,score,at,app_version,content", { count: "exact" })
        .eq("market_code", marketCode)
        .eq("topic_id", topicId)
        .eq("is_event", false)
        .lte("score", 2)
        .order("at", { ascending: false })
        .order("id", { ascending: false })
        .limit(3),
    ),
  );

  return results.map((result, index) => {
    if (result.error) throw new Error(result.error.message);
    return {
      topicId: topicIds[index],
      count: result.count ?? 0,
      reviews: (result.data ?? []).map((review) => ({
        id: review.id,
        topicId: review.topic_id,
        lang: review.lang,
        unit: review.unit,
        score: review.score,
        at: review.at,
        appVersion: review.app_version,
        content: review.content,
      })),
    };
  });
}

export async function loadAnalysisData(): Promise<AnalysisData> {
  const supabase = createPublicClient();
  const [marketResult, statResult, topicResult, groupResult] = await Promise.all([
    supabase
      .from("markets")
      .select(
        "code,name,group_id,analyzed_count,collected_count,complaint_rate,low_sample,is_active",
      ),
    supabase.from("market_stats").select("market_code,topic_id,count,share,lift,residual"),
    supabase.from("topics").select("id,label,overall_share,is_positive,is_noise"),
    supabase.from("market_groups").select("id,name"),
  ]);

  for (const result of [marketResult, statResult, topicResult, groupResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const markets: Market[] = (marketResult.data ?? []).map((market) => ({
    code: market.code,
    name: market.name,
    groupId: market.group_id,
    analyzedCount: market.analyzed_count,
    collectedCount: market.collected_count,
    complaintRate: market.complaint_rate,
    lowSample: market.low_sample,
    isActive: market.is_active,
  }));
  const topics: Topic[] = (topicResult.data ?? []).map((topic) => ({
    id: topic.id,
    label: topic.label,
    overallShare: topic.overall_share,
    isPositive: topic.is_positive,
    isNoise: topic.is_noise,
  }));
  const stats: TopicStat[] = (statResult.data ?? []).map((stat) => ({
    marketCode: stat.market_code,
    topicId: stat.topic_id,
    count: stat.count,
    share: stat.share,
    lift: stat.lift,
    residual: stat.residual,
  }));
  const groups: MarketGroup[] = (groupResult.data ?? []).map((group) => ({
    id: group.id,
    name: group.name,
    marketCodes: markets
      .filter((market) => market.groupId === group.id)
      .map((market) => market.code),
  }));
  const decisions = classifyGaps({
    stats,
    groups,
    excludedTopicIds: new Set(
      topics.filter((topic) => topic.isPositive || topic.isNoise).map((topic) => topic.id),
    ),
    thresholds: {
      lift: meta.thresholds.lift,
      residual: meta.thresholds.residual,
      groupCommon: meta.thresholds.group_common,
      partialCommon: meta.thresholds.partial_common,
    },
  });

  return { markets, topics, groups, stats, decisions };
}

export function getTopDecisions(decisions: readonly GapDecision[]) {
  const result = new Map<string, GapDecision>();
  for (const decision of decisions) {
    const current = result.get(decision.marketCode);
    if (
      !current ||
      decision.lift > current.lift ||
      (decision.lift === current.lift && decision.topicId < current.topicId)
    ) {
      result.set(decision.marketCode, decision);
    }
  }
  return result;
}
