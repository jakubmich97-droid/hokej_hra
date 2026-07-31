-- Spusť jednou v Supabase SQL Editoru.
-- Přidává hráčům a brankářům aktuální klub.

alter table public.hockey_players
  add column if not exists team_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hockey_players_team_id_fkey'
      and conrelid = 'public.hockey_players'::regclass
  ) then
    alter table public.hockey_players
      add constraint hockey_players_team_id_fkey
      foreign key (team_id)
      references public.hockey_teams(id)
      on delete set null;
  end if;
end
$$;

create index if not exists hockey_players_team_position_idx
  on public.hockey_players (team_id, position)
  where active = true;
