-- ============================================================================
-- BALKAN CAR WASH — Supabase šema (PostgreSQL)
-- Verzija: 3.0 · Produkcija
-- Pokreće se JEDNOM, u Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================================
-- Sadržaj:
--   1. Tabele
--   2. Pomoćne funkcije za uloge (SECURITY DEFINER — sprečava rekurziju RLS-a)
--   3. RLS politike
--   4. Realtime
--   5. Seed (produkcioni podaci — BEZ testnih naloga)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. ČIŠĆENJE (bezbedno ponovno pokretanje)
-- ---------------------------------------------------------------------------
drop table if exists potrosnja   cascade;
drop table if exists nabavke     cascade;
drop table if exists reklamacije cascade;
drop table if exists nalozi      cascade;
drop table if exists troskovi    cascade;
drop table if exists klijenti    cascade;
drop table if exists usluge      cascade;
drop table if exists magacin     cascade;
drop table if exists praznici    cascade;
drop table if exists zaposleni   cascade;
drop table if exists podesavanja cascade;
drop function if exists public.moja_uloga() cascade;
drop function if exists public.je_admin() cascade;
drop function if exists public.moj_zaposleni_id() cascade;

-- ---------------------------------------------------------------------------
-- 1. TABELE
-- ---------------------------------------------------------------------------

-- 1.1 Podešavanja — jedan jedini red (id = 1)
create table podesavanja (
  id                 int primary key default 1 check (id = 1),
  naziv_perionice    text    not null default 'Balkan Car Wash',
  adresa             text             default '',
  pib                text             default '',
  mb                 text             default '',
  tekuci_racun       text             default '',
  telefon            text             default '',
  email              text             default '',
  radno_vreme_start  text             default '08:00',
  radno_vreme_end    text             default '17:00',
  fiksni_trosak      numeric(14,2)    default 0,
  zeljeni_profit     numeric(14,2)    default 0,
  bonus_prag         numeric(14,2)    default 0,
  bonus_procenat     numeric(6,2)     default 0,
  eur_kurs           numeric(10,4)    default 117.0,
  u_sistemu_pdv      boolean          default true,
  pdv_stopa          numeric(5,2)     default 20,
  updated_at         timestamptz      default now()
);

-- 1.2 Zaposleni — vezani na auth.users preko auth_id
create table zaposleni (
  id           bigint generated always as identity primary key,
  auth_id      uuid unique references auth.users(id) on delete set null,
  ime          text not null,
  prezime      text not null default '',
  email        text,
  uloga        text not null default 'korisnik' check (uloga in ('admin','korisnik','viewer')),
  pin          text             default '',          -- samo za brzo otključavanje ekrana
  tel          text             default '',
  avatar       text             default '',
  color        text             default '#5a5cf0',
  aktivan      boolean          default true,
  bonus        numeric(6,2)     default 0,
  -- radno_vreme: { "1":{"radi":true,"od":"08:00","do":"17:00","pauza":30}, ... "7":{...} }
  -- ključ 1 = ponedeljak ... 7 = nedelja
  radno_vreme  jsonb            default '{}'::jsonb,
  -- izuzeci: [{"datum":"2026-10-05","tip":"godisnji|bolovanje|slobodan|radi","od":"08:00","do":"14:00","napomena":""}]
  izuzeci      jsonb            default '[]'::jsonb,
  napomena     text             default '',
  created_at   timestamptz      default now()
);
create index on zaposleni (auth_id);

-- 1.3 Praznici / neradni dani
create table praznici (
  id       bigint generated always as identity primary key,
  datum    date not null,
  naziv    text not null,
  neradni  boolean default true,
  unique (datum, naziv)
);
create index on praznici (datum);

-- 1.4 Magacin
create table magacin (
  id          bigint generated always as identity primary key,
  naziv       text not null,
  kategorija  text          default 'Hemija',
  jedinica    text          default 'L',
  cena        numeric(12,4) default 0,      -- nabavna cena po jedinici mere
  stanje      numeric(14,3) default 0,
  min_stanje  numeric(14,3) default 0,
  dobavljac   text          default '',
  napomena    text          default ''
);

