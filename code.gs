/**
 * BALKAN CAR WASH — Google Apps Script Web App (API/backend)
 * ----------------------------------------------------------
 * Baza: aktivni Google Sheet u kome se nalazi ovaj skript.
 * Frontend (GitHub Pages) komunicira sa ovim Web App-om preko POST zahteva.
 *
 * Deploy: Extensions > Apps Script > Deploy > New deployment > Web app
 *   - Execute as: Me
 *   - Who has access: Anyone
 * Kopiraj /exec URL u Podešavanja u aplikaciji.
 *
 * Napomena o CORS: zahtevi se šalju kao Content-Type: text/plain da bi se
 * izbegao preflight (OPTIONS) koji Apps Script ne podržava. Body je JSON string.
 */

// ---- Definicija tabela (tab -> kolone) -------------------------------------
var SCHEMA = {
  Vozila:       ['id','tablice','marka','model','tip','klijent_id','telefon','napomena'],
  Klijenti:     ['id','naziv','tip','telefon','email','napomena'],
  Usluge:       ['id','naziv','kategorija','cena','valuta','trajanje','aktivna','napomena'],
  Normativi:    ['id','usluga_id','artikal_id','kolicina'],
  Magacin:      ['id','naziv','kategorija','jm','stanje','min_stanje','nabavna_cena','dobavljac','napomena'],
  MagacinTx:    ['id','datum','artikal_id','tip','kolicina','nalog_id','napomena'],
  Nalozi:       ['id','datum','vreme','vozilo_id','tablice','marka','model','klijent_id','usluga_id','radnik_id','trajanje','cena','placanje','status','napomena','reklamacija','potroseno','kreiran','zavrsen'],
  Radnici:      ['id','ime','uloga','telefon','aktivan','napomena'],
  Troskovi:     ['id','datum','kategorija','opis','iznos','napomena'],
  Prihodi:      ['id','datum','tip','opis','iznos','interna','nalog_id','napomena'],
  Reklamacije:  ['id','datum','vozilo_id','klijent_id','tip','radnik_id','opis','resenje','trosak','status'],
  Subote:       ['id','datum','radnik_id','tip_posla','sati','dodatak','napomena'],
  Bonusi:       ['id','mesec','radnik_id','predlog','odobreno','iznos','napomena'],
  Korisnici:    ['id','korisnicko_ime','ime','uloga','lozinka_hash','salt','aktivan','napomena'],
  Podesavanja:  ['kljuc','vrednost']
};

// Polja koja se NIKADA ne vraćaju klijentu
var SENSITIVE = { Korisnici: ['lozinka_hash','salt'] };

