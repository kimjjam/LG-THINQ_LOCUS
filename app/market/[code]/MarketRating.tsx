"use client";

import { useState } from "react";
import type { DailyReviewCount } from "@/lib/data.server";
import styles from "./detail.module.css";

const periods = [
  { label: "1일", days: 1 },
  { label: "1주", days: 7 },
  { label: "1달", days: 30 },
] as const;

function shift(date: string, days: number) {
  const day = new Date(date + "T00:00:00Z");
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

function summarize(rows: DailyReviewCount[], from: string, to: string) {
  let count = 0;
  let score = 0;
  for (const row of rows) {
    if (row.date < from || row.date > to) continue;
    row.stars.forEach((total, index) => {
      count += total;
      score += total * (index + 1);
    });
  }
  return { count, average: count > 0 ? score / count : null };
}

export default function MarketRating({ rows, endDate }: { rows: DailyReviewCount[]; endDate: string }) {
  const [days, setDays] = useState<1 | 7 | 30>(7);
  const currentStart = shift(endDate, 1 - days);
  const previousEnd = shift(currentStart, -1);
  const current = summarize(rows, currentStart, endDate);
  const previous = summarize(rows, shift(previousEnd, 1 - days), previousEnd);
  const periodName = periods.find((period) => period.days === days)?.label ?? "1주";
  const change = current.average !== null && previous.average !== null
    ? current.average - previous.average
    : null;

  return (
    <div className={styles.ratingPanel}>
      <div className={styles.periods} role="group" aria-label="별점 집계 기간">
        {periods.map((period) => (
          <button
            aria-pressed={days === period.days}
            key={period.days}
            onClick={() => setDays(period.days)}
            type="button"
          >{period.label}</button>
        ))}
      </div>
      <span>평균 별점</span>
      <strong aria-live="polite">{current.average === null ? "—" : current.average.toFixed(2)}<small> / 5</small></strong>
      <div className={styles.change} data-negative={change !== null && change < 0 || undefined}>
        {current.average === null
          ? "표본 부족"
          : change === null
            ? "직전 기간 표본 부족"
            : "직전 " + periodName + " 대비 " + (change > 0 ? "+" : "") + change.toFixed(2)}
      </div>
      <p>분석 리뷰 {current.count.toLocaleString("ko-KR")}건 · UTC 기준</p>
    </div>
  );
}
