-- Spusť jednou v Supabase SQL Editoru.
-- Rozšiřuje existující tabulku hockey_matches pro rozpis a simulaci zápasů.

alter table public.hockey_matches
  add column if not exists round_number int4,
  add column if not exists age_category text,
  add column if not exists home_attack numeric,
  add column if not exists home_defense numeric,
  add column if not exists away_attack numeric,
  add column if not exists away_defense numeric,
  add column if not exists home_result text,
  add column if not exists away_result text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hockey_matches_age_category_check'
      and conrelid = 'public.hockey_matches'::regclass
  ) then
    alter table public.hockey_matches
      add constraint hockey_matches_age_category_check
      check (age_category is null or age_category in ('senior', 'u21', 'u18'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'hockey_matches_home_result_check'
      and conrelid = 'public.hockey_matches'::regclass
  ) then
    alter table public.hockey_matches
      add constraint hockey_matches_home_result_check
      check (home_result is null or home_result in ('V', 'VP', 'PP', 'P'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'hockey_matches_away_result_check'
      and conrelid = 'public.hockey_matches'::regclass
  ) then
    alter table public.hockey_matches
      add constraint hockey_matches_away_result_check
      check (away_result is null or away_result in ('V', 'VP', 'PP', 'P'));
  end if;
end
$$;

create index if not exists hockey_matches_schedule_idx
  on public.hockey_matches (season, competition_type, age_category, round_number);