-- 1.5 Usluge (normativi su ugrađeni kao jsonb: [{"magId":1,"kol":50}])
create table usluge (
  id          bigint generated always as identity primary key,
  naziv       text not null,
  tip_vozila  text          default 'Svi tipovi',
  kategorija  text          default 'Pranje',
  cena        numeric(12,2) default 0,      -- cena u valuti `valuta`
  valuta      text          default 'RSD' check (valuta in ('RSD','EUR')),
  interna     numeric(12,2) default 0,      -- interna vrednost (osnovica za bonus), uvek RSD
  trajanje    int           default 30,     -- minuti
  boja        text          default '#1f2937',
  opis        text          default '',
  aktivna     boolean       default true,
  normativi   jsonb         default '[]'::jsonb
);

-- 1.6 Klijenti (vozila ugrađena kao jsonb)
create table klijenti (
  id            bigint generated always as identity primary key,
  tip           text not null default 'fizicko' check (tip in ('fizicko','pravno','interni')),
  ime           text not null,
  tel           text default '',
  email         text default '',
  adresa        text default '',
  mesto         text default '',
  pib           text default '',
  mb            text default '',
  tekuci_racun  text default '',
  rok_placanja  int  default 15,            -- dani, za pravna lica
  napomena      text default '',
  -- vozila: [{"regTab":"LJ60ZDN","marka":"MERCEDES","model":"CLA","tip":"Putničko - srednje"}]
  vozila        jsonb default '[]'::jsonb,
  created_at    timestamptz default now()
);
create index on klijenti (tip);

-- 1.7 Radni nalozi
create table nalozi (
  id              bigint generated always as identity primary key,
  klijent_id      bigint references klijenti(id)  on delete set null,
  klijent         text not null,
  tel             text default '',
  reg_tab         text not null,
  marka           text default '',
  model           text default '',
  tip             text default '',
  uslu_id         bigint references usluge(id)    on delete set null,
  usluga_naziv    text default '',                -- snimljen naziv (istorijska tačnost)
  datum           date not null,
  vreme           text not null,
  zap_id          bigint references zaposleni(id) on delete set null,
  status          text default 'zakazano'
                  check (status in ('zakazano','stiglo','urad','zavrseno','reklamacija','otkazano')),
  nacin_placanja  text default 'gotovina'
                  check (nacin_placanja in ('gotovina','kartica','faktura','interno','gratis')),
  pravno_lice_id  bigint references klijenti(id)  on delete set null,
  cena            numeric(12,2) default 0,        -- UVEK u RSD (obračunato po kursu na dan naloga)
  interna         numeric(12,2) default 0,
  trajanje        int default 30,
  valuta_orig     text default 'RSD',             -- originalna valuta cenovnika
  cena_orig       numeric(12,2) default 0,         -- originalna cena u toj valuti
  kurs            numeric(10,4) default 1,         -- primenjeni kurs EUR→RSD
  napomena        text default '',
  fakturisan      boolean default false,
  broj_fakture    text default '',
  datum_fakture   date,
  created_by      bigint references zaposleni(id) on delete set null,
  created_at      timestamptz default now()
);
create index on nalozi (datum);
create index on nalozi (zap_id);
create index on nalozi (pravno_lice_id);
create index on nalozi (status);
create index on nalozi (fakturisan);

-- 1.8 Troškovi
create table troskovi (
  id          bigint generated always as identity primary key,
  datum       date not null,
  opis        text not null,
  kategorija  text default 'Ostalo',
  iznos       numeric(14,2) default 0,
  tip         text default 'varijabilan' check (tip in ('fiksni','varijabilan')),
  napomena    text default ''
);
create index on troskovi (datum);

-- 1.9 Reklamacije
create table reklamacije (
  id            bigint generated always as identity primary key,
  nalog_id      bigint references nalozi(id) on delete set null,
  datum         date not null,
  tip           text default 'reklamacija',
  klijent       text default '',
  opis          text not null,
  status        text default 'otvorena' check (status in ('otvorena','urad','resena','odbijena')),
  kompenzacija  numeric(12,2) default 0,
  resenje       text default ''
);

