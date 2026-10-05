export type GapVerdict =
  | "광역 공통"
  | "그룹 공통"
  | "부분 공통"
  | "현지화 갭"
  | "단독 시장";

export type Thresholds = {
  lift: number;
  residual: number;
  groupCommon: number;
  partialCommon: number;
};

export type MarketGroup = {
  id: number;
  name: string;
  marketCodes: readonly string[];
};

export type MarketStat = {
  marketCode: string;
  topicId: number;
  lift: number;
  residual: number;
};

export type GapDecision = MarketStat & {
  verdict: GapVerdict;
  ruleBasis: string;
};

type ClassifyInput = {
  stats: readonly MarketStat[];
  groups: readonly MarketGroup[];
  excludedTopicIds: ReadonlySet<number>;
  thresholds: Thresholds;
};

const statKey = (marketCode: string, topicId: number) => `${marketCode}:${topicId}`;

export function classifyGaps({
  stats,
  groups,
  excludedTopicIds,
  thresholds,
}: ClassifyInput): GapDecision[] {
  const statByKey = new Map<string, MarketStat>();
  const groupByMarket = new Map<string, MarketGroup>();

  for (const stat of stats) {
    if (![stat.lift, stat.residual].every(Number.isFinite)) {
      throw new Error(`Non-finite statistic: ${statKey(stat.marketCode, stat.topicId)}`);
    }
    const key = statKey(stat.marketCode, stat.topicId);
    if (statByKey.has(key)) throw new Error(`Duplicate statistic: ${key}`);
    statByKey.set(key, stat);
  }

  for (const group of groups) {
    for (const marketCode of group.marketCodes) {
      if (groupByMarket.has(marketCode)) throw new Error(`Market belongs to multiple groups: ${marketCode}`);
      groupByMarket.set(marketCode, group);
    }
  }

  const getLift = (marketCode: string, topicId: number) => {
    const stat = statByKey.get(statKey(marketCode, topicId));
    if (!stat) throw new Error(`Missing statistic: ${statKey(marketCode, topicId)}`);
    return stat.lift;
  };

  const broadBasisByTopic = new Map<number, string | null>();
  const getBroadBasis = (topicId: number) => {
    if (broadBasisByTopic.has(topicId)) return broadBasisByTopic.get(topicId) ?? null;

    const qualifying = groups
      .filter((group) => group.marketCodes.length > 1)
      .map((group) => {
        const hits = group.marketCodes.filter(
          (marketCode) => getLift(marketCode, topicId) >= thresholds.lift,
        ).length;
        return { group, ratio: hits / group.marketCodes.length };
      })
      .filter(({ ratio }) => ratio >= thresholds.groupCommon);

    const basis =
      qualifying.length >= 2
        ? qualifying
            .map(({ group, ratio }) => `${group.name} ${Math.round(ratio * 100)}%`)
            .join(" · ")
        : null;
    broadBasisByTopic.set(topicId, basis);
    return basis;
  };

  return stats
    .filter(
      (stat) =>
        !excludedTopicIds.has(stat.topicId) &&
        stat.lift >= thresholds.lift &&
        Math.abs(stat.residual) >= thresholds.residual,
    )
    .map((stat) => {
      const broadBasis = getBroadBasis(stat.topicId);
      if (broadBasis) return { ...stat, verdict: "광역 공통", ruleBasis: broadBasis };

      const group = groupByMarket.get(stat.marketCode);
      if (!group) throw new Error(`Market has no group: ${stat.marketCode}`);

      const neighbors = group.marketCodes.filter((marketCode) => marketCode !== stat.marketCode);
      if (neighbors.length === 0) {
        return { ...stat, verdict: "단독 시장", ruleBasis: "비교할 이웃 없음" };
      }

      const hits = neighbors.filter(
        (marketCode) => getLift(marketCode, stat.topicId) >= thresholds.lift,
      ).length;
      const ratio = hits / neighbors.length;
      const verdict: GapVerdict =
        ratio >= thresholds.groupCommon
          ? "그룹 공통"
          : ratio >= thresholds.partialCommon
            ? "부분 공통"
            : "현지화 갭";

      return {
        ...stat,
        verdict,
        ruleBasis: `${group.name} 이웃 ${hits}/${neighbors.length}`,
      };
    });
}
