import Link from "next/link";
import { notFound } from "next/navigation";
import AppNav from "@/components/AppNav";
import AskBar from "@/components/AskBar";
import ClassifyControl, { ReviewTranslation } from "@/components/ClassifyControl";
import DetailControls from "@/components/DetailControls";
import MarketRating from "./MarketRating";
import meta from "@/data/meta.json";
import type { GapVerdict } from "@/lib/classify";
import { getTopDecisions, loadAnalysisData, loadDailyReviewCounts, loadLowScoreReviews, type ReviewEvidence } from "@/lib/data.server";
import { hasLlmProvider } from "@/lib/llm";
import styles from "./detail.module.css";

export const dynamic = "force-dynamic";

type ChartStat = {
  topicId: number;
  topicLabel: string;
  count: number;
  lift: number;
  residual: number;
  positive: boolean;
  noise: boolean;
};

type GapView = {
  topicId: number;
  topicLabel: string;
  count: number;
  lift: number;
  residual: number;
  verdict: GapVerdict;
  ruleBasis: string;
  evidenceCount: number;
  reviews: ReviewEvidence[];
};

type Peer = { code: string; name: string; lift: number; verdict: GapVerdict };

function Verdict({ verdict }: { verdict: GapVerdict | null }) {
  return <span className={styles.pill} data-verdict={verdict ?? "판정 없음"}><i aria-hidden="true" />{verdict ?? "판정 없음"}</span>;
}

function TopicLift({ stats, topGap }: { stats: ChartStat[]; topGap: GapView | null }) {
  const visible = stats.filter((stat) => !stat.noise).sort((a, b) => b.lift - a.lift);
  const scale = Math.max(4, Math.ceil(Math.max(...visible.map((stat) => stat.lift), 1)));
  return (
    <div className={styles.topicRows}>
      {visible.map((stat) => (
        <div className={styles.topicRow} data-top={stat.topicId === topGap?.topicId || undefined} key={stat.topicId}>
          <span className={styles.topicName} title={stat.topicLabel}>
            {stat.topicLabel}{stat.positive && <small> · 긍정</small>}
          </span>
          <span className={styles.track} aria-hidden="true">
            <span className={styles.fill} style={{ width: String(Math.min(100, stat.lift / scale * 100)) + "%" }} />
            <span className={styles.one} style={{ left: String(100 / scale) + "%" }} />
          </span>
          <strong>{stat.lift.toFixed(2)}</strong>
        </div>
      ))}
      <p className={styles.topicFoot}>1.00은 전체 시장 평균 · 긍정 토픽은 갭 판정에서 제외</p>
    </div>
  );
}

function ReviewCard({ review, anchor = false }: { review: ReviewEvidence; anchor?: boolean }) {
  return (
    <article className={styles.review} id={anchor ? "review-" + review.id : undefined}>
      <div className={styles.reviewMeta}>
        <span className={styles.stars} aria-label={review.score + "점"}>
          {"★".repeat(review.score)}<span>{"★".repeat(5 - review.score)}</span>
        </span>
        <time dateTime={review.at}>{review.at.slice(0, 10)}</time>
        <span>{review.lang.toLocaleUpperCase("en-US")}</span>
      </div>
      <p lang={review.lang}>{review.content}</p>
      {anchor
        ? <ReviewTranslation reviewId={review.id} language={review.lang} />
        : <a className={styles.reviewLink} href={"#review-" + review.id}>원문·번역 보기</a>}
    </article>
  );
}

function GapCard({ gap, first, marketCode, llmAvailable }: {
  gap: GapView;
  first: boolean;
  marketCode: string;
  llmAvailable: boolean;
}) {
  return (
    <details className={styles.gapCard} open={first}>
      <summary>
        <Verdict verdict={gap.verdict} />
        <strong>{gap.topicLabel}</strong>
        <span className={styles.gapStats}>lift {gap.lift.toFixed(2)} · 잔차 {gap.residual.toFixed(2)} · {gap.count.toLocaleString("ko-KR")}건</span>
      </summary>
      <div className={styles.gapBody}>
        <div className={styles.gapSubhead}>
          <h3>최근 저평점 근거</h3>
          <span>1–2점 · 이벤트 제외 · 전체 {gap.evidenceCount.toLocaleString("ko-KR")}건</span>
        </div>
        {gap.reviews.length > 0
          ? <div className={styles.gapReviews}>{gap.reviews.map((review) => <ReviewCard review={review} anchor key={review.id} />)}</div>
          : <p className={styles.empty}>조건에 맞는 저평점 원문이 없습니다.</p>}
        <div className={styles.ruleBox}>
          <span>수치 판정</span><strong>{gap.ruleBasis}</strong>
          <p>원문 기반 LLM 재검토와 담당자 기록은 아래에서 진행합니다.</p>
        </div>
        <ClassifyControl marketCode={marketCode} topicId={gap.topicId} available={llmAvailable} />
      </div>
    </details>
  );
}

