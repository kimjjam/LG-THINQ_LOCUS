# 에이전트 행동 지침 (전역 기본값)

> 프로젝트별 상세 정보(구조, DB, 환경변수 등)를 정리한 요약 문서가 있다면
> 세션 시작 시 가장 먼저 읽어 컨텍스트를 파악하라.

## 1. 작업 시작 전 필수 절차 (코드보다 계획 먼저)
코드 수정 전 반드시 작업 계획서([설계 제안]/[전문가 추천]/[영향도 분석])를 제출하고 승인을 받는다.
영향도가 불확실하면 무리하게 추론하지 말고 전체 스캔 허락을 먼저 구한다.

## 2. 코딩 스타일
기존 네이밍 컨벤션·아키텍처 최우선 준수, 불필요한 리팩토링 지양, 타입 안전성 준수, 복잡한 로직에만 주석.
[Simplicity First] 문제 해결에 필요한 최소한의 코드만 작성. 요청 안 한 기능/추상화/유연성 임의 추가 금지,
발생 가능성 없는 예외를 위한 방어 코드 남발 금지. 200줄로 짤 걸 50줄로 되면 50줄로.
판단 기준: "시니어 엔지니어가 과설계라고 할까?" — 그렇다면 단순화.

## 3. 작업 수행 및 사후 관리
파일 변경 시 영향도 스스로 파악, 모듈화, 완료 후 즉시 푸시 금지(검증 후 푸시), 변경 이력 3줄 이내 업데이트.

## 4. 금지 사항
확인 없는 5개 이상 파일 동시 수정 금지, 미설치 라이브러리 임의 도입 금지, 사이드이펙트 우려 시 반드시 경고.
[Surgical Changes] 요청과 무관한 코드·주석·포매팅은 "개선" 명목으로도 손대지 않기. 안 깨진 코드 임의 리팩토링 금지.
본인 변경으로 생긴 미사용 import/변수/함수만 정리, 원래 있던 죽은 코드는 임의 삭제 대신 언급만.
원칙: 변경된 모든 줄은 요청과 직접 연결되어야 한다.

## 5. 상호작용 바이브
시니어 페어 프로그래머 역할, 비효율적 제안엔 정중히 더 나은 방향 제시, 답변은 간결하고 scannable하게.

## 6. 완료 기준 (Definition of Done)
실행/테스트로 동작 확인 후 완료 보고, 테스트 있으면 실행 결과 보고.

## 7. 보안 기본 수칙
API 키/비번/DB 접속정보 하드코딩 금지(환경변수 분리), 사용자 입력 검증/이스케이프 가정, 인증/권한 체크 누락 스스로 점검.

## 8. 모호할 때 대응
임의 해석 대신 무엇이 애매한지 질문, 여러 구현 방식 가능하면 선택지 제시.

## 9. 커밋 메시지
왜 바꿨는지 담기, 한 커밋에 여러 관심사 섞지 않기.

## 10. 설명 요청 시
원리 중심으로 답하기, 새 개념/라이브러리 사용 이유 남기기.

## 11. 에러 발생 시 대응
근본 원인 먼저 설명, 반복 에러는 다른 접근 시도, 추측성 수정 연달아 금지.

## 12. 프로덕션 영향 고려
실사용자 있는 서비스는 로컬/테스트 먼저 검증, 삭제/마이그레이션은 롤백 방법 먼저 확인.

## 13. 성능 최적화 원칙
요청 없는 최적화 임의 추가 금지, 근거 먼저 제시, 미확인 성능 문제로 미리 복잡하게 만들지 않기.

## 14. 목표 중심 실행 (Goal-Driven Execution)
명령형 지시를 받으면 실행 전에 검증 가능한 성공 기준으로 스스로 변환한다.
("검증 로직 추가해줘" → "잘못된 입력 테스트 작성 후 통과시키기" / "버그 고쳐줘" → "재현 테스트 작성 후 통과시키기")
여러 단계 작업은 착수 전 "[단계] → 검증: [확인 방법]" 형식으로 짧게 계획 제시.
6번(완료 기준)과 쌍을 이룸: 6번이 사후 검증이라면 14번은 착수 전 검증 기준 정의.

---

# 프로젝트: ThinQ Locus

> **Locus** — 라틴어로 "자리". 수학에서는 조건을 만족하는 점들의 자취를 뜻하고,
> `local` / `localization` 과 어원이 같다. 각 불만이 **어느 시장, 어느 그룹에 속하는지**
> 그 자리를 찾는 도구라는 뜻이다.
>
> 패키지명 · 레포 · Vercel 프로젝트: `thinq-locus`
> 화면 상단 타이틀: `ThinQ VOC 터미널`

## 소개

LG ThinQ 앱의 Google Play 해외 리뷰 36,027건(17개 시장, 2023-09-24 ~ 2026-09-22)을 분석해,
**어떤 불만이 특정 시장에만 쏠려 있는지**를 찾아내는 사내 분석 도구다.
사용자는 LG 해외 서비스 기획팀 담당자로, 여러 시장을 동시에 담당하고 현지 언어를 못 읽으며
주기적으로 보고서를 쓴다.

핵심은 "리뷰 요약"이 아니라 **판단 로직**이다. 수치 규칙이 갭 후보를 거르고, LLM이 대표 리뷰를 읽어
확정하거나 뒤집되 뒤집을 때는 반증 근거를 함께 낸다.

## 폴더 구조

