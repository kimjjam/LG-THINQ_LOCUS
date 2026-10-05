create or replace function public.match_reviews(
  query_embedding extensions.vector(384),
  filter_market_code text,
  filter_topic_id smallint default null,
  match_count integer default 8
)
returns table (
  id bigint,
  market_code text,
  topic_id smallint,
  lang text,
  score smallint,
  at timestamptz,
  content text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    reviews.id,
    reviews.market_code,
    reviews.topic_id,
    reviews.lang,
    reviews.score,
    reviews.at,
    reviews.content,
    1 - (reviews.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.reviews
  where query_embedding is not null
    and reviews.market_code = filter_market_code
    and (filter_topic_id is null or reviews.topic_id = filter_topic_id)
    and reviews.score <= 2
    and not reviews.is_event
  order by reviews.embedding operator(extensions.<=>) query_embedding
  limit least(greatest(coalesce(match_count, 8), 1), 20);
$$;

revoke execute on function public.match_reviews(
  extensions.vector,
  text,
  smallint,
  integer
) from public;

grant execute on function public.match_reviews(
  extensions.vector,
  text,
  smallint,
  integer
) to anon, authenticated, service_role;
