create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table public.market_groups (
  id smallint generated always as identity primary key,
  name text not null unique,
  description text
);

create table public.markets (
  code text primary key,
  name text not null unique,
  group_id smallint not null references public.market_groups (id),
  analyzed_count integer not null check (analyzed_count >= 0),
  collected_count integer not null check (collected_count >= 0),
  complaint_rate double precision not null check (complaint_rate between 0 and 100),
  low_sample boolean not null default false,
  is_active boolean not null default true
);

comment on column public.markets.code is
  '언어권 기반 시장 코드이며 국가 코드가 아니다(예: EN=영어권, ES=스페인어권, AR=중동 아랍어권). 향후 국가 축은 별도 컬럼/테이블로 추가한다.';

create table public.topics (
  id smallint primary key check (id between 0 and 9),
  label text not null unique,
  overall_share double precision not null check (overall_share between 0 and 1),
  is_positive boolean not null default false,
  is_noise boolean not null default false,
  check (not (is_positive and is_noise))
);

create table public.topic_centroids (
  topic_id smallint primary key references public.topics (id) on delete cascade,
  vector extensions.vector(384) not null
);

create table public.reviews (
  id bigint generated always as identity primary key,
  market_code text not null references public.markets (code),
  lang text not null,
  unit text not null,
  score smallint not null check (score between 1 and 5),
  at timestamptz not null,
  app_version text,
  content text not null,
  clean text not null,
  topic_id smallint not null references public.topics (id),
  is_event boolean not null default false,
  embedding extensions.vector(384) not null,
  constraint reviews_event_window_matches_at check (
    is_event = (
      at >= timestamptz '2026-07-01 00:00:00+00'
      and at < timestamptz '2026-08-01 00:00:00+00'
    )
  )
);

comment on column public.reviews.at is
  'google-play-scraper의 tz 없는 원본 시각을 UTC로 간주해 저장한다.';
comment on column public.reviews.is_event is
  '2026-07-01 00:00 UTC 이상, 2026-08-01 00:00 UTC 미만의 서비스 장애 구간.';

create table public.market_stats (
  market_code text not null references public.markets (code),
  topic_id smallint not null references public.topics (id),
  count integer not null check (count >= 0),
  share double precision not null check (share between 0 and 1),
  lift double precision not null check (lift >= 0),
  residual double precision not null,
  primary key (market_code, topic_id)
);

comment on table public.market_stats is
  'is_event=false인 리뷰를 기준으로 계산한 시장별 토픽 통계.';

create table public.gaps (
  id bigint generated always as identity primary key,
  market_code text not null references public.markets (code),
  topic_id smallint not null references public.topics (id),
  lift double precision not null check (lift >= 0),
  residual double precision not null,
  verdict text not null check (
    verdict in ('광역 공통', '그룹 공통', '부분 공통', '현지화 갭', '단독 시장', '범위 밖')
  ),
  rule_basis text not null,
  llm_reasoning text,
  counter_evidence text,
  confidence text,
  reviewed boolean not null default false,
  unique (market_code, topic_id)
);

create table public.actions (
  gap_id bigint primary key references public.gaps (id) on delete cascade,
  owner text,
  status text,
  note text,
  updated_at timestamptz not null default now()
);

create index markets_group_id_idx on public.markets (group_id);
create index reviews_filter_idx
  on public.reviews (market_code, topic_id, is_event, score);
create index reviews_topic_id_idx on public.reviews (topic_id);
create index reviews_embedding_hnsw_idx
  on public.reviews using hnsw (embedding extensions.vector_cosine_ops);
create index market_stats_topic_id_idx on public.market_stats (topic_id);
create index gaps_topic_id_idx on public.gaps (topic_id);

alter table public.market_groups enable row level security;
alter table public.markets enable row level security;
alter table public.topics enable row level security;
alter table public.topic_centroids enable row level security;
alter table public.reviews enable row level security;
alter table public.market_stats enable row level security;
alter table public.gaps enable row level security;
alter table public.actions enable row level security;

revoke all on table
  public.market_groups,
  public.markets,
  public.topics,
  public.topic_centroids,
  public.reviews,
  public.market_stats,
  public.gaps,
  public.actions
from anon, authenticated;

grant select on table
  public.market_groups,
  public.markets,
  public.topics,
  public.topic_centroids,
  public.reviews,
  public.market_stats,
  public.gaps,
  public.actions
to anon, authenticated;

grant all on table
  public.market_groups,
  public.markets,
  public.topics,
  public.topic_centroids,
  public.reviews,
  public.market_stats,
  public.gaps,
  public.actions
to service_role;

grant usage, select on sequence
  public.market_groups_id_seq,
  public.reviews_id_seq,
  public.gaps_id_seq
to service_role;

create policy "read market groups"
  on public.market_groups for select to anon, authenticated using (true);
create policy "read markets"
  on public.markets for select to anon, authenticated using (true);
create policy "read topics"
  on public.topics for select to anon, authenticated using (true);
create policy "read topic centroids"
  on public.topic_centroids for select to anon, authenticated using (true);
create policy "read reviews"
  on public.reviews for select to anon, authenticated using (true);
create policy "read market stats"
  on public.market_stats for select to anon, authenticated using (true);
create policy "read gaps"
  on public.gaps for select to anon, authenticated using (true);
create policy "read actions"
  on public.actions for select to anon, authenticated using (true);