```
app/
  page.tsx                    랜딩 — 시장 목록
  market/[code]/page.tsx      상세 — 시장별 분석
  api/ask/route.ts            RAG 질의 (벡터 검색 + LLM)
  api/classify/route.ts       갭 재판정 (LLM)
  api/export/route.ts         MD / CSV 내보내기
components/
  MarketTable.tsx             랜딩 테이블
  LiftChart.tsx               발산 막대 차트 (SVG, 라이브러리 없이)
  GapCard.tsx                 갭 아코디언 카드
  BriefPanel.tsx              우측 리포트 초안 패널
lib/
  supabase.ts                 클라이언트 / 서버 인스턴스
  embed.ts                    transformers.js 질의 임베딩 (브라우저 전용)
  classify.ts                 4분류 수치 게이트 (순수 함수, 테스트 대상)
  llm.ts                      LLM 호출 + 파일 캐시
data/                         분석 산출물 (git 추적, LFS 불필요)
  thinq_wide_clustered.csv    36,027행 · topic 배정 포함
  wide_lift_matrix.csv        17 x 10 lift
  wide_resid_matrix.csv       17 x 10 표준화 잔차
  wide_emb.npy                (36027, 384) float32 임베딩
scripts/
  seed.ts                     data/ → Supabase 적재
supabase/
  migrations/
```

## DB 스키마 (Supabase Postgres + pgvector)

```sql
-- 시장 목록은 코드에 하드코딩하지 말고 반드시 이 테이블에서 읽는다.
-- 나중에 시장을 추가할 때 행 추가만으로 끝나야 한다.
market_groups (id, name, description)
markets       (code PK, name, group_id FK, analyzed_count, collected_count,
               complaint_rate, low_sample bool, is_active bool)
topics        (id PK, label, overall_share, is_positive bool, is_noise bool)
topic_centroids (topic_id PK, vector vector(384))
reviews       (id PK, market_code FK, lang, unit, score, at timestamptz,
               app_version, content, clean, topic_id FK, is_event bool,
               embedding vector(384))
market_stats  (market_code FK, topic_id FK, count, share, lift, residual,
               PRIMARY KEY (market_code, topic_id))
gaps          (id PK, market_code FK, topic_id FK, lift, residual,
               verdict text,        -- 광역공통 | 그룹공통 | 부분공통 | 현지화갭 | 단독시장 | 범위밖
               rule_basis text,     -- 예: "대형가전형 이웃 3/8"
               llm_reasoning text, counter_evidence text,
               confidence text, reviewed bool default false)
actions       (gap_id FK, owner text, status text, note text, updated_at)
```

- `reviews.embedding` 에 ivfflat 또는 hnsw 인덱스. 질의는 항상
  `market_code` / `topic_id` / `score` 필터를 먼저 건 뒤 벡터 검색한다.
- `is_event`: 2026-07-01 ~ 2026-07-31 리뷰. **기본 분석에서 제외**한다
  (해당 기간 한국 리뷰가 17배 폭증한 서비스 장애 구간이라 시장 구성을 왜곡).
  화면에는 "이상 급증 구간"으로 따로 다룰 수 있게 플래그만 유지.

## 환경변수 (.env.local, 절대 커밋 금지)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # scripts/seed.ts 에서만 사용
GOOGLE_API_KEY=                 # 없으면 ANTHROPIC_API_KEY 또는 OPENAI_API_KEY
```

LLM 프로바이더는 환경변수 존재 여부로 자동 선택한다. 특정 프로바이더에 코드를 묶지 마라.

## 핵심 기능

1. **랜딩** — 17개 시장을 밀도 높은 테이블로. 스크롤 없이 한 화면.
2. **상세** — 시장별 토픽 쏠림 발산 차트 + 갭 후보 카드 + 우측 리포트 초안 패널.
3. **4분류 판정** — 수치 게이트가 후보를 거르고 LLM이 확정. 아래 "판정 규칙" 참조.
4. **RAG 질의** — 브리프 패널 하단 커맨드바. 질의 임베딩은 브라우저에서.
5. **내보내기** — MD 초안 / CSV.

## 이 프로젝트 고유 규칙

1. **재클러스터링 금지.** 토픽은 `topic_centroids` 10개로 고정이다. 새 리뷰가 들어와도
   KMeans를 다시 돌리지 말고 최근접 centroid에 배정만 한다. 같은 데이터·같은 k라도 seed가
   다르면 토픽 정체성이 통째로 바뀌어 시계열 비교가 깨진다 (실제로 겪은 문제다).
2. **숫자를 코드에 박지 마라.** lift, 잔차, 건수, 그룹 구성은 전부 DB에서 읽는다.
   화면 테스트용 목 데이터가 필요하면 `data/` CSV를 읽어 쓰고, 컴포넌트에 상수로 넣지 않는다.
3. **없는 데이터를 그리지 마라.** 전주 대비 증감, 추이 스파크라인, 월별 그래프는 **만들지 않는다.**
   주당 신규 리뷰가 시장별 1.5~84건이라 주 단위 비교는 통계적으로 무의미하다.
   비어 있는 열을 자리만 잡아두는 것도 금지.
4. **차트 라이브러리 금지.** 발산 막대는 div/SVG로 직접 그린다. Recharts, Chart.js 등 도입 금지.
5. **긍정 토픽(id=4)과 기타요청 토픽(id=8)은 갭 분석에서 제외**한다. 4는 칭찬 리뷰 클러스터,
   8은 잡음이 섞인 토픽이다. 단 긍정 토픽 lift는 "리뷰 성향" 지표로 상세 화면에 노출한다.
6. **LLM 응답은 항상 파일 캐시**를 거친다. 키는 sha256(provider + prompt).
   개발 중 같은 질의를 반복해도 토큰이 새지 않게.
7. **불만율(1~2점 비중)로 시장 간 심각도를 비교하지 마라.** 시장별 평점 관대함이 섞여 있다.
   화면에서도 이 경고를 각주로 유지한다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