-- 1.10 Potrošnja (skidanje hemije po nalogu)
create table potrosnja (
  id        bigint generated always as identity primary key,
  nalog_id  bigint references nalozi(id) on delete cascade,
  mag_id    bigint references magacin(id) on delete cascade,
  kolicina  numeric(14,3) default 0,
  datum     date not null
);
create index on potrosnja (datum);
create index on potrosnja (nalog_id);

-- 1.11 Nabavke (dopune magacina)
create table nabavke (
  id        bigint generated always as identity primary key,
  mag_id    bigint references magacin(id) on delete cascade,
  kolicina  numeric(14,3) default 0,
  cena      numeric(12,4) default 0,
  ukupno    numeric(14,2) default 0,
  datum     date not null
);

-- ---------------------------------------------------------------------------
-- 2. POMOĆNE FUNKCIJE ZA ULOGE
--    SECURITY DEFINER da RLS na `zaposleni` ne bi ulazio u rekurziju.
-- ---------------------------------------------------------------------------
create or replace function public.moja_uloga()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select uloga from zaposleni where auth_id = auth.uid() and aktivan limit 1), 'nema');
$$;

create or replace function public.je_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.moja_uloga() = 'admin';
$$;

create or replace function public.moj_zaposleni_id()
returns bigint language sql stable security definer set search_path = public as $$
  select (select id from zaposleni where auth_id = auth.uid() and aktivan limit 1);
$$;

-- ---------------------------------------------------------------------------
-- 3. RLS POLITIKE
--    Pravilo: bez prijave = nikakav pristup.
--    admin    → sve
--    korisnik → čita šifarnike, piše naloge/klijente/reklamacije/potrošnju
--    viewer   → samo čitanje svojih naloga
-- ---------------------------------------------------------------------------
alter table podesavanja enable row level security;
alter table zaposleni   enable row level security;
alter table praznici    enable row level security;
alter table magacin     enable row level security;
alter table usluge      enable row level security;
alter table klijenti    enable row level security;
alter table nalozi      enable row level security;
alter table troskovi    enable row level security;
alter table reklamacije enable row level security;
alter table potrosnja   enable row level security;
alter table nabavke     enable row level security;

-- 3.1 Šifarnici: svi prijavljeni čitaju, samo admin menja
--     (podesavanja, zaposleni, praznici, magacin, usluge)
create policy "citanje_prijavljeni" on podesavanja for select to authenticated
  using (public.moja_uloga() <> 'nema');
create policy "izmena_admin"        on podesavanja for all    to authenticated
  using (public.je_admin()) with check (public.je_admin());

create policy "citanje_prijavljeni" on zaposleni for select to authenticated
  using (public.moja_uloga() <> 'nema');
create policy "izmena_admin"        on zaposleni for all    to authenticated
  using (public.je_admin()) with check (public.je_admin());

create policy "citanje_prijavljeni" on praznici for select to authenticated
  using (public.moja_uloga() <> 'nema');
create policy "izmena_admin"        on praznici for all    to authenticated
  using (public.je_admin()) with check (public.je_admin());

create policy "citanje_prijavljeni" on usluge for select to authenticated
  using (public.moja_uloga() <> 'nema');
create policy "izmena_admin"        on usluge for all    to authenticated
  using (public.je_admin()) with check (public.je_admin());

-- Magacin: stanje se menja automatski pri završetku naloga → i korisnik mora da piše
create policy "citanje_prijavljeni" on magacin for select to authenticated
  using (public.moja_uloga() <> 'nema');
create policy "izmena_korisnik"     on magacin for update to authenticated
  using (public.moja_uloga() in ('admin','korisnik'))
  with check (public.moja_uloga() in ('admin','korisnik'));
create policy "unos_admin"          on magacin for insert to authenticated
  with check (public.je_admin());
create policy "brisanje_admin"      on magacin for delete to authenticated
  using (public.je_admin());

-- 3.2 Klijenti: čitaju svi prijavljeni, pišu admin i korisnik, briše samo admin
create policy "citanje_prijavljeni" on klijenti for select to authenticated
  using (public.moja_uloga() <> 'nema');
create policy "unos_korisnik"       on klijenti for insert to authenticated
  with check (public.moja_uloga() in ('admin','korisnik'));
