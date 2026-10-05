import Link from "next/link";

export default function AppNav({
  latestDate,
  active = "overview",
  detailHref,
}: {
  latestDate: string;
  active?: "overview" | "detail";
  detailHref: string;
}) {
  return (
    <nav className="top-nav" aria-label="주요 탐색">
      <div className="nav-inner">
        <Link className="brand" href="/">
          <span className="brand-dot" aria-hidden="true" />
          ThinQ VOC 터미널
        </Link>
        <div className="nav-tabs" aria-label="분석 화면">
          <Link className={`nav-tab${active === "overview" ? " active" : ""}`} href="/" aria-current={active === "overview" ? "page" : undefined}>개요</Link>
          <Link className={`nav-tab${active === "detail" ? " active" : ""}`} href={detailHref} aria-current={active === "detail" ? "page" : undefined}>시장 상세</Link>
          <span className="nav-tab disabled" aria-disabled="true">토픽 분석</span>
          <span className="nav-tab disabled" aria-disabled="true">리포트</span>
        </div>
        <span className="latest">최종 수집 <span className="num">{latestDate.replaceAll("-", ".")}</span></span>
      </div>
    </nav>
  );
}