function doGet(e) {
  return respond({ ok: true, msg: 'Balkan Car Wash API radi. Koristi POST.' });
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var action = req.action;
    var result;
    switch (action) {
      case 'ping':      result = { ok: true, time: new Date().toISOString() }; break;
      case 'setup':     result = setup(); break;
      case 'bootstrap': result = bootstrap(); break;
      case 'list':      result = sanitize_(req.sheet, listSheet(req.sheet)); break;
      case 'create':    result = createRow(req.sheet, req.data); break;
      case 'update':    result = updateRow(req.sheet, req.id, req.data); break;
      case 'delete':    result = deleteRow(req.sheet, req.id); break;
      case 'bulkSet':   result = bulkSet(req.sheet, req.rows); break;
      case 'setSetting':result = setSetting(req.kljuc, req.vrednost); break;
      case 'login':         result = login(req.korisnicko_ime, req.lozinka); break;
      case 'createUser':    result = createUser(req.data, req.lozinka); break;
      case 'updateUser':    result = updateUser(req.id, req.data); break;
      case 'resetPassword': result = resetPassword(req.id, req.lozinka); break;
      default: throw new Error('Nepoznata akcija: ' + action);
    }
    return respond({ ok: true, data: result });
  } catch (err) {
    return respond({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Helperi za rad sa tabovima --------------------------------------------
function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

function getOrCreateSheet(name) {
  var s = ss().getSheetByName(name);
  if (!s) {
    s = ss().insertSheet(name);
    s.appendRow(SCHEMA[name]);
    s.getRange(1, 1, 1, SCHEMA[name].length).setFontWeight('bold');
    s.setFrozenRows(1);
  }
  return s;
}

function headers(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function listSheet(name) {
  var s = getOrCreateSheet(name);
  var last = s.getLastRow();
  if (last < 2) return [];
  var head = headers(s);
  var values = s.getRange(2, 1, last - 1, head.length).getValues();
  return values.map(function (row) {
    var obj = {};
    head.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function rowIndexById(sheet, id) {
  var head = headers(sheet);
  var idCol = head.indexOf('id');
  if (idCol < 0) idCol = head.indexOf('kljuc');
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var ids = sheet.getRange(2, idCol + 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2; // 1-based row
  }
  return -1;
}

function createRow(name, data) {
  var s = getOrCreateSheet(name);
  var head = headers(s);
  var row = head.map(function (h) { return data[h] !== undefined ? data[h] : ''; });
  s.appendRow(row);
  return data;
}

function updateRow(name, id, data) {
  var s = getOrCreateSheet(name);
  var head = headers(s);
  var r = rowIndexById(s, id);
  if (r < 0) return createRow(name, data);
  var current = s.getRange(r, 1, 1, head.length).getValues()[0];
  var row = head.map(function (h, i) { return data[h] !== undefined ? data[h] : current[i]; });
  s.getRange(r, 1, 1, head.length).setValues([row]);
  return data;
}

function deleteRow(name, id) {
  var s = getOrCreateSheet(name);
  var r = rowIndexById(s, id);
  if (r > 0) s.deleteRow(r);
  return { deleted: id };
}

// Zameni ceo sadržaj taba (koristi se za popis / batch korekcije)
function bulkSet(name, rows) {
  var s = getOrCreateSheet(name);
  var head = headers(s);
  var last = s.getLastRow();
  if (last > 1) s.getRange(2, 1, last - 1, head.length).clearContent();
  if (rows && rows.length) {
    var matrix = rows.map(function (data) {
      return head.map(function (h) { return data[h] !== undefined ? data[h] : ''; });
    });
    s.getRange(2, 1, matrix.length, head.length).setValues(matrix);
  }
  return { count: rows ? rows.length : 0 };
}

function setSetting(kljuc, vrednost) {
  var s = getOrCreateSheet('Podesavanja');
  var r = rowIndexById(s, kljuc);
  if (r < 0) { s.appendRow([kljuc, vrednost]); }
  else { s.getRange(r, 2).setValue(vrednost); }
  return { kljuc: kljuc, vrednost: vrednost };
}

// ---- Bootstrap: vrati sve podatke u jednom pozivu --------------------------
function bootstrap() {
  var out = {};
  Object.keys(SCHEMA).forEach(function (name) { out[name] = sanitize_(name, listSheet(name)); });
  return out;
}

// ---- Setup: kreiraj sve tabove + početne podatke ---------------------------
function setup() {
  Object.keys(SCHEMA).forEach(function (name) { getOrCreateSheet(name); });
  seedIfEmpty();
  return { ok: true, sheets: Object.keys(SCHEMA) };
}

// ---- Autentifikacija / korisnici -------------------------------------------
function sha256_(str) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return raw.map(function (b) { b = (b < 0) ? b + 256 : b; var s = b.toString(16); return s.length === 1 ? '0' + s : s; }).join('');
}
function genSalt_() {
  var s = '', chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (var i = 0; i < 12; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
function sanitize_(name, rows) {
  var hide = SENSITIVE[name];
  if (!hide) return rows;
  return rows.map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { if (hide.indexOf(k) < 0) o[k] = r[k]; }); return o; });
}
function findUserRaw_(korisnicko_ime) {
  var rows = listSheet('Korisnici');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].korisnicko_ime).toLowerCase() === String(korisnicko_ime).toLowerCase()) return rows[i];
  }
  return null;
}
function login(korisnicko_ime, lozinka) {
  var u = findUserRaw_(korisnicko_ime);
  if (!u) throw new Error('Pogrešno korisničko ime ili lozinka.');
  if (String(u.aktivan) === 'ne') throw new Error('Nalog je deaktiviran.');
  if (sha256_(u.salt + ':' + lozinka) !== String(u.lozinka_hash)) throw new Error('Pogrešno korisničko ime ili lozinka.');
  return { id: u.id, korisnicko_ime: u.korisnicko_ime, ime: u.ime, uloga: u.uloga };
}
function createUser(data, lozinka) {
  if (findUserRaw_(data.korisnicko_ime)) throw new Error('Korisničko ime već postoji.');
  var salt = genSalt_();
  var row = {
    id: data.id, korisnicko_ime: data.korisnicko_ime, ime: data.ime, uloga: data.uloga,
    lozinka_hash: sha256_(salt + ':' + lozinka), salt: salt,
    aktivan: data.aktivan || 'da', napomena: data.napomena || ''
  };
  createRow('Korisnici', row);
  return { id: row.id, korisnicko_ime: row.korisnicko_ime, ime: row.ime, uloga: row.uloga, aktivan: row.aktivan };
}
function updateUser(id, data) {
  var s = getOrCreateSheet('Korisnici');
  var r = rowIndexById(s, id);
  if (r < 0) throw new Error('Korisnik ne postoji.');
  var head = headers(s);
  var current = s.getRange(r, 1, 1, head.length).getValues()[0];
  // ne diramo lozinka_hash/salt ovde
  var allowed = ['korisnicko_ime', 'ime', 'uloga', 'aktivan', 'napomena'];
  var row = head.map(function (h, i) { return (allowed.indexOf(h) >= 0 && data[h] !== undefined) ? data[h] : current[i]; });
  s.getRange(r, 1, 1, head.length).setValues([row]);
  return { id: id };
}
function resetPassword(id, lozinka) {
  var s = getOrCreateSheet('Korisnici');
  var r = rowIndexById(s, id);
  if (r < 0) throw new Error('Korisnik ne postoji.');
  var head = headers(s);
  var salt = genSalt_();
  s.getRange(r, head.indexOf('salt') + 1).setValue(salt);
  s.getRange(r, head.indexOf('lozinka_hash') + 1).setValue(sha256_(salt + ':' + lozinka));
  return { id: id };
}

function seedIfEmpty() {
  if (listSheet('Korisnici').length === 0) {
    // podrazumevani admin (PROMENI LOZINKU posle prve prijave!)
    var salt = genSalt_();
    createRow('Korisnici', { id: 'usr_admin', korisnicko_ime: 'admin', ime: 'Administrator', uloga: 'admin',
      lozinka_hash: sha256_(salt + ':admin123'), salt: salt, aktivan: 'da', napomena: 'Podrazumevani nalog — promeni lozinku' });
  }
  if (listSheet('Radnici').length === 0) {
    createRow('Radnici', { id: 'rad1', ime: 'Radnik 1 — Detailing', uloga: 'detailing', telefon: '', aktivan: 'da', napomena: 'Dubinsko / poliranje / detailing' });
    createRow('Radnici', { id: 'rad2', ime: 'Radnik 2 — Pranje/Flota', uloga: 'pranje', telefon: '', aktivan: 'da', napomena: 'Pranje / flota / kombiji' });
  }
  if (listSheet('Usluge').length === 0) {
    var u = [
      ['u1','Obično pranje','pranje',1200,'RSD',30,'da'],
      ['u2','Premium pranje','pranje',2000,'RSD',60,'da'],
      ['u3','Kombi osnovno','flota',1000,'RSD',25,'da'],
      ['u4','Auto za prodaju A','prodaja',9000,'RSD',180,'da'],
      ['u5','Auto za prodaju B','prodaja',13500,'RSD',270,'da'],
      ['u6','Auto za prodaju C','prodaja',20000,'RSD',480,'da'],
      ['u7','Retail dubinsko + poliranje','detailing',165,'EUR',420,'da'],
      ['u8','Plac/B2B priprema','detailing',120,'EUR',240,'da']
    ];
    u.forEach(function (r) { createRow('Usluge', { id: r[0], naziv: r[1], kategorija: r[2], cena: r[3], valuta: r[4], trajanje: r[5], aktivna: r[6], napomena: '' }); });
  }
  if (listSheet('Magacin').length === 0) {
    var m = [
      ['a1','Šampon za pranje','hemija','ml',5000,1000,0.8,''],
      ['a2','APC univerzalni','hemija','ml',5000,1000,0.6,''],
      ['a3','Sredstvo za felne','hemija','ml',3000,800,1.2,''],
      ['a4','Dubinsko sredstvo','hemija','ml',2000,500,2.0,''],
      ['a5','Pasta za poliranje','hemija','g',2000,400,3.5,''],
      ['a6','Mikrofiber krpe','potrosno','kom',200,40,150,'']
    ];
    m.forEach(function (r) { createRow('Magacin', { id: r[0], naziv: r[1], kategorija: r[2], jm: r[3], stanje: r[4], min_stanje: r[5], nabavna_cena: r[6], dobavljac: r[7], napomena: '' }); });
  }
  if (listSheet('Normativi').length === 0) {
    var n = [
      ['u1','a1',50],['u1','a2',20],['u1','a3',30],['u1','a6',3],
      ['u2','a1',80],['u2','a2',50],['u2','a3',50],['u2','a6',5],
      ['u3','a1',40],['u3','a2',20],['u3','a3',20],['u3','a6',2],
      ['u5','a1',100],['u5','a2',150],['u5','a3',80],['u5','a4',100],['u5','a5',50],['u5','a6',8],
      ['u7','a1',150],['u7','a2',200],['u7','a3',100],['u7','a4',150],['u7','a5',80],['u7','a6',10]
    ];
    n.forEach(function (r, i) { createRow('Normativi', { id: 'n' + (i + 1), usluga_id: r[0], artikal_id: r[1], kolicina: r[2] }); });
  }
  if (listSheet('Podesavanja').length === 0) {
    var p = {
      mesecni_fiksni_trosak: 600000, zeljeni_profit: 200000, bonus_prag: 1000000,
      kurs_eur: 117, radno_pocetak: '08:00', radno_kraj: '16:00',
      sati_po_radniku: 8, subota_radna: 'po_potrebi', valuta: 'RSD', bonus_procenat: 10
    };
    Object.keys(p).forEach(function (k) { setSetting(k, p[k]); });
  }
}