export default async function MarketPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ compare?: string }>;
}) {
  const code = (await params).code.toLocaleUpperCase("en-US");
  if (!/^[A-Z]{2}$/.test(code)) notFound();

  const [data, dailyReviewCounts] = await Promise.all([loadAnalysisData(), loadDailyReviewCounts()]);
  const market = data.markets.find((item) => item.code === code && item.isActive);
  if (!market) notFound();
  const group = data.groups.find((item) => item.id === market.groupId);
  if (!group) throw new Error("시장 그룹을 찾을 수 없습니다: " + code);

  const topics = new Map(data.topics.map((topic) => [topic.id, topic]));
  const marketStats: ChartStat[] = data.stats
    .filter((stat) => stat.marketCode === code)
    .map((stat) => {
      const topic = topics.get(stat.topicId);
      if (!topic) throw new Error("토픽을 찾을 수 없습니다: " + stat.topicId);
      return {
        topicId: stat.topicId,
        topicLabel: topic.label,
        count: stat.count,
        lift: stat.lift,
        residual: stat.residual,
        positive: topic.isPositive,
        noise: topic.isNoise,
      };
    });
  const marketDecisions = data.decisions
    .filter((decision) => decision.marketCode === code)
    .sort((a, b) => b.lift - a.lift || a.topicId - b.topicId);
  const reviewGroups = await loadLowScoreReviews(code, marketDecisions.map((gap) => gap.topicId));
  const reviewByTopic = new Map(reviewGroups.map((item) => [item.topicId, item]));
  const statByTopic = new Map(marketStats.map((stat) => [stat.topicId, stat]));
  const gaps: GapView[] = marketDecisions.map((decision) => {
    const stat = statByTopic.get(decision.topicId);
    if (!stat) throw new Error("시장 통계를 찾을 수 없습니다: " + code + ":" + decision.topicId);
    const reviewGroup = reviewByTopic.get(decision.topicId);
    return {
      ...decision,
      topicLabel: stat.topicLabel,
      count: stat.count,
      evidenceCount: reviewGroup?.count ?? 0,
      reviews: reviewGroup?.reviews ?? [],
    };
  });

  const topDecisions = getTopDecisions(data.decisions);
  const rankedMarkets = data.markets
    .filter((item) => item.isActive)
    .sort((a, b) =>
      (topDecisions.get(b.code)?.lift ?? Number.NEGATIVE_INFINITY) -
        (topDecisions.get(a.code)?.lift ?? Number.NEGATIVE_INFINITY) ||
      a.code.localeCompare(b.code),
    );
  const rank = rankedMarkets.findIndex((item) => item.code === code) + 1;
  const topGap = gaps[0] ?? null;
  const canCompareGroup = group.marketCodes.length > 1;
  const requestedCompare = (await searchParams).compare;
  const compare: "group" | "all" = requestedCompare === "all" || !canCompareGroup ? "all" : "group";
  const peerCodes = new Set(compare === "all" ? rankedMarkets.map((item) => item.code) : group.marketCodes);
  const peers: Peer[] = topGap
    ? rankedMarkets.flatMap((item) => {
        const decision = topDecisions.get(item.code);
        return item.code !== code && peerCodes.has(item.code) && decision?.topicId === topGap.topicId
          ? [{ code: item.code, name: item.name, lift: decision.lift, verdict: decision.verdict }]
          : [];
      })
    : [];
  const llmAvailable = hasLlmProvider();

  return (
    <>
      <AppNav latestDate={meta.period.to} active="detail" detailHref={"/market/" + code.toLowerCase()} />
      <main className={styles.page}>
        <div className={styles.layout}>
          <nav className={styles.marketList} aria-label="시장 목록">
            <h2>시장 {rankedMarkets.length}</h2>
            {rankedMarkets.map((item) => {
              const decision = topDecisions.get(item.code);
              return (
                <Link
                  aria-current={item.code === code ? "page" : undefined}
                  aria-label={item.name + ", " + (decision?.verdict ?? "판정 없음") + (decision ? ", lift " + decision.lift.toFixed(2) : "")}
                  className={styles.marketItem}
                  href={"/market/" + item.code}
                  key={item.code}
                >
                  <i data-verdict={decision?.verdict ?? "판정 없음"} aria-hidden="true" />
                  <span>{item.name}</span>
                  <b>{decision?.lift.toFixed(2) ?? "—"}</b>
                </Link>
              );
            })}
          </nav>

          <div className={styles.center}>
            <header className={styles.titleRow}>
              <div className={styles.titleGroup}>
                <h1>{market.name}</h1>
                <Verdict verdict={topGap?.verdict ?? null} />
                {market.lowSample && <span className={styles.smallBadge}>표본 적음</span>}
              </div>
              <Link className={styles.back} href="/">← 개요로</Link>
            </header>

            <section className={styles.card} aria-labelledby="basic-title">
              <h2 id="basic-title">기본 정보</h2>
              <dl className={styles.kv}>
                <div><dt>판정</dt><dd>{topGap?.verdict ?? "판정 없음"}</dd></div>
                <div><dt>최대 갭 토픽</dt><dd>{topGap?.topicLabel ?? "—"}</dd></div>
                <div><dt>lift</dt><dd className={styles.mono}>{topGap ? topGap.lift.toFixed(2) + "배" : "—"}</dd></div>
                <div><dt>판정 표본</dt><dd className={styles.mono}>{market.analyzedCount.toLocaleString("ko-KR")}건</dd></div>
                <div><dt>lift 순위</dt><dd>{topGap ? rankedMarkets.length + "개 중 " + rank + "위" : "—"}</dd></div>
                <div><dt>불만율(참고)</dt><dd className={styles.mono}>{market.complaintRate.toFixed(1)}%</dd></div>
              </dl>
              <p className={styles.note}>불만율은 시장별 평점 관대함이 달라 시장 간 심각도 비교에 쓰지 않습니다.</p>
            </section>

            <section className={styles.card + " " + styles.split} aria-labelledby="topic-title">
              <div className={styles.topicPanel}>
                <h2 id="topic-title">토픽별 lift <span>이 시장에서 각 토픽이 전체 평균보다 몇 배 자주 나오는지</span></h2>
                <TopicLift stats={marketStats} topGap={topGap} />
              </div>
              <MarketRating rows={dailyReviewCounts.filter((row) => row.marketCode === code)} endDate={meta.period.to} />
            </section>

            <section className={styles.card + " " + styles.summary} aria-labelledby="summary-title">
              <h2 id="summary-title">자동 요약</h2>
              {topGap ? (
                <p>
                  {market.name}에서 가장 두드러지는 토픽은 <b>{topGap.topicLabel}</b>입니다. 전체 평균보다 <b>{topGap.lift.toFixed(2)}배</b> 자주 언급됩니다.
                  {peers.length > 0
                    ? " 비교 범위에서 같은 토픽이 최대 갭인 다른 시장은 " + peers.length + "곳입니다."
                    : " 비교 범위에서 같은 토픽이 최대 갭인 다른 시장은 없습니다."}
                  {" 수치 판정은 " + topGap.verdict + "입니다."}
                  {market.lowSample && " 표본이 적어 lift 값이 흔들릴 수 있습니다."}
                </p>
              ) : <p>{market.name}은 현재 수치 기준을 통과한 갭 후보가 없습니다.</p>}
              <div className={styles.source}>
                DB의 시장 통계와 수치 판정으로 만든 문장입니다.
                {topGap && " 원문 기반 판정은 아래 갭 후보에서 실행할 수 있습니다."}
              </div>
            </section>

            <section className={styles.gapSection} aria-labelledby="gap-title">
              <div className={styles.sectionTitle}><h2 id="gap-title">갭 후보</h2><span>수치 규칙 통과 {gaps.length}건</span></div>
              {gaps.length > 0
                ? gaps.map((gap, index) => <GapCard gap={gap} first={index === 0} marketCode={code} llmAvailable={llmAvailable} key={gap.topicId} />)
                : <div className={styles.card}><p className={styles.empty}>현재 임계값을 통과한 갭 후보가 없습니다.</p></div>}
            </section>
          </div>

          <aside className={styles.side}>
            <section className={styles.card} aria-labelledby="peers-title">
              <h2 id="peers-title">같은 불만이 가장 튀는 다른 시장</h2>
              {topGap && <p className={styles.sub}>최대 갭 토픽이 <b>{topGap.topicLabel}</b>인 시장 · 오른쪽은 각 시장의 lift</p>}
              {peers.length > 0 ? (
                <div className={styles.peerList}>{peers.map((peer) => (
                  <div className={styles.peer} key={peer.code}>
                    <i data-verdict={peer.verdict} aria-hidden="true" />
                    <Link href={"/market/" + peer.code}>{peer.name}</Link>
                    <b>{peer.lift.toFixed(2)}</b>
                  </div>
                ))}</div>
              ) : <p className={styles.empty}>{topGap ? "비교 범위에서 같은 토픽이 최대 갭인 다른 시장이 없습니다." : "판정된 최대 갭 토픽이 없습니다."}</p>}
              <p className={styles.peerNote}>{compare === "group" ? group.name : "전체 시장"} 기준 · 비교 대상은 아래에서 변경</p>
            </section>
            <section className={styles.card} aria-labelledby="representative-title">
              <h2 id="representative-title">대표 리뷰</h2>
              <p className={styles.sub}>최대 갭 토픽 · 최근 1–2점 · 이벤트 제외</p>
              {topGap?.reviews.length ? topGap.reviews.map((review) => <ReviewCard review={review} key={review.id} />)
                : <p className={styles.empty}>연결된 저평점 원문이 없습니다.</p>}
            </section>
            <section className={styles.card + " " + styles.askCard} aria-labelledby="ask-title">
              <h2 id="ask-title">리뷰 질의</h2>
              <AskBar marketCode={code} topicId={topGap?.topicId} available={llmAvailable} />
            </section>
            <div className={styles.exports}><DetailControls code={code} compare={compare} canCompareGroup={canCompareGroup} /></div>
          </aside>
        </div>
      </main>
    </>
  );
}