create policy "izmena_korisnik"     on klijenti for update to authenticated
  using (public.moja_uloga() in ('admin','korisnik'))
  with check (public.moja_uloga() in ('admin','korisnik'));
create policy "brisanje_admin"      on klijenti for delete to authenticated
  using (public.je_admin());

-- 3.3 Nalozi: admin sve; korisnik/viewer samo svoje (dodeljene ili koje su kreirali)
create policy "citanje_svojih" on nalozi for select to authenticated
  using (
    public.je_admin()
    or zap_id     = public.moj_zaposleni_id()
    or created_by = public.moj_zaposleni_id()
  );
create policy "unos_korisnik"  on nalozi for insert to authenticated
  with check (public.moja_uloga() in ('admin','korisnik'));
create policy "izmena_svojih"  on nalozi for update to authenticated
  using (
    public.je_admin()
    or (public.moja_uloga() = 'korisnik'
        and (zap_id = public.moj_zaposleni_id() or created_by = public.moj_zaposleni_id()))
  )
  with check (
    public.je_admin()
    or (public.moja_uloga() = 'korisnik'
        and (zap_id = public.moj_zaposleni_id() or created_by = public.moj_zaposleni_id()))
  );
create policy "brisanje_admin" on nalozi for delete to authenticated
  using (public.je_admin());

-- 3.4 Troškovi i nabavke: isključivo admin (finansije)
create policy "samo_admin" on troskovi for all to authenticated
  using (public.je_admin()) with check (public.je_admin());
create policy "samo_admin" on nabavke  for all to authenticated
  using (public.je_admin()) with check (public.je_admin());

-- 3.5 Reklamacije: čitaju svi prijavljeni, pišu admin i korisnik
create policy "citanje_prijavljeni" on reklamacije for select to authenticated
  using (public.moja_uloga() <> 'nema');
create policy "izmena_korisnik"     on reklamacije for insert to authenticated
  with check (public.moja_uloga() in ('admin','korisnik'));
create policy "azuriranje_korisnik" on reklamacije for update to authenticated
  using (public.moja_uloga() in ('admin','korisnik'))
  with check (public.moja_uloga() in ('admin','korisnik'));
create policy "brisanje_admin"      on reklamacije for delete to authenticated
  using (public.je_admin());

-- 3.6 Potrošnja: prati naloge
create policy "citanje_prijavljeni" on potrosnja for select to authenticated
  using (public.moja_uloga() <> 'nema');
create policy "unos_korisnik"       on potrosnja for insert to authenticated
  with check (public.moja_uloga() in ('admin','korisnik'));
create policy "brisanje_korisnik"   on potrosnja for delete to authenticated
  using (public.moja_uloga() in ('admin','korisnik'));

-- ---------------------------------------------------------------------------
-- 4. REALTIME — promene se odmah vide na svim uređajima
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table nalozi;
alter publication supabase_realtime add table klijenti;
alter publication supabase_realtime add table magacin;
alter publication supabase_realtime add table potrosnja;
alter publication supabase_realtime add table usluge;
alter publication supabase_realtime add table zaposleni;
alter publication supabase_realtime add table troskovi;
alter publication supabase_realtime add table reklamacije;
alter publication supabase_realtime add table praznici;
alter publication supabase_realtime add table podesavanja;

-- ============================================================================
-- 5. SEED — PRODUKCIONI PODACI
--    Preneto iz Balkan_Car_Wash_baza.xlsx. Testni nalozi, testne subote i
--    testne transakcije magacina NISU preneti (namerno obrisani).
-- ============================================================================

-- 5.1 Podešavanja  (POPUNITI: naziv, adresa, PIB, MB, račun — koriste se na fakturi)
insert into podesavanja (id, naziv_perionice, adresa, pib, mb, tekuci_racun, telefon, email,
                         radno_vreme_start, radno_vreme_end,
                         fiksni_trosak, zeljeni_profit, bonus_prag, bonus_procenat,
                         eur_kurs, u_sistemu_pdv, pdv_stopa)
