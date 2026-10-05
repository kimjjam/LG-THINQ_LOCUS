"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export default function DetailControls({
  code,
  compare,
  canCompareGroup,
}: {
  code: string;
  compare: "group" | "all";
  canCompareGroup: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [exporting, setExporting] = useState<"md" | "csv" | null>(null);
  const [exportError, setExportError] = useState("");

  async function download(format: "md" | "csv") {
    setExporting(format);
    setExportError("");
    try {
      const response = await fetch(`/api/export?market=${encodeURIComponent(code)}&format=${format}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "내보내기에 실패했습니다.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `thinq-${code.toLocaleLowerCase("en-US")}-${format === "md" ? "brief.md" : "evidence.csv"}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "내보내기에 실패했습니다.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="detail-controls">
      <button type="button" disabled={exporting !== null} onClick={() => download("md")}>{exporting === "md" ? "MD…" : "MD"}</button>
      <button type="button" disabled={exporting !== null} onClick={() => download("csv")}>{exporting === "csv" ? "CSV…" : "CSV"}</button>
      {exportError && <small role="alert">{exportError}</small>}
      <label>
        <span>비교 대상</span>
        <select
          value={compare}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.value;
            startTransition(() => router.replace(`${pathname}?compare=${next}`, { scroll: false }));
          }}
        >
          <option value="group" disabled={!canCompareGroup}>같은 그룹</option>
          <option value="all">전체 시장</option>
        </select>
      </label>
    </div>
  );
}
