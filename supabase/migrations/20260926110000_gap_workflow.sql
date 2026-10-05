alter table public.gaps
  add column reviewed_by text,
  add column reviewed_at timestamptz,
  add constraint gaps_reviewed_by_length_check check (
    reviewed_by is null or char_length(btrim(reviewed_by)) between 1 and 60
  ),
  add constraint gaps_review_state_check check (
    (reviewed and reviewed_by is not null and reviewed_at is not null)
    or (not reviewed and reviewed_by is null and reviewed_at is null)
  );

alter table public.actions
  add constraint actions_owner_length_check check (
    owner is null or char_length(btrim(owner)) between 1 and 60
  ),
  add constraint actions_status_check check (
    status is null or status in ('대기', '진행 중', '완료', '보류')
  ),
  add constraint actions_note_length_check check (
    note is null or char_length(note) <= 1000
  );

drop policy if exists "read gaps" on public.gaps;
drop policy if exists "read actions" on public.actions;
revoke select on table public.gaps, public.actions from anon, authenticated;

comment on column public.gaps.reviewed_by is
  '검토 완료를 기록한 담당자 표시명. 인증 사용자 식별자가 아니다.';
comment on table public.actions is
  '갭별 최신 대응 1건을 저장한다. 이력이 필요하면 별도 이력 테이블로 확장한다.';
