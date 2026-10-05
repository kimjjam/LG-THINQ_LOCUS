"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AppNav from "@/components/AppNav";
import type { GapVerdict } from "@/lib/classify";
import s from "./MarketTable.module.css";

export type MarketRow = {
  code: string; name: string; complaintRate: number; collectedCount: number;
  analyzedCount: number; lowSample: boolean; topicLabel: string | null;
  lift: number | null; verdict: GapVerdict | null;
};
export type DailyReviewCount = {
  date: string; marketCode: string; stars: [number, number, number, number, number];
};
export type MarketGroupRow = { id: number; name: string; marketCodes: readonly string[] };
type Props = {
  rows: MarketRow[];
  dailyReviews: DailyReviewCount[];
  groups: MarketGroupRow[];
  llmAvailable: boolean;
  meta: {
    latestDate: string; periodFrom: string; periodTo: string;
    collectedCount: number; analyzedCount: number; topicCount: number;
    eventWindow: { from: string; to: string; note: string };
  };
};
type Stars = [number, number, number, number, number];
type Grain = "day" | "week" | "month";
type Bucket = { key: string; from: string; to: string; stars: Stars; groups: Map<number, Stars> };
type Rating = { count: number; average: number | null; low: number | null };
const DAY = 86_400_000;
const LIMIT = 62;
const MIN_SAMPLE = 5;
const fmt = new Intl.NumberFormat("ko-KR");
const verdicts: (GapVerdict | "판정 없음")[] = ["광역 공통", "그룹 공통", "부분 공통", "단독 시장", "현지화 갭", "판정 없음"];
const verdictClass: Record<GapVerdict | "판정 없음", string> = {
  "광역 공통": s.wide, "그룹 공통": s.group, "부분 공통": s.partial,
  "단독 시장": s.solo, "현지화 갭": s.local, "판정 없음": s.none,
};
const at = (day: string) => Date.parse(day + "T00:00:00Z");
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
const shift = (day: string, amount: number) => iso(at(day) + amount * DAY);
const daysBetween = (a: string, b: string) => Math.round((at(b) - at(a)) / DAY) + 1;
const empty = (): Stars => [0, 0, 0, 0, 0];
function add(a: Stars, b: Stars) { for (let i = 0; i < 5; i++) a[i] += b[i]; }
function rating(stars: Stars): Rating {
  const count = stars.reduce((a, b) => a + b, 0);
  return count ? {
    count,
    average: stars.reduce((a, b, i) => a + b * (i + 1), 0) / count,
    low: (stars[0] + stars[1]) / count,
  } : { count, average: null, low: null };
}
function bucketKey(date: string, grain: Grain) {
  if (grain === "day") return date;
  if (grain === "month") return date.slice(0, 7);
  return shift(date, -(new Date(at(date)).getUTCDay() + 6) % 7);
}
function bucketCount(from: string, to: string, grain: Grain) {
  const keys = new Set<string>();
  for (let time = at(from); time <= at(to); time += DAY) keys.add(bucketKey(iso(time), grain));
  return keys.size;
}
function niceStep(value: number) {
  const power = 10 ** Math.floor(Math.log10(value || 1));
  const scaled = value / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
}
function csvCell(value: string | number) {
  const valueText = String(value);
  const safe = /^[\t\r\n ]*[=+\-@]/.test(valueText) ? "'" + valueText : valueText;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export default function MarketTable({ rows, dailyReviews, groups, meta, llmAvailable }: Props) {
  const router = useRouter();
  const eventEnd = shift(meta.eventWindow.to, -1);
  const initialFrom = meta.eventWindow.from >= meta.periodFrom && meta.eventWindow.from <= meta.periodTo
    ? meta.eventWindow.from : (shift(meta.periodTo, -29) < meta.periodFrom ? meta.periodFrom : shift(meta.periodTo, -29));
  const initialTo = initialFrom === meta.eventWindow.from
    ? (shift(initialFrom, 20) > meta.periodTo ? meta.periodTo : shift(initialFrom, 20)) : meta.periodTo;
  const [range, setRangeState] = useState({ from: initialFrom, to: initialTo });
  const [pending, setPending] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(initialTo.slice(0, 7));
  const [grain, setGrain] = useState<Grain>("day");
  const [view, setView] = useState<"all" | "group">("all");
  const [chosen, setChosen] = useState(() => new Set(groups.map((g) => g.id)));
  const [active, setActive] = useState<number | null>(null);
  const [filter, setFilter] = useState<GapVerdict | "판정 없음" | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!llmAvailable) return;
    void import("@/lib/embed").then(({ preloadQueryEmbedder }) => preloadQueryEmbedder()).catch(() => undefined);
  }, [llmAvailable]);

  const selectedGroups = useMemo(() => groups.filter((g) => chosen.has(g.id)), [groups, chosen]);
  const selectedCodes = useMemo(() => new Set(selectedGroups.flatMap((g) => g.marketCodes)), [selectedGroups]);
  const groupByMarket = useMemo(() => new Map(groups.flatMap((g) => g.marketCodes.map((code) => [code, g.id] as const))), [groups]);
  const data = useMemo(() => {
    const daily = new Map<string, Stars>();
    const groupDaily = new Map<number, Map<string, Stars>>();
    const allStars = empty();
    for (const row of dailyReviews) {
      if (!selectedCodes.has(row.marketCode)) continue;
      const groupId = groupByMarket.get(row.marketCode);
      if (groupId === undefined) continue;
      const dayStars = daily.get(row.date) ?? empty();
      add(dayStars, row.stars);
      daily.set(row.date, dayStars);
      let groupDays = groupDaily.get(groupId);
      if (!groupDays) { groupDays = new Map(); groupDaily.set(groupId, groupDays); }
      const groupStars = groupDays.get(row.date) ?? empty();
      add(groupStars, row.stars);
      groupDays.set(row.date, groupStars);
      add(allStars, row.stars);
    }
    const buckets: Bucket[] = [];
    for (let time = at(range.from); time <= at(range.to); time += DAY) {
      const date = iso(time);
      const key = bucketKey(date, grain);
      let bucket = buckets[buckets.length - 1];
      if (!bucket || bucket.key !== key) {
        bucket = { key, from: date, to: date, stars: empty(), groups: new Map() };
        buckets.push(bucket);
      }
      bucket.to = date;
      add(bucket.stars, daily.get(date) ?? empty());
      for (const group of selectedGroups) {
        const total = bucket.groups.get(group.id) ?? empty();
        add(total, groupDaily.get(group.id)?.get(date) ?? empty());
        bucket.groups.set(group.id, total);
      }
    }
    const selectedStars = empty();
    for (const bucket of buckets) add(selectedStars, bucket.stars);
    return { buckets, selected: rating(selectedStars), all: rating(allStars) };
  }, [dailyReviews, selectedCodes, groupByMarket, range, grain, selectedGroups]);

  const bucketRatings = data.buckets.map((b) => rating(b.stars));
  const worst = data.buckets
    .map((bucket, i) => ({ bucket, ...bucketRatings[i] }))
    .filter((item) => item.count >= MIN_SAMPLE)
    .reduce<({ bucket: Bucket } & Rating) | null>(
      (best, item) => !best || (item.average ?? 5) < (best.average ?? 5) ? item : best, null);
  const visibleRows = rows.filter((row) => {
    const term = query.trim().toLocaleLowerCase("ko-KR");
    return (!filter || (row.verdict ?? "판정 없음") === filter)
      && (!term || [row.name, row.code, row.topicLabel ?? ""].some((v) => v.toLocaleLowerCase("ko-KR").includes(term)));
  });
  const counts = new Map(verdicts.map((v) => [v, rows.filter((r) => (r.verdict ?? "판정 없음") === v).length]));
  const judged = rows.length - (counts.get("판정 없음") ?? 0);
  const common = (counts.get("광역 공통") ?? 0) + (counts.get("그룹 공통") ?? 0) + (counts.get("부분 공통") ?? 0);
  const maxLift = Math.max(1, ...rows.map((r) => r.lift ?? 0));
  const rangeDays = daysBetween(range.from, range.to);
  const eventInRange = range.from <= eventEnd && range.to >= meta.eventWindow.from;

  function setRange(a: string, b: string) {
    const from = a < b ? a : b, to = a < b ? b : a;
    setRangeState({ from, to });
    setPending(null); setHover(null); setActive(null); setCalendarMonth(to.slice(0, 7));
    if (bucketCount(from, to, grain) > LIMIT) setGrain(bucketCount(from, to, "week") <= LIMIT ? "week" : "month");
  }
  function chooseDay(date: string) {
    if (!pending) { setPending(date); setHover(date); }
    else setRange(pending, date);
  }
  function toggleGroup(id: number) {
    setChosen((current) => {
      if (current.has(id) && current.size === 1) return current;
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setActive(null);
  }
  function downloadCsv() {
    const header = ["순위", "코드", "시장", "불만율", "수집", "분석", "최대 갭 토픽", "lift", "판정"];
    const body = visibleRows.map((row) => [
      rows.indexOf(row) + 1, row.code, row.name, row.complaintRate, row.collectedCount,
      row.analyzedCount, row.topicLabel ?? "", row.lift?.toFixed(4) ?? "", row.verdict ?? "",
    ].map(csvCell).join(","));
    const blob = new Blob(["\uFEFF" + [header.map(csvCell).join(","), ...body].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "thinq-markets-" + meta.latestDate + ".csv"; link.click();
    URL.revokeObjectURL(url);
  }

  const [year, month] = calendarMonth.split("-").map(Number);
  const monthStart = Date.UTC(year, month - 1, 1);
  const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (new Date(monthStart).getUTCDay() + 6) % 7;
  const bandFrom = pending ? pending < (hover ?? pending) ? pending : hover ?? pending : range.from;
  const bandTo = pending ? pending > (hover ?? pending) ? pending : hover ?? pending : range.to;
  const maxCount = Math.max(1, ...bucketRatings.map((r) => r.count));
  let step = niceStep(maxCount / 4);
  if (step * 4 < maxCount) step = niceStep(step * 2);
  const ceiling = step * 4;
  const W = 680, H = 320, L = 52, R = view === "group" ? 120 : 48, T = 34, B = 38;
  const plotW = W - L - R, plotH = H - T - B, slot = plotW / Math.max(1, data.buckets.length);
  const barW = Math.max(3, Math.min(30, slot * .56));
  const x = (i: number) => L + slot * (i + .5);
  const cy = (count: number) => T + plotH - count / ceiling * plotH;
  const ry = (avg: number) => T + plotH - (avg - 1) / 4 * plotH;
  const lines = view === "all"
    ? [{ id: "all", name: "평균 별점", color: "var(--accent)", values: bucketRatings }]
    : selectedGroups.map((g) => ({
      id: String(g.id), name: g.name, color: "var(--s" + (groups.findIndex((item) => item.id === g.id) % 5 + 1) + ")",
      values: data.buckets.map((b) => rating(b.groups.get(g.id) ?? empty())),
    }));
  const missing = lines.some((line) => line.values.some((v) => v.count < MIN_SAMPLE));
  const lineLabels = lines
    .map((line) => ({ line, last: [...line.values].reverse().find((point) => point.count >= MIN_SAMPLE && point.average !== null) }))
    .filter((item): item is { line: typeof lines[number]; last: Rating & { average: number } } => item.last?.average != null)
    .map(({ line, last }) => ({ id: line.id, y: ry(last.average) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < lineLabels.length; i++) {
    if (lineLabels[i].y - lineLabels[i - 1].y < 14) lineLabels[i].y = lineLabels[i - 1].y + 14;
  }

  return <>
    <AppNav latestDate={meta.latestDate} detailHref={rows[0] ? "/market/" + rows[0].code.toLowerCase() : "/"} />
    <main className={s.wrap}>
      <header className={s.head}>
        <div><h1>별점 추이</h1><p>달력에서 두 날짜를 누르면 위 요약과 아래 별점 흐름이 그 기간으로 바뀝니다</p></div>
        <span className={s.sample}>분석 리뷰 기준</span>
      </header>

      <section className={s.stats} aria-label="선택 기간 요약">
        <div className={s.stat}><span className={s.statKey}>평균 별점</span><strong className={s.statValue}>{data.selected.average?.toFixed(2) ?? "—"}<small> / 5</small></strong><span className={s.statDetail}>전체 기간 {data.all.average?.toFixed(2) ?? "—"} 대비 {data.selected.average !== null && data.all.average !== null ? (data.selected.average - data.all.average >= 0 ? "+" : "") + (data.selected.average - data.all.average).toFixed(2) : "—"}</span></div>
        <div className={s.stat}><span className={s.statKey}>1–2점 비중</span><strong className={s.statValue}>{data.selected.low === null ? "—" : (data.selected.low * 100).toFixed(1) + "%"}</strong><span className={s.statDetail}>전체 기간 대비 {data.selected.low !== null && data.all.low !== null ? ((data.selected.low - data.all.low) * 100 >= 0 ? "+" : "") + ((data.selected.low - data.all.low) * 100).toFixed(1) + "%p" : "—"}</span></div>
        <div className={s.stat}><span className={s.statKey}>가장 낮았던 {grain === "day" ? "날" : grain === "week" ? "주" : "달"}</span><strong className={s.statValue}>{worst ? grain === "month" ? worst.bucket.key : worst.bucket.from.slice(5).replace("-", "/") + (grain === "week" ? " 주" : "") : "—"}</strong><span className={s.statDetail}>{worst ? "평균 " + worst.average?.toFixed(2) + "점 · " + fmt.format(worst.count) + "건" : "표본 없음"}</span></div>
        <div className={s.stat}><span className={s.statKey}>리뷰 수</span><strong className={s.statValue}>{fmt.format(data.selected.count)}<small>건</small></strong><span className={s.statDetail}>{rangeDays}일 · 하루 평균 {fmt.format(Math.round(data.selected.count / rangeDays))}건</span></div>
      </section>

      <div className={s.chips} role="group" aria-label="시장 그룹">
        {groups.map((g, i) => <button key={g.id} type="button" className={s.chip} aria-pressed={chosen.has(g.id)} onClick={() => toggleGroup(g.id)}><i aria-hidden="true" style={{ background: "var(--s" + (i % 5 + 1) + ")" }} />{g.name}</button>)}
      </div>

      <div className={s.grid}>
        <section className={s.card} aria-label="기간 선택">
          <h2>기간 선택</h2>
          <div className={s.range}>{pending ? pending.replaceAll("-", ".") + " – " : range.from.replaceAll("-", ".") + " – " + range.to.replaceAll("-", ".")}{pending ? <small>종료일을 눌러 주세요</small> : <small>{rangeDays}일</small>}</div>
          <div className={s.presets}>
            {[7, 30, 90].map((days) => <button key={days} type="button" onClick={() => setRange(shift(meta.periodTo, 1 - days) < meta.periodFrom ? meta.periodFrom : shift(meta.periodTo, 1 - days), meta.periodTo)}>{days === 90 ? "최근 3개월" : "최근 " + days + "일"}</button>)}
            <button type="button" onClick={() => setRange(meta.eventWindow.from, eventEnd)}>이상 급증 구간</button>
          </div>
          <div className={s.calendarHead}>
            <button type="button" aria-label="이전 달" disabled={calendarMonth <= meta.periodFrom.slice(0, 7)} onClick={() => setCalendarMonth(iso(Date.UTC(year, month - 2, 1)).slice(0, 7))}>‹</button>
            <b>{calendarMonth.replace("-", ".")}</b>
            <button type="button" aria-label="다음 달" disabled={calendarMonth >= meta.periodTo.slice(0, 7)} onClick={() => setCalendarMonth(iso(Date.UTC(year, month, 1)).slice(0, 7))}>›</button>
          </div>
          <div className={s.calendar}>
            {["월", "화", "수", "목", "금", "토", "일"].map((label) => <span key={label} className={s.weekday}>{label}</span>)}
            {Array.from({ length: lead }, (_, i) => <span key={"blank-" + i} />)}
            {Array.from({ length: monthDays }, (_, i) => {
              const date = iso(Date.UTC(year, month - 1, i + 1));
              const available = date >= meta.periodFrom && date <= meta.periodTo;
              const column = (lead + i) % 7;
              const inBand = date >= bandFrom && date <= bandTo && bandFrom !== bandTo;
              const event = date >= meta.eventWindow.from && date < meta.eventWindow.to;
              return <span key={date} className={[s.calendarCell, inBand ? s.band : "", pending && inBand ? s.preview : "", inBand && (date === bandFrom || column === 0 || i === 0) ? s.bandFirst : "", inBand && (date === bandTo || column === 6 || i === monthDays - 1) ? s.bandLast : ""].join(" ")}>
                <button type="button" className={[s.day, date === bandFrom || date === bandTo ? s.endpoint : "", event ? s.eventDay : ""].join(" ")} disabled={!available} aria-label={date + (event ? " 이상 급증 구간" : "")} onClick={() => chooseDay(date)} onMouseEnter={() => pending && setHover(date)} onFocus={() => pending && setHover(date)}>{i + 1}</button>
              </span>;
            })}
          </div>
          <p className={s.hint}>{pending ? "종료일을 누르면 기간이 정해집니다. 시작일보다 앞 날짜도 고를 수 있습니다." : "날짜를 다시 누르면 새 기간을 고를 수 있습니다."}</p>
          <div className={s.eventKey}><i />이상 급증 구간</div>
        </section>

        <section className={s.card} aria-label="리뷰 수와 평균 별점">
          <div className={s.chartTop}>
            <div className={s.chartControls}><h2>리뷰 수 · 평균 별점</h2><div className={s.segmented} role="group" aria-label="집계 단위">
              {([["day", "일"], ["week", "주"], ["month", "월"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={grain === value} disabled={bucketCount(range.from, range.to, value) > LIMIT} onClick={() => { setGrain(value); setActive(null); }}>{label}</button>)}
            </div></div>
            <div className={s.chartControls}><div className={s.legend}><span><i className={s.swatch} />리뷰 수</span>{view === "all" && <span><i className={s.lineKey} />평균 별점</span>}</div><div className={s.quietSegmented} role="group" aria-label="별점 보기"><button type="button" aria-pressed={view === "all"} onClick={() => setView("all")}>전체</button><button type="button" aria-pressed={view === "group"} onClick={() => setView("group")}>그룹별</button></div></div>
          </div>
          {dailyReviews.length ? <div className={s.chartBox}>
            <svg viewBox="0 0 680 320" role="img" aria-label="선택 기간의 분석 리뷰 수와 평균 별점">
              {Array.from({ length: 5 }, (_, i) => { const y = T + plotH - i / 4 * plotH; return <g key={i}><line x1={L} x2={W - R} y1={y} y2={y} stroke="var(--line)" /><text x={L - 8} y={y + 4} textAnchor="end" className={s.axis}>{fmt.format(step * i)}</text><text x={W - R + 8} y={y + 4} className={s.ratingAxis}>{(1 + i).toFixed(1)}</text></g>; })}
              <text x={4} y={T - 14} className={s.axisTitle}>리뷰 수(건)</text><text x={W - R + 8} y={T - 14} className={s.ratingTitle}>별점</text>
              {data.buckets.map((b, i) => {
                const y = cy(bucketRatings[i].count);
                const event = b.from < meta.eventWindow.to && b.to >= meta.eventWindow.from;
                return <g key={b.key}>
                  {event && <rect x={L + slot * i} y={T} width={slot} height={plotH} className={s.eventShade} />}
                  <rect x={x(i) - barW / 2} y={y} width={barW} height={Math.max(0, cy(0) - y)} rx={Math.min(4, barW / 2)} className={active === i ? s.barActive : s.bar} />
                  {i % Math.max(1, Math.ceil(data.buckets.length / 9)) === 0 && <text x={x(i)} y={H - 14} textAnchor="middle" className={s.axis}>{grain === "month" ? b.key.slice(2).replace("-", ".") : b.from.slice(5).replace("-", "/")}</text>}
                </g>;
              })}
              <line x1={L} x2={W - R} y1={cy(0)} y2={cy(0)} stroke="var(--line-2)" />
              {lines.map((line) => {
                let path = "", drawing = false;
                line.values.forEach((point, i) => {
                  if (point.count >= MIN_SAMPLE && point.average !== null) { path += (drawing ? "L" : "M") + x(i) + "," + ry(point.average); drawing = true; }
                  else drawing = false;
                });
                const last = [...line.values].reverse().find((point) => point.count >= MIN_SAMPLE && point.average !== null);
                return <g key={line.id}><path d={path} fill="none" stroke={line.color} strokeWidth={view === "all" ? 2.5 : 2} strokeLinejoin="round" strokeLinecap="round" />
                  {data.buckets.length <= 31 && line.values.map((point, i) => point.count >= MIN_SAMPLE && point.average !== null ? <circle key={i} cx={x(i)} cy={ry(point.average)} r={3.5} fill={line.color} stroke="var(--surface)" strokeWidth={1.5} /> : null)}
                  {view === "group" && last && last.average !== null && <g><circle cx={W - R + 46} cy={lineLabels.find((item) => item.id === line.id)?.y ?? ry(last.average)} r={4} fill={line.color} /><text x={W - R + 54} y={(lineLabels.find((item) => item.id === line.id)?.y ?? ry(last.average)) + 4} className={s.groupLabel}>{line.name}</text></g>}
                </g>;
              })}
              {data.buckets.map((b, i) => <rect key={"hit-" + b.key} x={L + slot * i} y={T} width={slot} height={plotH} fill="transparent" tabIndex={0} aria-label={b.from + (b.to !== b.from ? "부터 " + b.to + "까지" : "") + ", 리뷰 " + fmt.format(bucketRatings[i].count) + "건"} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} />)}
            </svg>
            {active !== null && data.buckets[active] && <div className={s.tooltip} style={{ left: x(active) / W * 100 + "%" }}><strong>{data.buckets[active].from}{data.buckets[active].to !== data.buckets[active].from ? " – " + data.buckets[active].to : ""}</strong><span>리뷰 수 <b>{fmt.format(bucketRatings[active].count)}건</b></span>{lines.map((line) => <span key={line.id}>{line.name} <b>{line.values[active].count >= MIN_SAMPLE && line.values[active].average !== null ? line.values[active].average.toFixed(2) + "점" : "표본 부족"}</b></span>)}</div>}
          </div> : <p className={s.emptyChart}>일별 분석 리뷰 데이터가 없습니다.</p>}
          <p className={s.caption}>{missing ? "리뷰가 " + MIN_SAMPLE + "건 미만인 구간은 별점 선을 끊었습니다. " : ""}{eventInRange ? "연한 구간은 기본 갭 분석에서 제외한 이상 급증 기간입니다. " : ""}분석 리뷰 기준.</p>
        </section>
      </div>

      {eventInRange && <div className={s.note}><b>이상 급증 구간 포함</b> · {meta.eventWindow.from} – {eventEnd}. 해당 리뷰는 별점 추이에 포함되지만 기본 갭 판정에서는 제외됩니다.</div>}
      <header className={s.sectionHead}><div><h1>시장 현황</h1><p>시장마다 어떤 불만이 평소보다 쏠리는지, 누가 풀어야 할 문제인지</p></div><span className={s.scope}>전체 수집 기간 기준 · 위 달력과 무관</span></header>
      <section className={s.card + " " + s.verdictCard} aria-label="판정 요약">
        <div className={s.chartTop}><h2>판정 요약 <span className={s.sub}>{rows.length}개 시장</span></h2><span className={s.sub}>막대나 항목을 누르면 아래 표가 그 판정만 보여 줍니다</span></div>
        <div className={s.verdictBar} role="group" aria-label="판정별 시장 수">{verdicts.map((v) => {
          const count = counts.get(v) ?? 0;
          return count > 0 && <button key={v} type="button" className={[s.verdictSegment, verdictClass[v], filter && filter !== v ? s.dim : ""].join(" ")} style={{ flex: count }} aria-label={v + " " + count + "개 시장"} aria-pressed={filter === v} onClick={() => setFilter(filter === v ? null : v)}><span>{count >= 2 ? v : ""}</span><b>{count}</b></button>;
        })}</div>
        <div className={s.verdictKeys}>{verdicts.map((v) => {
          const count = counts.get(v) ?? 0;
          return count > 0 && <button key={v} type="button" className={s.verdictKey} aria-pressed={filter === v} onClick={() => setFilter(filter === v ? null : v)}><i className={verdictClass[v]} />{v} <b>{count}</b></button>;
        })}</div>
        <p className={s.verdictRead}>{filter ? <><b>{filter}</b> {counts.get(filter)}개 시장만 표시 중 · 같은 항목을 다시 누르면 전체 보기</> : <>판정이 난 {judged}개 시장 중 <b>{common}개</b>는 여러 시장에 공통으로 나타나는 불만이고, 현지화 갭으로 판정된 곳은 <b>{counts.get("현지화 갭") ?? 0}개</b>입니다.</>}</p>
      </section>
      <section className={s.card} aria-label="시장별 표">
        <div className={s.chartTop}><h2>시장별 최대 갭 토픽 <span className={s.sub}>lift 높은 순</span></h2><div className={s.tableTools}><span className={s.liftKey}><i />lift 1.0 = 전체 평균과 같은 비중</span><label><span className="sr-only">시장 검색</span><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="시장·토픽 검색" /></label><button type="button" className={s.csvButton} onClick={downloadCsv}>CSV</button></div></div>
        <div className={s.tableWrap}><table className={s.marketTable}>
          <thead><tr><th scope="col">#</th><th scope="col">시장</th><th scope="col" className={s.alignRight}>판정 표본</th><th scope="col">최대 갭 토픽</th><th scope="col">lift</th><th scope="col">판정</th><th scope="col" className={s.alignRight}>불만율(참고)</th></tr></thead>
          <tbody>{visibleRows.map((row) => <tr key={row.code} className={s.marketRow} onClick={(event) => {
            if (event.target instanceof Element && event.target.closest("a")) return;
            router.push("/market/" + row.code.toLowerCase());
          }}>
            <td className={s.rank}>{rows.indexOf(row) + 1}</td>
            <td><span className={s.marketName}><Link href={"/market/" + row.code.toLowerCase()} prefetch={false}>{row.name}</Link>{row.lowSample && <span className={s.smallBadge}>표본 적음</span>}</span></td>
            <td className={s.alignRight + " " + s.numeric}>{fmt.format(row.analyzedCount)}</td>
            <td className={s.topic}>{row.topicLabel ?? "—"}</td>
            <td>{row.lift === null ? <span className={s.dash}>—</span> : <span className={s.lift}><span className={s.liftTrack}><span className={s.liftFill} style={{ width: row.lift / maxLift * 100 + "%", opacity: row.lowSample ? .45 : 1 }} /><i style={{ left: 100 / maxLift + "%" }} /></span><b>{row.lift.toFixed(2)}</b></span>}</td>
            <td><span className={s.pill + " " + verdictClass[row.verdict ?? "판정 없음"]}><i />{row.verdict ?? "판정 없음"}</span></td>
            <td className={s.alignRight + " " + s.faint}>{row.complaintRate.toFixed(1)}%</td>
          </tr>)}{visibleRows.length === 0 && <tr><td colSpan={7} className={s.emptyRow}>조건에 맞는 시장이 없습니다.</td></tr>}</tbody>
        </table></div>
      </section>
      <footer className={s.footer}>
        <span>수집 기간 <b>{meta.periodFrom} – {meta.periodTo}</b></span><span>전체 수집 <b>{fmt.format(meta.collectedCount)}</b>건</span><span>판정 표본 <b>{fmt.format(meta.analyzedCount)}</b>건</span><span>토픽 <b>{meta.topicCount}</b>개</span><span>χ² <b>p&lt;0.001</b></span><span>Google Play <b>com.lgeha.nuts</b></span>
        <span className={s.footerNote}>불만율과 별점은 시장별 평점 문화가 섞여 있어 시장 간 심각도 비교에 쓰지 않습니다. 같은 시장 안의 변화와 lift를 보세요.</span>
      </footer>
    </main>
  </>;
}
