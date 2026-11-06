-- OnlyFaune : tables des mini-jeux (à exécuter une fois dans Supabase > SQL Editor)
-- Lecture publique (la page OBS n'a pas besoin de se connecter), écriture réservée aux comptes admin.

create table if not exists public.game_state (
  id          int primary key default 1 check (id = 1),   -- une seule ligne : l'état du jeu en cours
  game        text not null default 'idle',               -- idle | devinette | photo | duel | leaderboard
  status      text not null default 'idle',               -- idle | playing | revealed
  round       int  not null default 0,
  payload     jsonb not null default '{}'::jsonb,         -- uniquement ce qui est déjà visible à l'écran
  updated_at  timestamptz not null default now()
);
insert into public.game_state (id) values (1) on conflict (id) do nothing;

create table if not exists public.game_scores (
  login         text primary key,                         -- pseudo Twitch en minuscules
  display_name  text not null,
  points        int  not null default 0,
  updated_at    timestamptz not null default now()
);

alter table public.game_state  enable row level security;
alter table public.game_scores enable row level security;

drop policy if exists "game_state lecture publique"  on public.game_state;
drop policy if exists "game_state ecriture admin"    on public.game_state;
drop policy if exists "game_scores lecture publique" on public.game_scores;
drop policy if exists "game_scores ecriture admin"   on public.game_scores;

create policy "game_state lecture publique"  on public.game_state  for select using (true);
create policy "game_scores lecture publique" on public.game_scores for select using (true);

create policy "game_state ecriture admin" on public.game_state for all to authenticated
  using      ((auth.jwt() ->> 'email') in ('reno.baikal@gmail.com', 'clement.explore.tv@gmail.com'))
  with check ((auth.jwt() ->> 'email') in ('reno.baikal@gmail.com', 'clement.explore.tv@gmail.com'));

create policy "game_scores ecriture admin" on public.game_scores for all to authenticated
  using      ((auth.jwt() ->> 'email') in ('reno.baikal@gmail.com', 'clement.explore.tv@gmail.com'))
  with check ((auth.jwt() ->> 'email') in ('reno.baikal@gmail.com', 'clement.explore.tv@gmail.com'));