values (1, 'Balkan Car Wash', 'POPUNITI — adresa perionice', 'POPUNITI', 'POPUNITI', 'POPUNITI',
        '', '', '08:00', '17:00',
        550000, 200000, 0, 0,
        117.0, true, 20);

-- 5.2 Magacin  (iz lista „Magacin"; cena = nabavna cena po jedinici mere)
insert into magacin (naziv, kategorija, jedinica, cena, stanje, min_stanje) values
  ('Šampon za pranje',   'Hemija',              'ml',  0.8, 5000, 1000),   -- id 1
  ('APC univerzalni',    'Hemija',              'ml',  0.6, 5000, 1000),   -- id 2
  ('Sredstvo za felne',  'Hemija',              'ml',  1.2, 3000,  800),   -- id 3
  ('Dubinsko sredstvo',  'Hemija',              'ml',  2.0, 2000,  500),   -- id 4
  ('Pasta za poliranje', 'Hemija',              'g',   3.5, 2000,  400),   -- id 5
  ('Mikrofiber krpe',    'Potrošni materijal',  'kom', 150,  200,   40);   -- id 6

-- 5.3 Usluge  (iz lista „Usluge" + normativi iz lista „Normativi")
--     interna = 50% cene u RSD — PRETPOSTAVKA, koriguje se u aplikaciji.
insert into usluge (naziv, tip_vozila, kategorija, cena, valuta, interna, trajanje, boja, normativi) values
  ('Obično pranje',               'Svi tipovi', 'Pranje',    1200, 'RSD',   600,  30, '#0369a1',
   '[{"magId":1,"kol":50},{"magId":2,"kol":20},{"magId":3,"kol":30},{"magId":6,"kol":3}]'),
  ('Premium pranje',              'Svi tipovi', 'Pranje',    2000, 'RSD',  1000,  60, '#047857',
   '[{"magId":1,"kol":80},{"magId":2,"kol":50},{"magId":3,"kol":50},{"magId":6,"kol":5}]'),
  ('Kombi osnovno',               'Kombi',      'Flota',     1000, 'RSD',   500,  25, '#0e7490',
   '[{"magId":1,"kol":40},{"magId":2,"kol":20},{"magId":3,"kol":20},{"magId":6,"kol":2}]'),
  ('Auto za prodaju A',           'Svi tipovi', 'Prodaja',   9000, 'RSD',  4500, 180, '#a16207',
   '[]'),
  ('Auto za prodaju B',           'Svi tipovi', 'Prodaja',  13500, 'RSD',  6750, 270, '#b45309',
   '[{"magId":1,"kol":100},{"magId":2,"kol":150},{"magId":3,"kol":80},{"magId":4,"kol":100},{"magId":5,"kol":50},{"magId":6,"kol":8}]'),
  ('Auto za prodaju C',           'Svi tipovi', 'Prodaja',  20000, 'RSD', 10000, 480, '#c2410c',
   '[]'),
  ('Retail dubinsko + poliranje', 'Svi tipovi', 'Detailing',  165, 'EUR',  9652, 420, '#6b21a8',
   '[{"magId":1,"kol":150},{"magId":2,"kol":200},{"magId":3,"kol":100},{"magId":4,"kol":150},{"magId":5,"kol":80},{"magId":6,"kol":10}]'),
  ('Plac/B2B priprema',           'Svi tipovi', 'Detailing',  120, 'EUR',  7020, 240, '#be123c',
   '[]');
-- NAPOMENA: usluge u4 (Auto za prodaju A) i u6 (Auto za prodaju C) u izvornoj bazi
-- nemaju definisane normative. Uneti ih u aplikaciji: Usluge → Uredi → Normativi.

-- 5.4 Zaposleni
--     Redovi 1 i 2 = stvarni admini (iz lista „Korisnici").
--     Redovi 3 i 4 = radnici iz lista „Radnici" — PREIMENOVATI u prava imena.
--     auth_id se popunjava u koraku 4 uputstva (posle kreiranja naloga u Authentication).
insert into zaposleni (ime, prezime, email, uloga, pin, avatar, color, bonus, radno_vreme, napomena) values
  ('Pedja', 'Krsmanović', 'pedja@balkangroup.rs', 'admin',    '', 'PK', '#5a5cf0',  0,
   '{"1":{"radi":true,"od":"08:00","do":"17:00"},"2":{"radi":true,"od":"08:00","do":"17:00"},"3":{"radi":true,"od":"08:00","do":"17:00"},"4":{"radi":true,"od":"08:00","do":"17:00"},"5":{"radi":true,"od":"08:00","do":"17:00"},"6":{"radi":false,"od":"08:00","do":"14:00"},"7":{"radi":false,"od":"08:00","do":"14:00"}}',
   'Administrator'),
  ('Ivan', 'Pajić', 'ivan@balkangroup.rs', 'admin', '', 'IP', '#0e7490', 0,
   '{"1":{"radi":true,"od":"08:00","do":"17:00"},"2":{"radi":true,"od":"08:00","do":"17:00"},"3":{"radi":true,"od":"08:00","do":"17:00"},"4":{"radi":true,"od":"08:00","do":"17:00"},"5":{"radi":true,"od":"08:00","do":"17:00"},"6":{"radi":false,"od":"08:00","do":"14:00"},"7":{"radi":false,"od":"08:00","do":"14:00"}}',
   'Administrator'),
  ('Radnik', '1', '', 'korisnik', '1234', 'R1', '#10b981', 20,
   '{"1":{"radi":true,"od":"08:00","do":"17:00"},"2":{"radi":true,"od":"08:00","do":"17:00"},"3":{"radi":true,"od":"08:00","do":"17:00"},"4":{"radi":true,"od":"08:00","do":"17:00"},"5":{"radi":true,"od":"08:00","do":"17:00"},"6":{"radi":true,"od":"08:00","do":"14:00"},"7":{"radi":false,"od":"08:00","do":"14:00"}}',
   'Dubinsko / poliranje / detailing — PREIMENOVATI'),
  ('Radnik', '2', '', 'korisnik', '2345', 'R2', '#f97316', 20,
   '{"1":{"radi":true,"od":"08:00","do":"17:00"},"2":{"radi":true,"od":"08:00","do":"17:00"},"3":{"radi":true,"od":"08:00","do":"17:00"},"4":{"radi":true,"od":"08:00","do":"17:00"},"5":{"radi":true,"od":"08:00","do":"17:00"},"6":{"radi":true,"od":"08:00","do":"14:00"},"7":{"radi":false,"od":"08:00","do":"14:00"}}',
   'Pranje / flota / kombiji — PREIMENOVATI');

-- 5.5 Klijenti + vozila (iz listova „Klijenti" i „Vozila")
insert into klijenti (tip, ime, tel, email, vozila) values
  ('interni', 'Ivan Pajić', '+381668517999', 'ivan@balkangroup.rs',
   '[{"regTab":"LJ60ZDN","marka":"MERCEDES","model":"CLA","tip":"Putničko - srednje"}]');

-- 5.6 Praznici — Republika Srbija
--     Fiksni datumi po Zakonu o državnim i drugim praznicima.
--     Uskršnji praznici su POMIČNI — proveriti i korigovati pre početka godine.
insert into praznici (datum, naziv, neradni) values
  ('2026-11-11', 'Dan primirja u Prvom svetskom ratu', true),
  ('2027-01-01', 'Nova godina',                        true),
  ('2027-01-02', 'Nova godina',                        true),
  ('2027-01-07', 'Božić',                              true),
  ('2027-02-15', 'Sretenje — Dan državnosti',          true),
  ('2027-02-16', 'Sretenje — Dan državnosti',          true),
  ('2027-05-01', 'Praznik rada',                       true),
  ('2027-05-02', 'Praznik rada',                       true),
  ('2027-11-11', 'Dan primirja u Prvom svetskom ratu', true);
-- PROVERITI pre 2027: Veliki petak / Vaskrs / Vaskršnji ponedeljak
-- (pravoslavni Vaskrs 2027. pada 02.05.2027 — preklapa se sa Praznikom rada).

-- ============================================================================
-- KRAJ. Sledeći korak: Authentication → Users → kreirati naloge,
-- pa povezati auth_id (vidi UPUTSTVO_PUSTANJE_U_RAD.md, korak 4).
-- ============================================================================
