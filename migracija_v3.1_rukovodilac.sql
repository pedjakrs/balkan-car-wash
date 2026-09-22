-- ============================================================================
-- BALKAN CAR WASH — migracija 3.0 → 3.1
-- Dodaje ulogu RUKOVODILAC i prilagođava RLS politike.
-- ----------------------------------------------------------------------------
-- KADA SE KORISTI: samo ako je supabase_schema.sql VEĆ pokrenut i u bazi
-- postoje podaci. Skripta NE briše nijednu tabelu i NE dira podatke.
-- Ako baza još nije pravljena, ne koristi ovu skriptu — pokreni odmah
-- novi supabase_schema.sql (v3.1), koji sve ovo već sadrži.
--
-- POKRETANJE: Supabase → SQL Editor → New query → nalepi → Run.
-- Bezbedno je pokrenuti više puta.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Dozvoli novu vrednost u koloni `uloga`
-- ---------------------------------------------------------------------------
alter table zaposleni drop constraint if exists zaposleni_uloga_check;
alter table zaposleni add  constraint zaposleni_uloga_check
  check (uloga in ('admin','rukovodilac','korisnik','viewer'));

-- ---------------------------------------------------------------------------
-- 2. Nove pomoćne funkcije (SECURITY DEFINER — bez rekurzije RLS-a)
-- ---------------------------------------------------------------------------
create or replace function public.je_menadzer()
returns boolean language sql stable security definer set search_path = public as $$
  select public.moja_uloga() in ('admin','rukovodilac');
$$;

create or replace function public.moze_upis()
returns boolean language sql stable security definer set search_path = public as $$
  select public.moja_uloga() in ('admin','rukovodilac','korisnik');
$$;

-- ---------------------------------------------------------------------------
-- 3. RLS politike koje se menjaju
--    (podesavanja, zaposleni, praznici, usluge, troskovi i nabavke ostaju
--     nepromenjeni — i dalje ih menja i vidi isključivo admin)
-- ---------------------------------------------------------------------------

-- 3.1 Magacin — stanje se umanjuje pri završetku naloga
drop policy if exists "izmena_korisnik" on magacin;
create policy "izmena_korisnik" on magacin for update to authenticated
  using (public.moze_upis()) with check (public.moze_upis());

-- 3.2 Klijenti
drop policy if exists "unos_korisnik"   on klijenti;
drop policy if exists "izmena_korisnik" on klijenti;
create policy "unos_korisnik"   on klijenti for insert to authenticated
  with check (public.moze_upis());
create policy "izmena_korisnik" on klijenti for update to authenticated
  using (public.moze_upis()) with check (public.moze_upis());

-- 3.3 Nalozi — rukovodilac vidi i menja sve, briše i dalje samo admin
drop policy if exists "citanje_svojih" on nalozi;
drop policy if exists "unos_korisnik"  on nalozi;
drop policy if exists "izmena_svojih"  on nalozi;
create policy "citanje_svojih" on nalozi for select to authenticated
  using (
    public.je_menadzer()
    or zap_id     = public.moj_zaposleni_id()
    or created_by = public.moj_zaposleni_id()
  );
create policy "unos_korisnik"  on nalozi for insert to authenticated
  with check (public.moze_upis());
create policy "izmena_svojih"  on nalozi for update to authenticated
  using (
    public.je_menadzer()
    or (public.moja_uloga() = 'korisnik'
        and (zap_id = public.moj_zaposleni_id() or created_by = public.moj_zaposleni_id()))
  )
  with check (
    public.je_menadzer()
    or (public.moja_uloga() = 'korisnik'
        and (zap_id = public.moj_zaposleni_id() or created_by = public.moj_zaposleni_id()))
  );

-- 3.4 Reklamacije
drop policy if exists "izmena_korisnik"     on reklamacije;
drop policy if exists "azuriranje_korisnik" on reklamacije;
create policy "izmena_korisnik"     on reklamacije for insert to authenticated
  with check (public.moze_upis());
create policy "azuriranje_korisnik" on reklamacije for update to authenticated
  using (public.moze_upis()) with check (public.moze_upis());

-- 3.5 Potrošnja
drop policy if exists "unos_korisnik"     on potrosnja;
drop policy if exists "brisanje_korisnik" on potrosnja;
create policy "unos_korisnik"     on potrosnja for insert to authenticated
  with check (public.moze_upis());
create policy "brisanje_korisnik" on potrosnja for delete to authenticated
  using (public.moze_upis());

commit;

-- ============================================================================
-- 4. DODELA ULOGE — pokrenuti ručno, uz zamenu e-mail adrese
-- ============================================================================
-- update zaposleni set uloga = 'rukovodilac' where email = 'ime@balkangroup.rs';

-- Provera stanja posle migracije:
-- select id, ime, prezime, email, uloga, aktivan from zaposleni order by id;
-- ============================================================================
