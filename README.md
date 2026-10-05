# ThinQ Locus

LG ThinQ 해외 리뷰의 시장별 쏠림과 판단 근거를 분석하는 내부 도구입니다.

## 로컬 준비

```bash
npm install
Copy-Item .env.example .env.local
npm run verify:reference
```

전체 리뷰 CSV와 임베딩 NPY는 저장소에 두지 않습니다. 외부 경로의 원본은 빈 `reviews` 테이블에 한 번만 적재할 수 있습니다.

```bash
python scripts/load-reviews.py --csv <thinq_wide_clustered.csv> --embeddings <wide_emb.npy> --apply
npm run verify:data
```

로더는 연결된 Supabase 프로젝트만 허용하고 `market_stats`를 `lift_no_event.csv`·`resid_no_event.csv`로 채웁니다. `verify:data`는 이어서 `expected_gaps.csv`까지 행 단위로 검증합니다.

## 변경 이력

- 2026-09-28: HTML 시안의 개요·시장 상세 UI를 적용하고 리뷰 별점 추이를 DB 분석 표본으로 연결했습니다.
- 2026-09-28: 공개 주소의 보호된 배포 주소 리다이렉트를 제거하고, 로컬 연결 파일을 배포에서 제외했습니다.
