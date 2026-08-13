# Onlineklas.nl — Woordenkampioen

Retro typspel (Windows 95-stijl): typ een reeks woorden zo snel mogelijk
(aantal instelbaar via `AANTAL_WOORDEN` in `main.js`, nu 30 — het aantal
wordt nergens in het spel getoond).
Vijf niveaus: groep 4, 5, 6, 7 en 8 — elk met een eigen top 100 highscorelijst.

## Starten (live meekijken)

Open een terminal (cmd of PowerShell) in deze map en typ:

```
npm install
npm run dev
```

Chrome opent vanzelf op `http://localhost:5173`. Elke wijziging aan de
bestanden wordt direct live herladen (hot reload).

## Bestanden

- `index.html` — alle schermen (home, groepsmenu, spel, highscores)
- `style.css`  — Windows 95 retro-opmaak
- `main.js`    — spellogica, stopwatch, highscores
- `words.js`   — woordenlijsten per groep (100+ woorden per niveau)

## Spelregels

- Kies je groep, klik op **Spelen**, vul je **naam** in en klik op **START!**
- Typ het woord dat groot in beeld staat — bij het laatste goede lettertje
  ga je vanzelf door naar het volgende woord (geen Enter nodig).
- Verkeerde letter getypt? Korte rode flits en de letters kleuren rood —
  verbeter het zelf met backspace tot het woord klopt.
- De stopwatch telt in seconden en milliseconden.
- Na het laatste woord wordt je tijd automatisch opgeslagen als je in de
  top 100 van jouw groep staat.

## Highscores: lokaal of gedeeld online

Standaard worden highscores bewaard in de browser (localStorage) op de
eigen computer. Wil je één gedeelde top 100 voor alle bezoekers, vul dan
in `config.js` de Supabase-gegevens in (Project Settings -> API).

Eenmalige inrichting in Supabase (SQL Editor -> nieuwe query -> Run):

```sql
create table public.highscores (
  id uuid primary key default gen_random_uuid(),
  groep int not null check (groep between 4 and 8),
  naam text not null check (char_length(naam) between 1 and 20),
  tijd_ms int not null check (tijd_ms between 3000 and 3600000),
  datum timestamptz not null default now()
);

alter table public.highscores enable row level security;

create policy "iedereen mag lezen" on public.highscores
  for select using (true);

create policy "iedereen mag toevoegen" on public.highscores
  for insert with check (true);

create index highscores_groep_tijd on public.highscores (groep, tijd_ms);
```

Bezoekers kunnen alleen scores lezen en toevoegen — nooit aanpassen of
verwijderen. Is de database even niet bereikbaar, dan valt het spel
automatisch terug op de lokale lijst.
