# Balkan Car Wash 3.1 — uloga RUKOVODILAC i izbacivanje admina iz rasporeda

Dopuna uputstva za verziju 3.0. Odnosi se na dva fajla: `index.html` i `supabase_schema.sql`.
`config.js` i `vercel.json` se ne menjaju.

---

## 1. Šta je novo

**Nova uloga `rukovodilac`** — nivo između korisnika i administratora. Vodi ekipu i
operativu, ne vidi finansije i ne menja šifarnike.

**Administratori više ne ulaze u raspored rada.** Ne prikazuju se u nedeljnom
rasporedu, planeru rada (Gantt), zauzetosti na dashboardu i u kalendarskom pregledu
smena, i ne mogu se izabrati kao izvršilac na radnom nalogu.

---

## 2. Matrica ovlašćenja

| Funkcija | Admin | Rukovodilac | Korisnik | Viewer |
|---|:--:|:--:|:--:|:--:|
| Dashboard | pun | bez troškova, rezultata, bonusa i cilja meseca | samo svoje | samo svoje |
| Kalendar termina | svi nalozi | svi nalozi | svoje | svoje |
| Planer rada (Gantt) | da | da | — | — |
| Radni nalozi — pregled | svi | **svi** | svoji | svoji |
| Radni nalozi — unos i izmena | da | **da, za sve** | samo svoje | ne |
| Radni nalozi — brisanje | **da** | ne | ne | ne |
| Klijenti i vozila — unos/izmena | da | da | da | — |
| Klijenti — brisanje | **da** | ne | ne | — |
| Reklamacije — unos/izmena | da | da | — | — |
| Reklamacije — brisanje | **da** | ne | — | — |
| Radnici i rasporedi — pregled | da | **da** | — | — |
| Radnici — dodavanje i izmena | **da** | ne | — | — |
| Praznici — izmena | **da** | ne | — | — |
| Magacin — stanje i niske zalihe | da | **da** | — | — |
| Magacin — nabavne cene i vrednost | **da** | ne | — | — |
| Magacin — unos, izmena, nabavka | **da** | ne | — | — |
| Usluge i normativi — pregled | da | **da** | — | — |
| Usluge, cene, normativi — izmena | **da** | ne | — | — |
| Interna vrednost i bonus | **da** | ne | ne | ne |
| Izveštaji | **da** | ne | — | — |
| Troškovnik | **da** | ne | — | — |
| Fakturisanje | **da** | ne | — | — |
| Podešavanja, backup | **da** | ne | — | — |

Rukovodilac vidi cene usluga i promet (to su iznosi sa naloga koje ionako vodi),
ali ne vidi nabavne cene, maržu, troškove, rezultat ni bonus.

---

## 3. Šta pokrenuti u Supabase

**Ako baza JOŠ NIJE napravljena** (nema podataka):
pokreni novi `supabase_schema.sql` — sve je već u njemu. Migracija ti ne treba.

**Ako baza VEĆ radi i u njoj ima podataka:**
NE pokreći `supabase_schema.sql` — on briše tabele.
Umesto toga: Supabase → SQL Editor → New query → nalepi `migracija_v3.1_rukovodilac.sql` → Run.
Skripta ne dira podatke i može se pokrenuti više puta.

---

## 4. Dodela uloge

**Kroz aplikaciju:** Radnici → Uredi radnika → Ovlašćenje → *Rukovodilac* → Sačuvaj.
Ispod polja se ispisuje objašnjenje izabrane uloge.

**Ili kroz SQL:**

```sql
update zaposleni set uloga = 'rukovodilac' where email = 'ime@balkangroup.rs';
```

Radnik mora imati nalog u Supabase → Authentication i popunjen `auth_id`
(korak 4 osnovnog uputstva). Promena ovlašćenja važi od sledeće prijave.

---

## 5. Na šta obratiti pažnju

1. **Postojeći nalozi dodeljeni administratoru.** Ostaju u bazi i u listi naloga, ali se
   ne prikazuju u planeru. Planer sada ispisuje žuto upozorenje sa brojevima takvih
   naloga — prebaci ih na izvršioca kroz *Uredi nalog*. Kada se uređuje stari nalog,
   dosadašnji izvršilac ostaje ponuđen u padajućoj listi da se ne bi tiho promenio.
2. **Ko treba da bude u rasporedu, ne sme biti admin.** Ako neko vodi ekipu a i sam
   radi na vozilima, dodeli mu `rukovodilac`, ne `admin`.
3. **Mora ostati bar jedan aktivan administrator.** Aplikacija sada odbija izmenu koja
   bi ukinula poslednjeg admina.
4. **Rukovodilac ne može da briše naloge** — može da ih stavi u status *Otkazano*.
   Brisanje ruši usaglašenost sa fakturama, pa ostaje kod administratora.
5. **Zaštita je dvostruka:** interfejs sakriva ono što uloga ne sme, a Supabase RLS
   politike to isto blokiraju na nivou baze. Ni direktan poziv baze ne zaobilazi pravila.

---

## 6. Ako zatreba proširenje

Nije uključeno, ali se dodaje brzo:

- rukovodilac unosi godišnje/bolovanja radnicima (izuzetke), bez prava na ostale
  podatke radnika;
- rukovodilac briše naloge koji nisu fakturisani;
- rukovodilac vidi izveštaj po radnicima bez novčanih kolona.
