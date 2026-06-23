# BALKAN CAR WASH — postavljanje online (GitHub Pages) + cloud baza

Aplikacija je **jedan HTML fajl** (`balkanCarWash.html`). Radi i lokalno (dvoklik), a podatke čuva u pregledaču (localStorage). Da bi bila **online i deljena između uređaja**, postavi je na GitHub Pages i poveži sa Google Sheets bazom.

---

## 1) Postavljanje na GitHub (da bude online)

1. Napravi nalog na https://github.com i klikni **New repository**.
   - Ime npr. `balkan-car-wash`, **Public**, i klikni *Create repository*.
2. Na stranici repozitorijuma: **Add file → Upload files**.
   - Prevuci `balkanCarWash.html` i **preimenuj ga u `index.html`** (da se otvara automatski).
   - Klikni **Commit changes**.
3. Idi na **Settings → Pages** (levi meni).
   - Pod *Source* izaberi **Deploy from a branch**.
   - Branch: **main**, folder: **/ (root)** → **Save**.
4. Sačekaj ~1 minut. Pojaviće se link tipa:
   `https://TVOJKORISNIK.github.io/balkan-car-wash/`
   To je tvoja online adresa — otvori je na bilo kom uređaju.

> Kad menjaš aplikaciju: ponovo *Upload files* i prepiši `index.html` (Commit). Pages se sam ažurira.

---

## 2) Cloud baza preko Google Sheets (deljeni podaci)

Bez ovoga svaki uređaj ima svoju lokalnu kopiju. Sa ovim svi rade nad istom bazom.

1. Otvori https://sheets.google.com → **Blank / Nova tabela**.
2. **Extensions → Apps Script**.
3. Obriši sav postojeći kod i nalepi sadržaj fajla **`Code.gs`** (priložen).
4. Klikni **Save** (disketa).
5. **Deploy → New deployment**:
   - klikni zupčanik → **Web app**
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
   - **Deploy** → odobri pristup (Authorize) svom Google nalogu.
6. Kopiraj **Web app URL** (završava se na `/exec`).
7. U aplikaciji: **Podešavanja → Cloud**:
   - nalepi URL u polje *Web App URL*
   - uključi **„Uključi cloud"**
   - klikni **„Sačuvaj cloud podešavanja"**, pa **„↑ Pošalji na cloud"** (prvi upis).
8. Na drugom uređaju: unesi isti URL i klikni **„↓ Učitaj sa clouda"**.

Status sinhronizacije se vidi dole levo u meniju (zelena tačka = sinhronizovano).

### Napomene o cloud-u
- Posle svake izmene aplikacija automatski šalje podatke na cloud (sa malim zadrškom).
- `LockService` u skripti sprečava da dva istovremena upisa pokvare bazu.
- Backup i dalje radi lokalno: **Podešavanja → Preuzmi JSON** (preporuka: jednom nedeljno).
- Ako menjaš `Code.gs` kasnije: **Deploy → Manage deployments → Edit (olovka) → Version: New version → Deploy** (URL ostaje isti).

---

## 3) Prijava (demo nalozi i PIN)

| Radnik | Uloga | PIN | Šta vidi |
|---|---|---|---|
| Aleksandar Jović | **admin** | 1111 | sve module, sve naloge, podešavanja, cloud |
| Bojan Marić | **korisnik** | 2222 | samo svoje naloge, dashboard, kalendar, klijenti |
| Stefan Novak | **korisnik** | 3333 | samo svoje naloge |
| Dejan Savić | **viewer** | 4444 | samo pregled svojih naloga (bez izmena) |

> PIN-ove i ovlašćenja menjaš u **Radnici** (kao admin).

---

## 4) Štampa / PDF
Svaka stranica ima dugme **PDF** (gore desno ili u alatnoj traci). Otvara se dijalog za štampu — izaberi **„Sačuvaj kao PDF"**. Izveštaji su podešeni za **A4 landscape** i optimizovani za **crno-belu** štampu (jasne tabele, šrafure umesto boja gde treba).

---

## Sažetak fajlova
- `index.html` (preimenovani `balkanCarWash.html`) — cela aplikacija
- `Code.gs` — Google Apps Script backend za cloud bazu
