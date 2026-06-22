/* ============================================================================
   BALKAN CAR WASH — app.js
   Frontend logika: storage (demo/local + Google Apps Script), ruter, moduli,
   Gantt planer, grafikoni (Chart.js), PDF izvoz (jsPDF + html2canvas).
   ============================================================================ */
'use strict';

/* ----------------------------- KONSTANTE ---------------------------------- */
const TIPOVI_VOZILA = [
  ['prodaja','Vozilo za prodaju'],['rent','Rent-a-car'],['sluzbeno','Službeno vozilo'],
  ['kombi','Kombi'],['spoljni','Spoljni klijent'],['pravno','Pravno lice']
];
const TIPOVI_KLIJENT = [
  ['interni','Interni'],['spoljni','Spoljni klijent'],['pravno','Pravno lice']
];
const EKSTERNI_TIPOVI = ['spoljni','pravno']; // donose naplaćeni (cash) prihod

const STATUSI = [
  ['zakazano','Zakazano'],['stiglo','Vozilo stiglo'],['u_radu','U radu'],
  ['ceka_susenje','Čeka sušenje'],['ceka_kontrolu','Čeka kontrolu'],
  ['zavrseno','Završeno'],['spremno','Spremno za preuzimanje'],['preuzeto','Preuzeto'],
  ['reklamacija','Reklamacija'],['otkazano','Otkazano']
];
const STATUS_LABEL = Object.fromEntries(STATUSI);
const CONSUME_STATUSI = ['zavrseno','spremno','preuzeto']; // skidaju normativ
const PLACANJA = [['gotovina','Gotovina'],['kartica','Kartica'],['racun','Račun/Faktura'],['interno','Interno'],['neplaceno','Neplaćeno']];
const KAT_TROSAK = ['plate','porezi','hemija','potrosno','struja','voda','servis','marketing','renta','knjigovodja','ostalo'];
const KAT_TROSAK_L = {plate:'Plate',porezi:'Porezi/doprinosi',hemija:'Hemija',potrosno:'Krpe/potrošno',struja:'Struja',voda:'Voda',servis:'Servis opreme',marketing:'Marketing',renta:'Renta',knjigovodja:'Knjigovođa',ostalo:'Ostalo'};

const DEFAULT_SETTINGS = {
  apiUrl:'', mesecni_fiksni_trosak:600000, zeljeni_profit:200000, bonus_prag:1000000,
  kurs_eur:117, radno_pocetak:'08:00', radno_kraj:'16:00', sati_po_radniku:8,
  subota_radna:'po_potrebi', valuta:'RSD', bonus_procenat:10
};

/* ----------------------------- POMOĆNE -------------------------------------*/
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const uid = p => (p||'X') + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf  = new Intl.NumberFormat('sr-RS');
const money = (n,cur='RSD') => (nf.format(Math.round(Number(n)||0))+' '+cur);
const num = v => { const n=parseFloat(String(v).replace(',','.')); return isNaN(n)?0:n; };

function todayISO(){ const d=new Date(); return d.toISOString().slice(0,10); }
function monthKey(d){ return String(d).slice(0,7); }
function fmtDate(iso){ if(!iso) return '—'; const [y,m,d]=String(iso).slice(0,10).split('-'); return d&&m&&y?`${d}.${m}.${y}.`:iso; }
function dayName(iso){ const d=new Date(iso+'T00:00'); return ['Nedelja','Ponedeljak','Utorak','Sreda','Četvrtak','Petak','Subota'][d.getDay()]; }
function minToTime(min){ const h=Math.floor(min/60), m=min%60; return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'); }
function timeToMin(t){ if(!t) return 0; const [h,m]=String(t).split(':').map(Number); return (h||0)*60+(m||0); }
function addMonths(key,delta){ let [y,m]=key.split('-').map(Number); m+=delta; while(m<1){m+=12;y--} while(m>12){m-=12;y++} return `${y}-${String(m).padStart(2,'0')}`; }

/* =========================================================================
   STORAGE LAYER
   - LocalDB: localStorage (uz fallback na memoriju) — DEMO režim
   - RemoteDB: Google Apps Script Web App
   Jedinstveni API: DB.bootstrap / list / create / update / remove / bulkSet
   ========================================================================= */
const SHEETS = ['Vozila','Klijenti','Usluge','Normativi','Magacin','MagacinTx','Nalozi','Radnici','Troskovi','Prihodi','Reklamacije','Subote','Bonusi','Korisnici','Podesavanja'];

const mem = {}; // memorijski fallback ako localStorage ne radi (npr. u preview-u)
const LS = {
  get(k){ try{ return localStorage.getItem(k); }catch(e){ return mem[k]??null; } },
  set(k,v){ try{ localStorage.setItem(k,v); }catch(e){ mem[k]=v; } }
};

const LocalDB = {
  _key:'bcw_data_v1',
  _load(){ try{ return JSON.parse(LS.get(this._key))||null; }catch(e){ return null; } },
  _save(d){ LS.set(this._key, JSON.stringify(d)); },
  ensure(){ let d=this._load(); if(!d){ d=seedDemo(); this._save(d); } return d; },
  async bootstrap(){ return structuredClone(this.ensure()); },
  async list(sheet){ return structuredClone(this.ensure()[sheet]||[]); },
  async create(sheet,data){ const d=this.ensure(); d[sheet]=d[sheet]||[]; d[sheet].push(data); this._save(d); return data; },
  async update(sheet,id,data){ const d=this.ensure(); const arr=d[sheet]||[]; const idk=sheet==='Podesavanja'?'kljuc':'id';
    const i=arr.findIndex(r=>String(r[idk])===String(id)); if(i<0) arr.push(data); else arr[i]={...arr[i],...data}; this._save(d); return data; },
  async remove(sheet,id){ const d=this.ensure(); const idk=sheet==='Podesavanja'?'kljuc':'id'; d[sheet]=(d[sheet]||[]).filter(r=>String(r[idk])!==String(id)); this._save(d); return {deleted:id}; },
  async bulkSet(sheet,rows){ const d=this.ensure(); d[sheet]=rows; this._save(d); return {count:rows.length}; }
};

function RemoteDB(url){
  async function call(payload){
    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(payload) });
    const json = await res.json();
    if(!json.ok) throw new Error(json.error||'Greška API-ja');
    return json.data;
  }
  return {
    _call:call,
    async bootstrap(){ return call({action:'bootstrap'}); },
    async list(sheet){ return call({action:'list',sheet}); },
    async create(sheet,data){ return call({action:'create',sheet,data}); },
    async update(sheet,id,data){ return call({action:'update',sheet,id,data}); },
    async remove(sheet,id){ return call({action:'delete',sheet,id}); },
    async bulkSet(sheet,rows){ return call({action:'bulkSet',sheet,rows}); },
    async login(korisnicko_ime,lozinka){ return call({action:'login',korisnicko_ime,lozinka}); },
    async createUser(data,lozinka){ return call({action:'createUser',data,lozinka}); },
    async updateUser(id,data){ return call({action:'updateUser',id,data}); },
    async resetPassword(id,lozinka){ return call({action:'resetPassword',id,lozinka}); }
  };
}

/* Globalno stanje aplikacije */
const State = {
  db:null, remote:false, role:'admin', view:'dashboard', month:monthKey(todayISO()),
  data:{}, charts:{}, user:null
};

/* ----------------------------- ULOGE I DOZVOLE -----------------------------*/
const OPER_MODULI = ['dashboard','kalendar','nalozi','vozila','klijenti','usluge','magacin','reklamacije','subote'];
const ROLES = {
  admin:    { label:'Administrator',     moduli:'*',                                  pisanje:true,  admin:true },
  korisnik: { label:'Korisnik',          moduli:OPER_MODULI,                          pisanje:true,  admin:false },
  viewer:   { label:'Pregled (viewer)',  moduli:OPER_MODULI.concat(['troskovi','prihodi','izvestaji']), pisanje:false, admin:false }
};
const ROLE_OPTS = [['admin','Administrator — sve'],['korisnik','Korisnik — operativa'],['viewer','Pregled — samo čitanje']];

const Auth = {
  async sha256(str){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  },
  genSalt(){ let s=''; const c='abcdefghijklmnopqrstuvwxyz0123456789'; for(let i=0;i<12;i++) s+=c[Math.floor(Math.random()*c.length)]; return s; },
  restore(){
    try{ const raw=sessionStorage.getItem('bcw_session'); if(raw){ State.user=JSON.parse(raw); return true; } }catch(e){}
    return false;
  },
  persist(u){ State.user=u; try{ sessionStorage.setItem('bcw_session', JSON.stringify(u)); }catch(e){} },
  logout(){ State.user=null; try{ sessionStorage.removeItem('bcw_session'); }catch(e){} },

  async login(korisnicko_ime, lozinka){
    if(State.remote){
      const u = await State.db.login(korisnicko_ime, lozinka); // backend proverava heš
      this.persist(u); return u;
    }
    // demo režim: provera lokalno
    const row = all('Korisnici').find(r=>String(r.korisnicko_ime).toLowerCase()===String(korisnicko_ime).toLowerCase());
    if(!row) throw new Error('Pogrešno korisničko ime ili lozinka.');
    if(String(row.aktivan)==='ne') throw new Error('Nalog je deaktiviran.');
    const h = await this.sha256(row.salt + ':' + lozinka);
    if(h !== String(row.lozinka_hash)) throw new Error('Pogrešno korisničko ime ili lozinka.');
    const u = {id:row.id, korisnicko_ime:row.korisnicko_ime, ime:row.ime, uloga:row.uloga};
    this.persist(u); return u;
  },
  async createUser(data, lozinka){
    if(State.remote){ const u=await State.db.createUser(data, lozinka); State.data.Korisnici.push({...data, aktivan:data.aktivan||'da'}); reindex(); return u; }
    if(all('Korisnici').some(r=>String(r.korisnicko_ime).toLowerCase()===String(data.korisnicko_ime).toLowerCase())) throw new Error('Korisničko ime već postoji.');
    const salt=this.genSalt(); const lozinka_hash=await this.sha256(salt+':'+lozinka);
    await dbCreate('Korisnici', {...data, lozinka_hash, salt, aktivan:data.aktivan||'da'});
    return data;
  },
  async updateUser(id, data){
    if(State.remote){ await State.db.updateUser(id, data); const i=State.data.Korisnici.findIndex(r=>r.id===id); if(i>=0) State.data.Korisnici[i]={...State.data.Korisnici[i],...data}; reindex(); return; }
    const cur=get('Korisnici',id)||{};
    await dbUpdate('Korisnici', id, {...cur, ...data}); // čuva hash/salt iz cur
  },
  async resetPassword(id, lozinka){
    if(State.remote){ await State.db.resetPassword(id, lozinka); return; }
    const cur=get('Korisnici',id); const salt=this.genSalt(); const lozinka_hash=await this.sha256(salt+':'+lozinka);
    await dbUpdate('Korisnici', id, {...cur, salt, lozinka_hash});
  },

  can(perm){ const r=ROLES[State.user?.uloga]||ROLES.viewer; return perm==='admin'?!!r.admin: perm==='write'?!!r.pisanje: false; },
  allowsModule(id){ const r=ROLES[State.user?.uloga]; if(!r) return false; return r.moduli==='*' || r.moduli.includes(id); }
};

/* Indeksi za brze lookup-e */
function reindex(){
  State.idx = {};
  for(const s of SHEETS){
    State.idx[s] = Object.fromEntries((State.data[s]||[]).map(r=>[String(r.id??r.kljuc), r]));
  }
  // podešavanja kao mapa
  State.settings = {...DEFAULT_SETTINGS};
  (State.data.Podesavanja||[]).forEach(r=> State.settings[r.kljuc]=r.vrednost);
  State.settings.apiUrl = LS.get('bcw_api')||''; // apiUrl uvek lokalno
}
const get = (sheet,id)=> State.idx[sheet]?.[String(id)] || null;
const all = sheet => State.data[sheet]||[];

/* Imena za reference */
function labelOf(sheet,id){
  const r=get(sheet,id); if(!r) return '—';
  if(sheet==='Klijenti') return r.naziv;
  if(sheet==='Radnici')  return r.ime;
  if(sheet==='Usluge')   return r.naziv;
  if(sheet==='Magacin')  return r.naziv;
  if(sheet==='Vozila')   return [r.tablice,r.marka,r.model].filter(Boolean).join(' ');
  return r.naziv||r.id;
}

/* ----------------------------- DB OMOTAČ -----------------------------------*/
async function loadAll(){
  State.data = await State.db.bootstrap();
  // osiguraj da svi tabovi postoje
  for(const s of SHEETS) State.data[s]=State.data[s]||[];
  reindex();
}
async function dbCreate(sheet,data){ await State.db.create(sheet,data); State.data[sheet].push(data); reindex(); }
async function dbUpdate(sheet,id,data){
  await State.db.update(sheet,id,data);
  const idk=sheet==='Podesavanja'?'kljuc':'id';
  const arr=State.data[sheet]; const i=arr.findIndex(r=>String(r[idk])===String(id));
  if(i<0) arr.push(data); else arr[i]={...arr[i],...data}; reindex();
}
async function dbRemove(sheet,id){
  await State.db.remove(sheet,id);
  const idk=sheet==='Podesavanja'?'kljuc':'id';
  State.data[sheet]=State.data[sheet].filter(r=>String(r[idk])!==String(id)); reindex();
}
async function saveSetting(k,v){ State.settings[k]=v; await dbUpdate('Podesavanja',k,{kljuc:k,vrednost:v}); }

/* ============================================================================
   INICIJALIZACIJA
   ========================================================================== */
window.addEventListener('DOMContentLoaded', init);

async function init(){
  bindChrome();
  $('#monthPick').value = State.month;

  const apiUrl = LS.get('bcw_api');
  if(apiUrl){ State.db = RemoteDB(apiUrl); State.remote=true; }
  else { State.db = LocalDB; State.remote=false; }

  try{
    await loadAll();
    setConn(State.remote);
  }catch(e){
    toast('Veza sa serverom nije uspela — prelazim u demo režim. ('+e.message+')','err');
    State.db=LocalDB; State.remote=false; await loadAll(); setConn(false);
  }

  // Autentifikacija: ako postoji aktivna sesija nastavi, inače prikaži prijavu
  if(Auth.restore()) startApp();
  else showLogin();
}

function showLogin(){
  document.body.dataset.auth='out';
  const hint = State.remote ? '' : `<p class="login-hint">Demo nalog: <b>admin</b> / <b>admin123</b></p>`;
  $('#authRoot').innerHTML = `
    <div class="login-card">
      <div class="login-brand">
        <div class="brand-mark"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13"/><path d="M3 13h18v4a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg></div>
        <div><strong>Balkan Car Wash</strong><span>Prijava na sistem</span></div>
      </div>
      <label class="login-field"><span>Korisničko ime</span><input id="loginUser" autocomplete="username" autofocus></label>
      <label class="login-field"><span>Lozinka</span><input id="loginPass" type="password" autocomplete="current-password"></label>
      <div id="loginErr" class="login-err" hidden></div>
      <button class="btn primary login-btn" id="loginBtn">Prijavi se</button>
      <div class="login-conn"><span class="conn-badge ${State.remote?'online':''}"><i></i>${State.remote?'Povezano (Sheets)':'Demo režim'}</span></div>
      ${hint}
    </div>`;
  const submit = async ()=>{
    const u=$('#loginUser').value.trim(), p=$('#loginPass').value;
    const err=$('#loginErr');
    if(!u||!p){ err.hidden=false; err.textContent='Unesi korisničko ime i lozinku.'; return; }
    $('#loginBtn').disabled=true; $('#loginBtn').textContent='Prijavljujem…';
    try{ await Auth.login(u,p); startApp(); }
    catch(e){ err.hidden=false; err.textContent=e.message||'Prijava nije uspela.'; $('#loginBtn').disabled=false; $('#loginBtn').textContent='Prijavi se'; }
  };
  $('#loginBtn').onclick=submit;
  $('#authRoot').querySelectorAll('input').forEach(i=>i.addEventListener('keydown',e=>{ if(e.key==='Enter') submit(); }));
}

function startApp(){
  document.body.dataset.auth='in';
  $('#authRoot').innerHTML='';
  const r=ROLES[State.user.uloga]||ROLES.viewer;
  document.body.dataset.role=State.user.uloga;
  document.body.dataset.permAdmin = r.admin?'1':'0';
  document.body.dataset.permWrite = r.pisanje?'1':'0';
  buildNav();
  renderUserMenu();
  // prvi dozvoljeni modul
  const first = Auth.allowsModule(State.view)? State.view : 'dashboard';
  route(Auth.allowsModule(first)?first:'kalendar');
}

function renderUserMenu(){
  const box=$('#userMenu'); if(!box) return;
  const u=State.user, r=ROLES[u.uloga]||{};
  box.innerHTML = `
    <div class="um-info"><span class="um-name">${esc(u.ime||u.korisnicko_ime)}</span><span class="um-role">${esc(r.label||u.uloga)}</span></div>
    <button class="icon-btn" id="logoutBtn" title="Odjava" aria-label="Odjava">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
    </button>`;
  $('#logoutBtn').onclick=()=>confirmAction('Odjaviti se sa sistema?',()=>{ Auth.logout(); document.body.dataset.auth='out'; showLogin(); });
}

// Sakrij akcije izmene za uloge bez prava pisanja (viewer)
function applyPerms(){
  if(Auth.can('write')) return;
  const sel='#ordAdd,#uslAdd,#magAdd,#magTx,#entAdd,[data-edit],[data-tx],[data-norm],[data-go],[data-approve],[data-s],.add-norm .btn';
  $$(sel).forEach(b=>{ b.style.display='none'; });
}

function setConn(online){
  const b=$('#connBadge');
  b.classList.toggle('online',online);
  $('.conn-label',b).textContent = online ? 'Povezano (Sheets)' : 'Demo režim';
}

/* ----------------------------- NAVIGACIJA ----------------------------------*/
const NAV = [
  {group:'Pregled'},
  {id:'dashboard', label:'Dashboard', icon:'grid'},
  {id:'kalendar',  label:'Kalendar / planer', icon:'calendar'},
  {id:'nalozi',    label:'Radni nalozi', icon:'clipboard'},
  {group:'Evidencija'},
  {id:'vozila',    label:'Vozila', icon:'car'},
  {id:'klijenti',  label:'Klijenti', icon:'users'},
  {id:'usluge',    label:'Usluge i cenovnik', icon:'tag'},
  {id:'magacin',   label:'Magacin / hemija', icon:'box'},
  {group:'Finansije', adminOnly:true},
  {id:'troskovi',  label:'Troškovi', icon:'down', adminOnly:true},
  {id:'prihodi',   label:'Prihodi', icon:'up', adminOnly:true},
  {id:'izvestaji', label:'Izveštaji', icon:'chart', adminOnly:true},
  {group:'Tim'},
  {id:'radnici',   label:'Radnici', icon:'badge', adminOnly:true},
  {id:'subote',    label:'Subote / smene', icon:'clock'},
  {id:'reklamacije',label:'Reklamacije', icon:'alert'},
  {group:'Sistem', adminOnly:true},
  {id:'korisnici', label:'Korisnici i prava', icon:'key', adminOnly:true},
  {id:'podesavanja',label:'Podešavanja', icon:'gear', adminOnly:true}
];

const ICONS = {
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  calendar:'<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  clipboard:'<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 12h6M9 16h4"/>',
  car:'<path d="M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13"/><path d="M3 13h18v4h-2.5M3 17h3"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-3.5-5.5"/>',
  tag:'<path d="M3 11l8-8 9 9-8 8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  box:'<path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"/>',
  down:'<path d="M12 4v14M6 12l6 6 6-6"/>',
  up:'<path d="M12 20V6M6 12l6-6 6 6"/>',
  chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  badge:'<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="9" r="2.5"/><path d="M8 17a4 4 0 0 1 8 0"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert:'<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  key:'<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2"/>'
};
const svgIco = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]||''}</svg>`;

function buildNav(){
  const nav=$('#nav'); nav.innerHTML='';
  let pendingGroup=null;
  NAV.forEach(item=>{
    if(item.group){ pendingGroup=item; return; }
    if(!Auth.allowsModule(item.id)) return;            // sakrij module van uloge
    if(pendingGroup){                                  // ispiši grupu tek kad ima vidljivu stavku
      const g=document.createElement('div'); g.className='nav-group'; g.textContent=pendingGroup.group;
      nav.appendChild(g); pendingGroup=null;
    }
    const b=document.createElement('button');
    b.dataset.nav=item.id;
    b.innerHTML = svgIco(item.icon)+`<span>${item.label}</span><span class="nav-badge" data-badge="${item.id}" hidden></span>`;
    b.onclick=()=>{ route(item.id); document.body.classList.remove('nav-open'); };
    nav.appendChild(b);
  });
}

function bindChrome(){
  $('#burger').onclick=()=>document.body.classList.toggle('nav-open');
  $('#scrim').onclick=()=>document.body.classList.remove('nav-open');
  $('#monthPick').onchange=e=>{ State.month=e.target.value; route(State.view); };
  // modal close
  $$('#modalRoot [data-close]').forEach(el=> el.onclick=closeModal);
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeModal(); });
}

/* ----------------------------- RUTER ---------------------------------------*/
const TITLES = Object.fromEntries(NAV.filter(n=>n.id).map(n=>[n.id,n.label]));
function route(view){
  if(State.user && !Auth.allowsModule(view)) view='dashboard';
  if(State.user && !Auth.allowsModule(view)) view=ROLES[State.user.uloga].moduli[0];
  State.view=view; document.body.dataset.view=view;
  $$('#nav button').forEach(b=>b.classList.toggle('is-active',b.dataset.nav===view));
  $('#viewTitle').textContent = TITLES[view]||'';
  $('#viewSub').textContent = subFor(view);
  destroyCharts();
  const c=$('#content'); c.innerHTML=''; c.scrollTop=0;
  (RENDER[view]||(()=>c.innerHTML='<div class="empty">Modul u pripremi.</div>'))(c);
  updateBadges();
  applyPerms();
}
function subFor(view){
  const [y,m]=State.month.split('-');
  const mese=['januar','februar','mart','april','maj','jun','jul','avgust','septembar','oktobar','novembar','decembar'][+m-1];
  if(['dashboard','izvestaji','troskovi','prihodi'].includes(view)) return `${mese} ${y}.`;
  if(view==='kalendar') return 'Dnevni i nedeljni raspored • Gantt';
  return '';
}
function updateBadges(){
  const rekl=all('Reklamacije').filter(r=>['otvoreno','u_resavanju'].includes(r.status)).length;
  const low=all('Magacin').filter(r=>num(r.stanje)<num(r.min_stanje)).length;
  setBadge('reklamacije',rekl); setBadge('magacin',low);
}
function setBadge(id,n){ const el=$(`[data-badge="${id}"]`); if(!el)return; el.hidden=!n; el.textContent=n; }

/* RENDER mapa se popunjava u app dalje (app.js nastavlja u istom fajlu ispod) */
const RENDER = {};

/* ============================================================================
   UI UTILITIES — toast, modal, potvrda, form builder
   ========================================================================== */
function toast(msg,kind='ok'){
  const w=$('#toastWrap'); const t=document.createElement('div');
  t.className='toast '+kind; t.textContent=msg; w.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateY(8px)'; setTimeout(()=>t.remove(),250); },2800);
}
function openModal(title,bodyHTML,footHTML,wide){
  $('#modalTitle').textContent=title;
  $('#modalBody').innerHTML=bodyHTML;
  $('#modalFoot').innerHTML=footHTML||'';
  $('.modal').classList.toggle('wide',!!wide);
  $('#modalRoot').hidden=false;
  applyPerms();
}
function closeModal(){ $('#modalRoot').hidden=true; }
function confirmAction(msg,onYes){
  openModal('Potvrda', `<p style="margin:4px 0 2px">${esc(msg)}</p>`,
    `<button class="btn ghost" data-x>Otkaži</button><button class="btn danger" data-y>Potvrdi</button>`);
  $('#modalFoot [data-x]').onclick=closeModal;
  $('#modalFoot [data-y]').onclick=async()=>{ closeModal(); await onYes(); };
}

/* Render polja forme iz definicije */
function fieldHTML(f,val){
  const v = val ?? f.def ?? '';
  const id='f_'+f.k;
  let input;
  if(f.t==='select'){
    input=`<select id="${id}">${(f.opts||[]).map(o=>{const[ov,ol]=Array.isArray(o)?o:[o,o];return `<option value="${esc(ov)}" ${String(ov)===String(v)?'selected':''}>${esc(ol)}</option>`;}).join('')}</select>`;
  } else if(f.t==='ref'){
    const rows=all(f.ref).filter(f.reffilter||(()=>true));
    input=`<select id="${id}"><option value="">— izaberi —</option>${rows.map(r=>`<option value="${esc(r.id)}" ${String(r.id)===String(v)?'selected':''}>${esc(labelOf(f.ref,r.id))}</option>`).join('')}</select>`;
  } else if(f.t==='textarea'){
    input=`<textarea id="${id}" placeholder="${esc(f.ph||'')}">${esc(v)}</textarea>`;
  } else if(f.t==='checkbox'){
    input=`<select id="${id}"><option value="da" ${v==='da'?'selected':''}>Da</option><option value="ne" ${v!=='da'?'selected':''}>Ne</option></select>`;
  } else {
    const type=f.t||'text';
    input=`<input id="${id}" type="${type}" value="${esc(v)}" placeholder="${esc(f.ph||'')}" ${f.step?`step="${f.step}"`:''}>`;
  }
  return `<div class="field ${f.full?'full':''}"><label for="${id}">${esc(f.l)}${f.req?' *':''}</label>${input}${f.hint?`<span class="hint">${esc(f.hint)}</span>`:''}</div>`;
}
function readForm(fields){
  const o={};
  fields.forEach(f=>{ const el=$('#f_'+f.k); if(!el) return; o[f.k]= (f.t==='number')? num(el.value) : el.value; });
  return o;
}

/* ============================================================================
   GENERIČKI CRUD MODUL (config-driven)
   Pokriva: Vozila, Klijenti, Magacin, Troškovi, Prihodi, Radnici, Subote, Reklamacije
   ========================================================================== */
const ENTITIES = {
  Vozila:{ sheet:'Vozila', title:'Vozila', add:'Dodaj vozilo',
    fields:[
      {k:'tablice',l:'Tablice',req:true,table:1},
      {k:'marka',l:'Marka',table:1},{k:'model',l:'Model',table:1},
      {k:'tip',l:'Tip vozila',t:'select',opts:TIPOVI_VOZILA,table:1,chip:1},
      {k:'klijent_id',l:'Klijent',t:'ref',ref:'Klijenti',table:1},
      {k:'telefon',l:'Telefon'},
      {k:'napomena',l:'Napomena',t:'textarea',full:1}
    ], filterField:'tip', filterOpts:TIPOVI_VOZILA },
  Klijenti:{ sheet:'Klijenti', title:'Klijenti', add:'Dodaj klijenta',
    fields:[
      {k:'naziv',l:'Naziv / ime',req:true,table:1},
      {k:'tip',l:'Tip',t:'select',opts:TIPOVI_KLIJENT,table:1,chip:1},
      {k:'telefon',l:'Telefon',table:1},{k:'email',l:'Email',table:1},
      {k:'napomena',l:'Napomena',t:'textarea',full:1}
    ], filterField:'tip', filterOpts:TIPOVI_KLIJENT },
  Troskovi:{ sheet:'Troskovi', title:'Troškovi', add:'Dodaj trošak', adminOnly:1,
    fields:[
      {k:'datum',l:'Datum',t:'date',def:todayISO(),req:1,table:1},
      {k:'kategorija',l:'Kategorija',t:'select',opts:KAT_TROSAK.map(k=>[k,KAT_TROSAK_L[k]]),table:1,tag:1},
      {k:'opis',l:'Opis',table:1},
      {k:'iznos',l:'Iznos (RSD)',t:'number',table:1,money:1,req:1},
      {k:'napomena',l:'Napomena',t:'textarea',full:1}
    ], filterField:'kategorija', filterOpts:KAT_TROSAK.map(k=>[k,KAT_TROSAK_L[k]]), month:1, total:'iznos' },
  Prihodi:{ sheet:'Prihodi', title:'Prihodi (ručni unos)', add:'Dodaj prihod', adminOnly:1,
    fields:[
      {k:'datum',l:'Datum',t:'date',def:todayISO(),req:1,table:1},
      {k:'tip',l:'Tip',t:'select',opts:[['spoljni','Spoljni klijent'],['pravno','Pravno lice'],['interno','Interna vrednost'],['ostalo','Ostalo']],table:1,tag:1},
      {k:'opis',l:'Opis',table:1},
      {k:'iznos',l:'Iznos (RSD)',t:'number',table:1,money:1,req:1},
      {k:'interna',l:'Interna vrednost?',t:'checkbox',def:'ne',hint:'Da = ne ulazi u naplaćeni novac'},
      {k:'napomena',l:'Napomena',t:'textarea',full:1}
    ], month:1, total:'iznos' },
  Radnici:{ sheet:'Radnici', title:'Radnici', add:'Dodaj radnika', adminOnly:1,
    fields:[
      {k:'ime',l:'Ime',req:1,table:1},
      {k:'uloga',l:'Uloga',t:'select',opts:[['detailing','Detailing/poliranje'],['pranje','Pranje/flota'],['oba','Oba']],table:1,tag:1},
      {k:'telefon',l:'Telefon',table:1},
      {k:'aktivan',l:'Aktivan',t:'checkbox',def:'da',table:1},
      {k:'napomena',l:'Napomena',t:'textarea',full:1}
    ]},
  Subote:{ sheet:'Subote', title:'Subote / smene', add:'Dodaj smenu',
    fields:[
      {k:'datum',l:'Datum',t:'date',def:todayISO(),req:1,table:1},
      {k:'radnik_id',l:'Radnik',t:'ref',ref:'Radnici',req:1,table:1},
      {k:'tip_posla',l:'Tip posla',t:'select',opts:[['kombiji','Kombiji'],['pranje','Pranje'],['detailing','Detailing'],['mesano','Mešano']],table:1,tag:1},
      {k:'sati',l:'Sati',t:'number',def:4,table:1,num:1},
      {k:'dodatak',l:'Dodatak (RSD)',t:'number',table:1,money:1},
      {k:'napomena',l:'Napomena',t:'textarea',full:1}
    ], month:1 },
  Reklamacije:{ sheet:'Reklamacije', title:'Reklamacije', add:'Nova reklamacija',
    fields:[
      {k:'datum',l:'Datum',t:'date',def:todayISO(),req:1,table:1},
      {k:'vozilo_id',l:'Vozilo',t:'ref',ref:'Vozila',table:1},
      {k:'klijent_id',l:'Klijent',t:'ref',ref:'Klijenti'},
      {k:'tip',l:'Tip reklamacije',t:'select',opts:[['kvalitet','Kvalitet pranja'],['ostecenje','Oštećenje'],['kasnjenje','Kašnjenje'],['ostalo','Ostalo']],table:1,tag:1},
      {k:'radnik_id',l:'Radnik',t:'ref',ref:'Radnici',table:1},
      {k:'opis',l:'Opis',t:'textarea',full:1},
      {k:'resenje',l:'Rešenje',t:'textarea',full:1},
      {k:'trosak',l:'Trošak reklamacije (RSD)',t:'number',money:1},
      {k:'status',l:'Status',t:'select',opts:[['otvoreno','Otvoreno'],['u_resavanju','U rešavanju'],['reseno','Rešeno'],['odbijeno','Odbijeno']],def:'otvoreno',table:1,statusrekl:1}
    ], filterField:'status', filterOpts:[['otvoreno','Otvoreno'],['u_resavanju','U rešavanju'],['reseno','Rešeno'],['odbijeno','Odbijeno']] }
};

let _entityState={}; // pretraga/filter po modulu
function renderEntity(el,name){
  const cfg=ENTITIES[name]; _entityState[name]=_entityState[name]||{q:'',f:''};
  const st=_entityState[name];
  const toolbar=`
    <div class="toolbar">
      <div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
        <input placeholder="Pretraga…" value="${esc(st.q)}" id="entSearch"></div>
      ${cfg.filterField?`<select class="filter" id="entFilter"><option value="">Svi</option>${cfg.filterOpts.map(([v,l])=>`<option value="${v}" ${st.f===v?'selected':''}>${l}</option>`).join('')}</select>`:''}
      <div class="spacer" style="flex:1"></div>
      <button class="btn" id="entPdf">PDF</button>
      <button class="btn primary" id="entAdd">${svgIco('grid').replace('grid','')}<svg viewBox="0 0 24 24" width="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>${cfg.add}</button>
    </div>`;
  el.innerHTML = toolbar + `<div id="entTable"></div>`;
  const draw=()=>{ $('#entTable').innerHTML=entityTable(name); bindEntityRows(name); };
  $('#entSearch').oninput=e=>{ st.q=e.target.value; draw(); };
  if($('#entFilter')) $('#entFilter').onchange=e=>{ st.f=e.target.value; draw(); };
  $('#entAdd').onclick=()=>entityForm(name);
  $('#entPdf').onclick=()=>exportEntityPDF(name);
  draw();
}
function entityRows(name){
  const cfg=ENTITIES[name]; const st=_entityState[name]; let rows=all(cfg.sheet).slice();
  if(cfg.month) rows=rows.filter(r=>monthKey(r.datum)===State.month);
  if(st.f) rows=rows.filter(r=>String(r[cfg.filterField])===st.f);
  if(st.q){ const q=st.q.toLowerCase(); rows=rows.filter(r=>JSON.stringify(Object.fromEntries(cfg.fields.map(f=>[f.k, f.t==='ref'?labelOf(f.ref,r[f.k]):r[f.k]]))).toLowerCase().includes(q)); }
  rows.sort((a,b)=> String(b.datum||b.id).localeCompare(String(a.datum||a.id)));
  return rows;
}
function cellValue(f,r){
  let v=r[f.k];
  if(f.t==='ref') return esc(labelOf(f.ref,v));
  if(f.t==='date') return fmtDate(v);
  if(f.money) return `<span class="num tnum">${money(v)}</span>`;
  if(f.num) return `<span class="num tnum">${esc(v)}</span>`;
  if(f.chip){ const map=Object.fromEntries((f.opts||[])); return `<span class="tag gray">${esc(map[v]||v)}</span>`; }
  if(f.tag){ const map=Object.fromEntries((f.opts||[])); return `<span class="tag">${esc(map[v]||v)}</span>`; }
  if(f.statusrekl){ const cls={otvoreno:'reklamacija',u_resavanju:'u_radu',reseno:'spremno',odbijeno:'otkazano'}[v]||'zakazano'; const lbl={otvoreno:'Otvoreno',u_resavanju:'U rešavanju',reseno:'Rešeno',odbijeno:'Odbijeno'}[v]||v; return `<span class="chip ${cls}">${lbl}</span>`; }
  return esc(v??'');
}
function entityTable(name){
  const cfg=ENTITIES[name]; const cols=cfg.fields.filter(f=>f.table);
  const rows=entityRows(name);
  let totalRow='';
  if(cfg.total){ const sum=rows.reduce((s,r)=>s+num(r[cfg.total]),0);
    totalRow=`<tr style="font-weight:700;background:var(--surface-2)"><td colspan="${cols.length}">Ukupno (${rows.length})</td><td class="num tnum">${money(sum)}</td><td></td></tr>`; }
  if(!rows.length) return `<div class="table-wrap"><div class="empty">${svgIco('box')}<div>Nema podataka za prikaz.</div></div></div>`;
  return `<div class="table-wrap"><table><thead><tr>${cols.map(c=>`<th>${esc(c.l)}</th>`).join('')}<th></th></tr></thead><tbody>
    ${rows.map(r=>`<tr>${cols.map(c=>`<td>${cellValue(c,r)}</td>`).join('')}
      <td><div class="row-actions">
        <button class="btn sm ghost" data-edit="${r.id}">Izmeni</button>
        <button class="btn sm ghost danger" data-del="${r.id}" data-admin-only>Obriši</button>
      </div></td></tr>`).join('')}
    ${cfg.total?`<tr style="font-weight:700;background:var(--surface-2)"><td colspan="${cols.length}">Ukupno (${rows.length})</td>${cfg.total===cols[cols.length-1].k?'':''}<td class="num tnum">${money(rows.reduce((s,r)=>s+num(r[cfg.total]),0))}</td><td></td></tr>`:''}
  </tbody></table></div>`;
}
function bindEntityRows(name){
  $$('#entTable [data-edit]').forEach(b=> b.onclick=()=>entityForm(name,b.dataset.edit));
  $$('#entTable [data-del]').forEach(b=> b.onclick=()=>confirmAction('Obrisati ovaj zapis?',async()=>{ await dbRemove(ENTITIES[name].sheet,b.dataset.del); toast('Obrisano'); route(State.view); }));
}
function entityForm(name,id){
  const cfg=ENTITIES[name]; const rec= id? get(cfg.sheet,id):{};
  const body=`<div class="form-grid">${cfg.fields.map(f=>fieldHTML(f, rec[f.k])).join('')}</div>`;
  openModal(id?('Izmena — '+cfg.title):cfg.add, body,
    `<button class="btn ghost" data-x>Otkaži</button><button class="btn primary" data-s>Sačuvaj</button>`);
  $('#modalFoot [data-x]').onclick=closeModal;
  $('#modalFoot [data-s]').onclick=async()=>{
    const o=readForm(cfg.fields);
    const miss=cfg.fields.filter(f=>f.req && !String(o[f.k]).trim());
    if(miss.length){ toast('Popuni: '+miss.map(f=>f.l).join(', '),'err'); return; }
    if(id) o.id=id; else o.id=uid(name[0]);
    if(id) await dbUpdate(cfg.sheet,id,o); else await dbCreate(cfg.sheet,o);
    closeModal(); toast('Sačuvano'); route(State.view);
  };
}

/* registracija generičkih modula u ruter */
['Vozila','Klijenti','Troskovi','Prihodi','Radnici','Subote','Reklamacije'].forEach(n=>{
  RENDER[n.toLowerCase()] = el => renderEntity(el,n);
});

/* ============================================================================
   DEMO PODACI (seed za demo režim)
   ========================================================================== */
function seedDemo(){
  const d={}; SHEETS.forEach(s=>d[s]=[]);
  d.Korisnici=[
    {id:'usr_admin',korisnicko_ime:'admin',ime:'Administrator',uloga:'admin',
     lozinka_hash:'5f41d5cec659390178ffca1f0fdd3ca90dceb3b33e539d5325d0e0b1a564cafe',salt:'bcw7sa1',aktivan:'da',napomena:'Demo nalog — promeni lozinku'}
  ];
  d.Podesavanja = Object.entries(DEFAULT_SETTINGS).filter(([k])=>k!=='apiUrl').map(([k,v])=>({kljuc:k,vrednost:v}));
  d.Radnici=[
    {id:'rad1',ime:'Miloš (Detailing)',uloga:'detailing',telefon:'064/111-222',aktivan:'da',napomena:'Dubinsko/poliranje'},
    {id:'rad2',ime:'Stefan (Pranje/Flota)',uloga:'pranje',telefon:'064/333-444',aktivan:'da',napomena:'Pranje/flota/kombiji'}
  ];
  d.Usluge=[
    {id:'u1',naziv:'Obično pranje',kategorija:'pranje',cena:1200,valuta:'RSD',trajanje:30,aktivna:'da',napomena:''},
    {id:'u2',naziv:'Premium pranje',kategorija:'pranje',cena:2000,valuta:'RSD',trajanje:60,aktivna:'da',napomena:''},
    {id:'u3',naziv:'Kombi osnovno',kategorija:'flota',cena:1000,valuta:'RSD',trajanje:25,aktivna:'da',napomena:''},
    {id:'u4',naziv:'Auto za prodaju A',kategorija:'prodaja',cena:9000,valuta:'RSD',trajanje:180,aktivna:'da',napomena:''},
    {id:'u5',naziv:'Auto za prodaju B',kategorija:'prodaja',cena:13500,valuta:'RSD',trajanje:270,aktivna:'da',napomena:''},
    {id:'u6',naziv:'Auto za prodaju C',kategorija:'prodaja',cena:20000,valuta:'RSD',trajanje:480,aktivna:'da',napomena:''},
    {id:'u7',naziv:'Retail dubinsko + poliranje',kategorija:'detailing',cena:165,valuta:'EUR',trajanje:420,aktivna:'da',napomena:''},
    {id:'u8',naziv:'Plac/B2B priprema',kategorija:'detailing',cena:120,valuta:'EUR',trajanje:240,aktivna:'da',napomena:''}
  ];
  d.Magacin=[
    {id:'a1',naziv:'Šampon za pranje',kategorija:'hemija',jm:'ml',stanje:5000,min_stanje:1000,nabavna_cena:0.8,dobavljac:'',napomena:''},
    {id:'a2',naziv:'APC univerzalni',kategorija:'hemija',jm:'ml',stanje:5000,min_stanje:1000,nabavna_cena:0.6,dobavljac:'',napomena:''},
    {id:'a3',naziv:'Sredstvo za felne',kategorija:'hemija',jm:'ml',stanje:600,min_stanje:800,nabavna_cena:1.2,dobavljac:'',napomena:''},
    {id:'a4',naziv:'Dubinsko sredstvo',kategorija:'hemija',jm:'ml',stanje:2000,min_stanje:500,nabavna_cena:2.0,dobavljac:'',napomena:''},
    {id:'a5',naziv:'Pasta za poliranje',kategorija:'hemija',jm:'g',stanje:2000,min_stanje:400,nabavna_cena:3.5,dobavljac:'',napomena:''},
    {id:'a6',naziv:'Mikrofiber krpe',kategorija:'potrosno',jm:'kom',stanje:200,min_stanje:40,nabavna_cena:150,dobavljac:'',napomena:''}
  ];
  const N=(u,a,k)=>({id:uid('n'),usluga_id:u,artikal_id:a,kolicina:k});
  d.Normativi=[
    N('u1','a1',50),N('u1','a2',20),N('u1','a3',30),N('u1','a6',3),
    N('u2','a1',80),N('u2','a2',50),N('u2','a3',50),N('u2','a6',5),
    N('u3','a1',40),N('u3','a2',20),N('u3','a3',20),N('u3','a6',2),
    N('u5','a1',100),N('u5','a2',150),N('u5','a3',80),N('u5','a4',100),N('u5','a5',50),N('u5','a6',8),
    N('u7','a1',150),N('u7','a2',200),N('u7','a3',100),N('u7','a4',150),N('u7','a5',80),N('u7','a6',10)
  ];
  d.Klijenti=[
    {id:'k1',naziv:'Auto plac (interno)',tip:'interni',telefon:'',email:'',napomena:''},
    {id:'k2',naziv:'Rent flota (interno)',tip:'interni',telefon:'',email:'',napomena:''},
    {id:'k3',naziv:'Marko Petrović',tip:'spoljni',telefon:'063/123-456',email:'',napomena:''},
    {id:'k4',naziv:'Logistika DOO',tip:'pravno',telefon:'011/222-333',email:'office@logistika.rs',napomena:''}
  ];
  d.Vozila=[
    {id:'v1',tablice:'BG-123-AB',marka:'Audi',model:'A4',tip:'prodaja',klijent_id:'k1',telefon:'',napomena:'Za oglas'},
    {id:'v2',tablice:'BG-555-CC',marka:'VW',model:'Golf 7',tip:'rent',klijent_id:'k2',telefon:'',napomena:''},
    {id:'v3',tablice:'BG-777-DD',marka:'Renault',model:'Master',tip:'kombi',klijent_id:'k2',telefon:'',napomena:''},
    {id:'v4',tablice:'NS-010-XY',marka:'BMW',model:'320',tip:'spoljni',klijent_id:'k3',telefon:'063/123-456',napomena:''},
    {id:'v5',tablice:'BG-900-ZZ',marka:'Škoda',model:'Octavia',tip:'sluzbeno',klijent_id:'k1',telefon:'',napomena:''}
  ];
  // par naloga u tekućem mesecu
  const t=todayISO();
  const mk=(id,vreme,vo,us,ra,st,tr,ce,pl)=>({id,datum:t,vreme,vozilo_id:vo,tablice:get_seed(d,'Vozila',vo).tablice,marka:get_seed(d,'Vozila',vo).marka,model:get_seed(d,'Vozila',vo).model,klijent_id:get_seed(d,'Vozila',vo).klijent_id,usluga_id:us,radnik_id:ra,trajanje:tr,cena:ce,placanje:pl,status:st,napomena:'',reklamacija:'',potroseno:CONSUME_STATUSI.includes(st)?'da':'',kreiran:t,zavrsen:CONSUME_STATUSI.includes(st)?t:''});
  d.Nalozi=[
    mk('no1','08:00','v4','u2','rad2','preuzeto',60,2000,'gotovina'),
    mk('no2','09:00','v3','u3','rad2','spremno',25,1000,'interno'),
    mk('no3','08:30','v1','u5','rad1','u_radu',270,13500,'interno'),
    mk('no4','11:00','v2','u1','rad2','zakazano',30,1200,'interno'),
    mk('no5','13:00','v5','u1','rad2','zavrseno',30,1200,'interno')
  ];
  d.Troskovi=[
    {id:'t1',datum:t,kategorija:'hemija',opis:'Nabavka šampona',iznos:18000,napomena:''},
    {id:'t2',datum:t,kategorija:'struja',opis:'Struja',iznos:9000,napomena:''},
    {id:'t3',datum:t,kategorija:'plate',opis:'Akontacija',iznos:80000,napomena:''}
  ];
  return d;
}
function get_seed(d,sheet,id){ return (d[sheet]||[]).find(r=>r.id===id)||{}; }

/* ============================================================================
   FINANSIJE / BONUS / GRAFIKONI / PDF — zajednički proračuni
   ========================================================================== */
function vehicleTip(o){
  const v=get('Vozila',o.vozilo_id);
  if(v&&v.tip) return v.tip;
  const k=get('Klijenti',o.klijent_id);
  if(k){ if(k.tip==='pravno') return 'pravno'; if(k.tip==='spoljni') return 'spoljni'; }
  return 'spoljni';
}
function isExternal(o){ return EKSTERNI_TIPOVI.includes(vehicleTip(o)); }
function monthOrders(month, onlyDone=true){
  return all('Nalozi').filter(o=>monthKey(o.datum)===month && (!onlyDone || CONSUME_STATUSI.includes(o.status)));
}
function computeFinance(month){
  const done=monthOrders(month,true);
  let eksterni=0, interni=0;
  const perWorker={}, perService={};
  all('Radnici').forEach(r=>perWorker[r.id]={value:0,count:0});
  done.forEach(o=>{
    const c=num(o.cena);
    if(isExternal(o)) eksterni+=c; else interni+=c;
    if(perWorker[o.radnik_id]){ perWorker[o.radnik_id].value+=c; perWorker[o.radnik_id].count++; }
    perService[o.usluga_id]=perService[o.usluga_id]||{count:0,value:0};
    perService[o.usluga_id].count++; perService[o.usluga_id].value+=c;
  });
  all('Prihodi').filter(p=>monthKey(p.datum)===month).forEach(p=>{
    if(p.interna==='da') interni+=num(p.iznos); else eksterni+=num(p.iznos);
  });
  const rashodi=all('Troskovi').filter(t=>monthKey(t.datum)===month).reduce((s,t)=>s+num(t.iznos),0);
  const ukupna=eksterni+interni;
  const zeljeni=num(State.settings.zeljeni_profit);
  return {
    eksterni, interni, ukupna, rashodi,
    rezultat: eksterni-rashodi,
    doNule: Math.max(0, rashodi-eksterni),
    doCilja: Math.max(0, rashodi+zeljeni-eksterni),
    perWorker, perService,
    brojPranja: done.length,
    reklamacije: all('Reklamacije').filter(r=>monthKey(r.datum)===month).length
  };
}
function chemUsage(month){
  // planirano: normativ × broj puta usluga izvršena; po artiklu
  const done=monthOrders(month,true);
  const plan={}, real={};
  all('Magacin').forEach(a=>{plan[a.id]=0;real[a.id]=0;});
  done.forEach(o=>{
    all('Normativi').filter(n=>String(n.usluga_id)===String(o.usluga_id)).forEach(n=>{ plan[n.artikal_id]=(plan[n.artikal_id]||0)+num(n.kolicina); });
  });
  all('MagacinTx').filter(t=>monthKey(t.datum)===month && (t.tip==='izlaz'||t.tip==='otpis'||t.tip==='popis')).forEach(t=>{ real[t.artikal_id]=(real[t.artikal_id]||0)+Math.abs(num(t.kolicina)); });
  return {plan, real};
}
function computeBonus(month){
  const f=computeFinance(month);
  const prag=num(State.settings.bonus_prag), pct=num(State.settings.bonus_procenat)/100;
  const fond = f.ukupna>=prag ? Math.round(f.ukupna*pct) : 0;
  const out=[];
  const totalValue=Object.values(f.perWorker).reduce((s,w)=>s+w.value,0)||1;
  all('Radnici').forEach(r=>{
    const w=f.perWorker[r.id]||{value:0,count:0};
    const share=w.value/totalValue;
    const rekl=all('Reklamacije').filter(x=>monthKey(x.datum)===month && String(x.radnik_id)===String(r.id)).length;
    const subDod=all('Subote').filter(x=>monthKey(x.datum)===month && String(x.radnik_id)===String(r.id)).reduce((s,x)=>s+num(x.dodatak),0);
    const predlog=Math.max(0, Math.round(fond*share - rekl*2000 + subDod));
    out.push({radnik:r, value:w.value, count:w.count, share, rekl, subDod, predlog});
  });
  return {fond, prag, met:f.ukupna>=prag, ukupna:f.ukupna, redovi:out};
}

/* ---- Chart.js helper ---- */
function destroyCharts(){ Object.values(State.charts).forEach(c=>{try{c.destroy()}catch(e){}}); State.charts={}; }
function makeChart(id,cfg){
  const cv=document.getElementById(id); if(!cv||!window.Chart) return;
  cfg.options=Object.assign({responsive:true,maintainAspectRatio:false,
    plugins:{legend:{labels:{font:{family:'Inter'},boxWidth:12,padding:14}}},
    scales:cfg.type==='doughnut'?undefined:{y:{beginAtZero:true,grid:{color:'#EEF2F3'},ticks:{font:{family:'Inter'}}},x:{grid:{display:false},ticks:{font:{family:'Inter'}}}}
  }, cfg.options||{});
  State.charts[id]=new Chart(cv.getContext('2d'),cfg);
}
const PALETTE=['#0F766E','#15A8A0','#2563EB','#9333EA','#D97706','#16A34A','#DC2626','#64748B'];

/* ---- PDF helper (jsPDF + html2canvas) ---- */
function pdfStyles(){
  return `<style>
    *{font-family:Inter,Arial,sans-serif;color:#16282F;box-sizing:border-box}
    .doc{width:760px;padding:30px;background:#fff}
    .doc h1{font-size:21px;margin:0 0 2px} .doc .sub{color:#7C8C92;font-size:12px;margin:0 0 18px}
    .doc .brandbar{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #0F766E;padding-bottom:12px;margin-bottom:18px}
    .doc .logo{font-weight:800;font-size:18px;color:#0F766E}
    .doc table{width:100%;border-collapse:collapse;font-size:12px;margin:10px 0}
    .doc th{background:#F4F7F8;text-align:left;padding:8px 10px;border-bottom:2px solid #E6ECEE;font-size:11px;text-transform:uppercase;color:#7C8C92}
    .doc td{padding:8px 10px;border-bottom:1px solid #EEF2F3}
    .doc .kv{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin:6px 0 14px}
    .doc .kv div{font-size:13px} .doc .kv b{color:#4A5C63;font-weight:600}
    .doc .big{font-size:24px;font-weight:800;color:#0F766E}
    .doc .foot{margin-top:24px;font-size:11px;color:#7C8C92;border-top:1px solid #EEF2F3;padding-top:10px}
    .doc .num{text-align:right} .doc .tot{font-weight:700;background:#F4F7F8}
  </style>`;
}
function docHTML(title,sub,inner){
  return `${pdfStyles()}<div class="doc"><div class="brandbar"><div><div class="logo">BALKAN CAR WASH</div></div>
    <div style="text-align:right;font-size:11px;color:#7C8C92">Štampano: ${fmtDate(todayISO())}</div></div>
    <h1>${esc(title)}</h1><p class="sub">${esc(sub||'')}</p>${inner}
    <div class="foot">Balkan Car Wash — interni dokument • Generisano iz aplikacije.</div></div>`;
}
async function renderPDF(filename,html){
  toast('Generišem PDF…');
  const wrap=document.createElement('div');
  wrap.style.cssText='position:fixed;left:-9999px;top:0;width:760px;background:#fff;z-index:-1';
  wrap.innerHTML=html; document.body.appendChild(wrap);
  try{
    const canvas=await html2canvas(wrap.querySelector('.doc'),{scale:2,backgroundColor:'#fff'});
    const {jsPDF}=window.jspdf; const pdf=new jsPDF('p','mm','a4');
    const pw=210, ph=297, iw=pw, ih=canvas.height*pw/canvas.width;
    let left=ih, pos=0;
    pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,pos,iw,ih);
    left-=ph;
    while(left>0){ pos=left-ih; pdf.addPage(); pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,pos,iw,ih); left-=ph; }
    pdf.save(filename);
  }catch(e){ toast('PDF greška: '+e.message,'err'); }
  finally{ wrap.remove(); }
}

/* ============================================================================
   DASHBOARD
   ========================================================================== */
RENDER.dashboard = el =>{
  const f=computeFinance(State.month);
  const low=all('Magacin').filter(a=>num(a.stanje)<num(a.min_stanje));
  const today=todayISO();
  const danas=all('Nalozi').filter(o=>o.datum===today);
  const uRadu=all('Nalozi').filter(o=>['u_radu','ceka_susenje','ceka_kontrolu'].includes(o.status));
  const spremno=all('Nalozi').filter(o=>o.status==='spremno');

  let html='';
  if(low.length) html+=`<div class="banner warn">${svgIco('alert')}<div><b>${low.length} artikala ispod minimuma.</b> ${low.map(a=>esc(a.naziv)).join(', ')} — vreme za nabavku.</div></div>`;

  // KPI — finansije (admin) ili operativa (radnik)
  html+=`<div class="cards">`;
  if(State.role==='admin'){
    const target=num(State.settings.mesecni_fiksni_trosak);
    html+=kpi('Naplaćeno spolja','up',money(f.eksterni),'realni priliv', f.eksterni, Math.max(target,f.eksterni));
    html+=kpi('Interna vrednost','grid',money(f.interni),'flota + vozila za prodaju');
    html+=kpi('Ukupna vrednost rada','chart',money(f.ukupna),`${f.brojPranja} završenih`);
    html+=kpi('Rashodi (mesec)','down',money(f.rashodi),'evidentirani troškovi');
    const rez=f.rezultat;
    html+=`<div class="card kpi ${rez>=0?'good':'bad'}"><div class="k-label"><span class="k-ico">${svgIco(rez>=0?'up':'down')}</span>Rezultat (cash)</div><div class="k-val ${rez>=0?'delta-up':'delta-down'}">${money(rez)}</div><div class="k-sub">spolja − rashodi</div></div>`;
    html+=kpi('Do nule','clock',money(f.doNule), f.doNule?'fali za pokriće':'pokriveno ✓', f.doNule? f.eksterni:1, f.doNule? f.rashodi:1);
    html+=kpi('Do cilja profita','tag',money(f.doCilja),`cilj +${money(State.settings.zeljeni_profit)}`);
  }else{
    html+=kpi('Naloga danas','calendar',danas.length,fmtDate(today));
    html+=kpi('U radu','clock',uRadu.length,'aktivni nalozi');
    html+=kpi('Spremno za preuzimanje','box',spremno.length,'čeka klijenta');
    html+=kpi('Završenih (mesec)','chart',f.brojPranja,'ukupno pranja');
  }
  html+=`</div>`;

  // Grafikoni
  html+=`<div class="grid" style="margin-top:16px"><div class="cols-3">
    <div class="panel"><div class="panel-head"><h3>Pranja po usluzi</h3></div><div class="panel-body"><div class="chart-box sm"><canvas id="chSvc"></canvas></div></div></div>
    <div class="panel" data-admin-only><div class="panel-head"><h3>Interno vs eksterno</h3></div><div class="panel-body"><div class="chart-box sm"><canvas id="chIE"></canvas></div></div></div>
    <div class="panel"><div class="panel-head"><h3>Učinak po radniku</h3></div><div class="panel-body"><div class="chart-box sm"><canvas id="chWrk"></canvas></div></div></div>
  </div></div>`;

  // Donji red: bonus + spremno za oglas
  html+=`<div class="cols-2" style="margin-top:16px">`;
  html+=`<div class="panel" data-admin-only><div class="panel-head"><h3>Predlog bonus fonda</h3><div class="spacer"></div><button class="btn sm" id="goBonus">Detaljno</button></div><div class="panel-body" id="bonusMini"></div></div>`;
  html+=`<div class="panel"><div class="panel-head"><h3>Vozila spremna za oglas</h3></div><div class="panel-body" id="oglasBox"></div></div>`;
  html+=`</div>`;

  el.innerHTML=html;

  // charts
  const svc=Object.entries(f.perService).map(([id,v])=>[labelOf('Usluge',id),v.count]).sort((a,b)=>b[1]-a[1]);
  makeChart('chSvc',{type:'bar',data:{labels:svc.map(s=>s[0]),datasets:[{data:svc.map(s=>s[1]),backgroundColor:'#15A8A0',borderRadius:6}]},options:{plugins:{legend:{display:false}}}});
  if($('#chIE')) makeChart('chIE',{type:'doughnut',data:{labels:['Eksterno (cash)','Interna vrednost'],datasets:[{data:[f.eksterni,f.interni],backgroundColor:['#0F766E','#9CC9C4'],borderWidth:0}]},options:{cutout:'62%'}});
  const wr=all('Radnici');
  makeChart('chWrk',{type:'bar',data:{labels:wr.map(r=>r.ime.split(' ')[0]),datasets:[{label:'Vrednost',data:wr.map(r=>f.perWorker[r.id]?.value||0),backgroundColor:'#0F766E',borderRadius:6}]},options:{plugins:{legend:{display:false}}}});

  // bonus mini
  if($('#bonusMini')){
    const b=computeBonus(State.month);
    $('#bonusMini').innerHTML = `<div class="stat-line"><span>Status praga (${money(b.prag)})</span><b>${b.met?'<span class="delta-up">Dostignut ✓</span>':'<span class="muted">Nije dostignut</span>'}</b></div>
      <div class="stat-line"><span>Predloženi fond</span><b class="tnum">${money(b.fond)}</b></div>
      ${b.redovi.map(r=>`<div class="stat-line"><span>${esc(r.radnik.ime)}</span><b class="tnum">${money(r.predlog)}</b></div>`).join('')}`;
    $('#goBonus').onclick=()=>route('izvestaji');
  }
  // spremno za oglas
  const prodaja=all('Vozila').filter(v=>v.tip==='prodaja');
  const oglas=prodaja.map(v=>{ const ords=all('Nalozi').filter(o=>o.vozilo_id===v.id); const last=ords.sort((a,b)=>String(b.datum+b.vreme).localeCompare(a.datum+a.vreme))[0]; return {v,last}; })
    .filter(x=>x.last && ['spremno','preuzeto','zavrseno'].includes(x.last.status));
  $('#oglasBox').innerHTML = oglas.length? oglas.map(x=>`<div class="stat-line"><span><b>${esc(x.v.tablice)}</b> · ${esc(x.v.marka)} ${esc(x.v.model)}</span><span class="chip ${x.last.status}">${STATUS_LABEL[x.last.status]}</span></div>`).join('')
    : `<div class="muted" style="padding:8px 0">Trenutno nema vozila za prodaju u statusu spreman.</div>`;
};
function kpi(label,ico,val,sub,cur,max){
  let bar=''; if(cur!=null&&max){ const pct=Math.min(100,Math.round(cur/max*100)); bar=`<div class="k-bar"><i style="width:${pct}%"></i></div>`; }
  return `<div class="card kpi"><div class="k-label"><span class="k-ico">${svgIco(ico)}</span>${label}</div><div class="k-val tnum">${val}</div><div class="k-sub">${sub||''}</div>${bar}</div>`;
}

/* ============================================================================
   KALENDAR / GANTT PLANER
   ========================================================================== */
let _cal={mode:'dan', date:todayISO()};
RENDER.kalendar = el =>{
  el.innerHTML=`
    <div class="toolbar">
      <div class="seg" id="calMode">
        <button data-m="dan" class="${_cal.mode==='dan'?'is-active':''}">Dan</button>
        <button data-m="nedelja" class="${_cal.mode==='nedelja'?'is-active':''}">Nedelja</button>
      </div>
      <div class="flex">
        <button class="btn sm" id="calPrev">‹</button>
        <input type="date" id="calDate" value="${_cal.date}" style="border:1px solid var(--line);border-radius:9px;padding:7px 10px;font:inherit">
        <button class="btn sm" id="calNext">›</button>
        <button class="btn sm" id="calToday">Danas</button>
      </div>
      <div class="spacer" style="flex:1"></div>
      <button class="btn" id="calPdf">PDF raspored</button>
      <button class="btn primary" id="calAdd">+ Termin</button>
    </div>
    <div id="calBody"></div>`;
  $$('#calMode button').forEach(b=>b.onclick=()=>{ _cal.mode=b.dataset.m; route('kalendar'); });
  $('#calDate').onchange=e=>{ _cal.date=e.target.value; drawCal(); };
  $('#calPrev').onclick=()=>{ _cal.date=shiftDate(_cal.date, _cal.mode==='dan'?-1:-7); $('#calDate').value=_cal.date; drawCal(); };
  $('#calNext').onclick=()=>{ _cal.date=shiftDate(_cal.date, _cal.mode==='dan'?1:7); $('#calDate').value=_cal.date; drawCal(); };
  $('#calToday').onclick=()=>{ _cal.date=todayISO(); $('#calDate').value=_cal.date; drawCal(); };
  $('#calAdd').onclick=()=>orderForm(null,_cal.date);
  $('#calPdf').onclick=()=>exportSchedulePDF(_cal.date);
  drawCal();
};
function shiftDate(iso,days){ const d=new Date(iso+'T00:00'); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); }
function drawCal(){ $('#calBody').innerHTML = _cal.mode==='dan'? ganttDay(_cal.date) : weekView(_cal.date); if(_cal.mode==='dan') bindGantt(); else bindWeek(); }

function ganttDay(date){
  const start=timeToMin(State.settings.radno_pocetak||'08:00');
  const end=timeToMin(State.settings.radno_kraj||'16:00');
  const span=Math.max(60,end-start);
  const hours=[]; for(let m=start;m<=end;m+=60) hours.push(m);
  const radnici=all('Radnici').filter(r=>r.aktivan!=='ne');
  const capMin=num(State.settings.sati_po_radniku||8)*60;
  const dayOrders=all('Nalozi').filter(o=>o.datum===date && o.status!=='otkazano');

  let lanes='';
  radnici.forEach(r=>{
    const mine=dayOrders.filter(o=>String(o.radnik_id)===String(r.id));
    const used=mine.reduce((s,o)=>s+num(o.trajanje),0);
    const pct=Math.min(100,Math.round(used/capMin*100));
    const free=Math.max(0,capMin-used);
    const blocks=mine.map(o=>{
      const s=timeToMin(o.vreme||State.settings.radno_pocetak);
      const left=Math.max(0,(s-start)/span*100);
      const w=Math.max(4, num(o.trajanje)/span*100);
      const col=statusColor(o.status);
      return `<div class="job" style="left:${left}%;width:${w}%;color:${col};background:${col}14" data-order="${o.id}" title="${esc(labelOf('Usluge',o.usluga_id))}">
        <b style="color:var(--ink)">${esc(o.tablice||labelOf('Vozila',o.vozilo_id))}</b>
        <span>${esc(labelOf('Usluge',o.usluga_id))} · ${o.vreme||''}</span></div>`;
    }).join('');
    lanes+=`<div class="gantt-lane" style="grid-template-columns:170px 1fr">
      <div class="lane-label"><span class="w-name">${esc(r.ime)}</span>
        <span class="cap">${(used/60).toFixed(1)}h / ${(capMin/60)}h · slobodno ${(free/60).toFixed(1)}h</span>
        <div class="cap-bar ${used>capMin?'over':''}"><i style="width:${pct}%"></i></div></div>
      <div class="lane-track">${blocks||''}</div></div>`;
  });
  return `<div class="gantt">
    <div class="gantt-head"><h3 style="font-size:14px">${dayName(date)}, ${fmtDate(date)}</h3>
      <div class="spacer" style="flex:1"></div>
      <div class="legend">${STATUSI.filter(s=>!['otkazano','reklamacija'].includes(s[0])).slice(0,7).map(s=>`<span><i style="background:${statusColor(s[0])}"></i>${s[1]}</span>`).join('')}</div></div>
    <div class="gantt-scroll"><div class="gantt-grid">
      <div class="gantt-hours" style="grid-template-columns:170px repeat(${hours.length},1fr)">
        <div class="lane-label" style="background:var(--surface-2)"><span class="cap">Radnik / sat</span></div>
        ${hours.map(h=>`<div class="hour">${minToTime(h)}</div>`).join('')}</div>
      ${lanes||'<div class="empty" style="padding:30px">Nema termina za ovaj dan.</div>'}
    </div></div></div>`;
}
function statusColor(s){ const v=getComputedStyle(document.documentElement).getPropertyValue('--s-'+({zakazano:'zakazano',stiglo:'stiglo',u_radu:'rad',ceka_susenje:'susenje',ceka_kontrolu:'kontrola',zavrseno:'zavrseno',spremno:'spremno',preuzeto:'preuzeto',reklamacija:'reklam',otkazano:'otkaz'}[s]||'zakazano')); return (v||'#0F766E').trim(); }
function bindGantt(){ $$('#calBody .job').forEach(j=> j.onclick=()=>orderDetail(j.dataset.order)); }

function weekView(date){
  const d=new Date(date+'T00:00'); const dow=(d.getDay()+6)%7; // ponedeljak=0
  const mon=new Date(d); mon.setDate(d.getDate()-dow);
  const days=[]; for(let i=0;i<7;i++){ const x=new Date(mon); x.setDate(mon.getDate()+i); days.push(x.toISOString().slice(0,10)); }
  const capMin=num(State.settings.sati_po_radniku||8)*60*all('Radnici').filter(r=>r.aktivan!=='ne').length;
  return `<div class="cols-2" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${days.map(dd=>{
    const ords=all('Nalozi').filter(o=>o.datum===dd&&o.status!=='otkazano').sort((a,b)=>(a.vreme||'').localeCompare(b.vreme||''));
    const used=ords.reduce((s,o)=>s+num(o.trajanje),0);
    return `<div class="panel"><div class="panel-head"><h3>${dayName(dd)} · ${fmtDate(dd)}</h3><div class="spacer"></div><span class="tag gray">${(used/60).toFixed(1)}h</span></div>
      <div class="panel-body" style="padding:8px 10px">${ords.length?ords.map(o=>`<div class="stat-line" style="cursor:pointer" data-order="${o.id}"><span><b>${o.vreme||''}</b> ${esc(o.tablice||'')} · ${esc(labelOf('Usluge',o.usluga_id))}</span><span class="chip ${o.status}">${STATUS_LABEL[o.status]}</span></div>`).join(''):'<div class="muted" style="padding:10px">—</div>'}</div></div>`;
  }).join('')}</div>`;
}
function bindWeek(){ $$('#calBody [data-order]').forEach(j=> j.onclick=()=>orderDetail(j.dataset.order)); }

/* ============================================================================
   RADNI NALOZI
   ========================================================================== */
let _ordState={q:'',f:''};
RENDER.nalozi = el =>{
  el.innerHTML=`
    <div class="toolbar">
      <div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg><input id="ordSearch" placeholder="Pretraga (tablice, klijent…)" value="${esc(_ordState.q)}"></div>
      <select class="filter" id="ordFilter"><option value="">Svi statusi</option>${STATUSI.map(([v,l])=>`<option value="${v}" ${_ordState.f===v?'selected':''}>${l}</option>`).join('')}</select>
      <div class="spacer" style="flex:1"></div>
      <button class="btn primary" id="ordAdd">+ Nalog</button>
    </div><div id="ordTable"></div>`;
  $('#ordSearch').oninput=e=>{_ordState.q=e.target.value;drawOrders();};
  $('#ordFilter').onchange=e=>{_ordState.f=e.target.value;drawOrders();};
  $('#ordAdd').onclick=()=>orderForm();
  drawOrders();
};
function drawOrders(){
  let rows=all('Nalozi').filter(o=>monthKey(o.datum)===State.month);
  if(_ordState.f) rows=rows.filter(o=>o.status===_ordState.f);
  if(_ordState.q){const q=_ordState.q.toLowerCase(); rows=rows.filter(o=>`${o.tablice} ${labelOf('Vozila',o.vozilo_id)} ${labelOf('Klijenti',o.klijent_id)} ${labelOf('Usluge',o.usluga_id)}`.toLowerCase().includes(q));}
  rows.sort((a,b)=>String(b.datum+(b.vreme||'')).localeCompare(a.datum+(a.vreme||'')));
  const t=$('#ordTable');
  if(!rows.length){ t.innerHTML=`<div class="table-wrap"><div class="empty">${svgIco('clipboard')}<div>Nema naloga za ovaj mesec.</div></div></div>`; return; }
  t.innerHTML=`<div class="table-wrap"><table><thead><tr>
    <th>Datum</th><th>Vreme</th><th>Vozilo</th><th>Usluga</th><th>Radnik</th><th class="num">Cena</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(o=>`<tr>
      <td class="tnum">${fmtDate(o.datum)}</td><td class="tnum">${esc(o.vreme||'')}</td>
      <td><b>${esc(o.tablice||'')}</b><div class="muted" style="font-size:11px">${esc(o.marka||'')} ${esc(o.model||'')}</div></td>
      <td>${esc(labelOf('Usluge',o.usluga_id))}</td>
      <td>${esc(labelOf('Radnici',o.radnik_id))}</td>
      <td class="num tnum">${money(o.cena)}</td>
      <td><span class="chip ${o.status}">${STATUS_LABEL[o.status]}</span></td>
      <td><div class="row-actions"><button class="btn sm ghost" data-detail="${o.id}">Otvori</button></div></td>
    </tr>`).join('')}</tbody></table></div>`;
  $$('#ordTable [data-detail]').forEach(b=>b.onclick=()=>orderDetail(b.dataset.detail));
}

const ORDER_FIELDS=[
  {k:'datum',l:'Datum',t:'date',req:1},{k:'vreme',l:'Vreme',t:'time',def:'08:00'},
  {k:'vozilo_id',l:'Vozilo',t:'ref',ref:'Vozila',req:1,full:1},
  {k:'usluga_id',l:'Usluga',t:'ref',ref:'Usluge',reffilter:r=>r.aktivna!=='ne',req:1},
  {k:'radnik_id',l:'Radnik',t:'ref',ref:'Radnici',req:1},
  {k:'trajanje',l:'Trajanje (min)',t:'number',def:30},{k:'cena',l:'Cena (RSD)',t:'number',def:0},
  {k:'placanje',l:'Plaćanje',t:'select',opts:PLACANJA,def:'interno'},
  {k:'status',l:'Status',t:'select',opts:STATUSI,def:'zakazano'},
  {k:'napomena',l:'Napomena',t:'textarea',full:1}
];
function orderForm(id,presetDate){
  const rec= id? {...get('Nalozi',id)} : {datum:presetDate||todayISO(),vreme:'08:00',status:'zakazano',placanje:'interno',trajanje:30,cena:0};
  openModal(id?'Izmena naloga':'Novi radni nalog', `<div class="form-grid">${ORDER_FIELDS.map(f=>fieldHTML(f,rec[f.k])).join('')}</div>`,
    `<button class="btn ghost" data-x>Otkaži</button><button class="btn primary" data-s>Sačuvaj</button>`,true);
  // autofill na promenu usluge / vozila
  const fillFromService=()=>{ const u=get('Usluge',$('#f_usluga_id').value); if(!u)return;
    $('#f_trajanje').value=u.trajanje; let c=num(u.cena); if(u.valuta==='EUR') c=Math.round(c*num(State.settings.kurs_eur)); $('#f_cena').value=c; };
  $('#f_usluga_id').onchange=fillFromService;
  $('#modalFoot [data-x]').onclick=closeModal;
  $('#modalFoot [data-s]').onclick=async()=>{
    const o=readForm(ORDER_FIELDS);
    if(!o.vozilo_id||!o.usluga_id||!o.radnik_id||!o.datum){ toast('Popuni vozilo, uslugu, radnika i datum','err'); return; }
    const v=get('Vozila',o.vozilo_id)||{};
    Object.assign(o,{tablice:v.tablice||'',marka:v.marka||'',model:v.model||'',klijent_id:v.klijent_id||''});
    if(id){ o.id=id; const prev=get('Nalozi',id); o.potroseno=prev.potroseno; o.kreiran=prev.kreiran;
      await dbUpdate('Nalozi',id,o); await syncConsumption({...prev,...o}); }
    else { o.id=uid('NO'); o.kreiran=todayISO(); o.potroseno=''; await dbCreate('Nalozi',o); await syncConsumption(o); }
    closeModal(); toast('Nalog sačuvan'); route(State.view);
  };
}

/* ============================================================================
   WORKFLOW NALOGA + AUTOMATSKO SKIDANJE MAGACINA
   ========================================================================== */
// koje akcije (sledeći status) su dostupne iz trenutnog statusa
const WORKFLOW = {
  zakazano:    [['stiglo','Vozilo stiglo','primary']],
  stiglo:      [['u_radu','Počni rad','primary']],
  u_radu:      [['ceka_susenje','Na sušenje','ghost'],['zavrseno','Završi','primary']],
  ceka_susenje:[['ceka_kontrolu','Na kontrolu','ghost'],['zavrseno','Završi','primary']],
  ceka_kontrolu:[['zavrseno','Završeno','primary']],
  zavrseno:    [['spremno','Spremno za preuzimanje','primary']],
  spremno:     [['preuzeto','Preuzeto','primary']],
  preuzeto:    [],
  reklamacija: [['u_radu','Vrati u rad','primary']],
  otkazano:    []
};

// Skida ili vraća normativ u zavisnosti od statusa. Idempotentno preko polja `potroseno`.
async function syncConsumption(order){
  const wasConsumed = order.potroseno==='da';
  const shouldConsume = CONSUME_STATUSI.includes(order.status);
  if(shouldConsume && !wasConsumed){
    const norm=all('Normativi').filter(n=>String(n.usluga_id)===String(order.usluga_id));
    for(const n of norm){
      const art=get('Magacin',n.artikal_id); if(!art) continue;
      const novo=num(art.stanje)-num(n.kolicina);
      await dbUpdate('Magacin',art.id,{...art,stanje:novo});
      await dbCreate('MagacinTx',{id:uid('TX'),datum:todayISO(),artikal_id:art.id,tip:'izlaz',
        kolicina:num(n.kolicina),nalog_id:order.id,napomena:'Automatski po nalogu '+order.id});
    }
    await dbUpdate('Nalozi',order.id,{...order,potroseno:'da'});
  } else if(!shouldConsume && wasConsumed){
    // reverzija (npr. nalog vraćen iz "završeno" u "u radu" ili otkazan)
    const txs=all('MagacinTx').filter(t=>String(t.nalog_id)===String(order.id) && t.tip==='izlaz');
    for(const t of txs){
      const art=get('Magacin',t.artikal_id);
      if(art) await dbUpdate('Magacin',art.id,{...art,stanje:num(art.stanje)+num(t.kolicina)});
      await dbRemove('MagacinTx',t.id);
    }
    await dbUpdate('Nalozi',order.id,{...order,potroseno:''});
  }
}

async function changeStatus(id,newStatus){
  const o=get('Nalozi',id); if(!o) return;
  const upd={...o,status:newStatus};
  if(CONSUME_STATUSI.includes(newStatus) && !o.zavrsen) upd.zavrsen=todayISO();
  await dbUpdate('Nalozi',id,upd);
  await syncConsumption(upd);
  toast('Status: '+STATUS_LABEL[newStatus]);
  orderDetail(id);
}

function orderDetail(id){
  const o=get('Nalozi',id); if(!o){ toast('Nalog ne postoji','err'); return; }
  const v=get('Vozila',o.vozilo_id)||{};
  const norm=all('Normativi').filter(n=>String(n.usluga_id)===String(o.usluga_id));
  const normHTML = norm.length? `<table class="mini"><thead><tr><th>Artikal</th><th class="num">Norma</th></tr></thead><tbody>
      ${norm.map(n=>`<tr><td>${esc(labelOf('Magacin',n.artikal_id))}</td><td class="num tnum">${esc(n.kolicina)} ${esc(get('Magacin',n.artikal_id)?.jm||'')}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nema definisanog normativa za ovu uslugu.</p>';
  const actions=(WORKFLOW[o.status]||[]).map(([st,lbl,cls])=>`<button class="btn ${cls}" data-go="${st}">${lbl}</button>`).join('');
  const body=`
    <div class="detail-head">
      <div><div class="plate">${esc(o.tablice||'—')}</div><div class="muted">${esc(o.marka||'')} ${esc(o.model||'')}</div></div>
      <span class="chip ${o.status}" style="font-size:13px">${STATUS_LABEL[o.status]}</span>
    </div>
    <div class="kv-grid">
      <div><span>Datum</span><b>${fmtDate(o.datum)} ${esc(o.vreme||'')}</b></div>
      <div><span>Usluga</span><b>${esc(labelOf('Usluge',o.usluga_id))}</b></div>
      <div><span>Radnik</span><b>${esc(labelOf('Radnici',o.radnik_id))}</b></div>
      <div><span>Trajanje</span><b>${esc(o.trajanje||0)} min</b></div>
      <div><span>Klijent</span><b>${esc(labelOf('Klijenti',o.klijent_id))}</b></div>
      <div><span>Plaćanje</span><b>${esc((PLACANJA.find(p=>p[0]===o.placanje)||['',''])[1])}</b></div>
      <div><span>Cena</span><b class="big-num">${money(o.cena)}</b></div>
      <div><span>Potrošeno</span><b>${o.potroseno==='da'?'Da — skinuto sa magacina':'Ne'}</b></div>
    </div>
    ${o.napomena?`<div class="note-box"><span>Napomena</span>${esc(o.napomena)}</div>`:''}
    <div class="sub-h">Normativ potrošnje</div>${normHTML}`;
  const foot=`
    <div class="wf-actions">${actions||'<span class="muted">Nalog je u finalnom statusu.</span>'}</div>
    <div class="spacer" style="flex:1"></div>
    <button class="btn ghost" data-pdf>PDF nalog</button>
    <button class="btn ghost" data-edit data-admin-only>Izmeni</button>
    <button class="btn ghost danger" data-del data-admin-only>Obriši</button>`;
  openModal('Radni nalog • '+esc(o.id.slice(-5)), body, foot, true);
  $$('#modalFoot [data-go]').forEach(b=>b.onclick=()=>changeStatus(id,b.dataset.go));
  $('#modalFoot [data-pdf]').onclick=()=>exportOrderPDF(id);
  const ed=$('#modalFoot [data-edit]'); if(ed) ed.onclick=()=>{ closeModal(); orderForm(id); };
  const dl=$('#modalFoot [data-del]'); if(dl) dl.onclick=()=>confirmAction('Obrisati nalog? Vraća skinuti magacin.',async()=>{
    if(o.potroseno==='da') await syncConsumption({...o,status:'otkazano'});
    await dbRemove('Nalozi',id); closeModal(); toast('Nalog obrisan'); route(State.view);
  });
}

/* ---- PDF: radni nalog ---- */
function exportOrderPDF(id){
  const o=get('Nalozi',id); if(!o) return;
  const norm=all('Normativi').filter(n=>String(n.usluga_id)===String(o.usluga_id));
  const inner=`
    <div class="kv">
      <div><b>Broj naloga:</b> ${esc(o.id)}</div><div><b>Datum:</b> ${fmtDate(o.datum)} ${esc(o.vreme||'')}</div>
      <div><b>Vozilo:</b> ${esc(o.tablice||'')} ${esc(o.marka||'')} ${esc(o.model||'')}</div><div><b>Klijent:</b> ${esc(labelOf('Klijenti',o.klijent_id))}</div>
      <div><b>Usluga:</b> ${esc(labelOf('Usluge',o.usluga_id))}</div><div><b>Radnik:</b> ${esc(labelOf('Radnici',o.radnik_id))}</div>
      <div><b>Status:</b> ${STATUS_LABEL[o.status]}</div><div><b>Plaćanje:</b> ${esc((PLACANJA.find(p=>p[0]===o.placanje)||['',''])[1])}</div>
    </div>
    <p class="big">${money(o.cena)}</p>
    <table><thead><tr><th>Normativ — artikal</th><th class="num">Količina</th></tr></thead><tbody>
      ${norm.length?norm.map(n=>`<tr><td>${esc(labelOf('Magacin',n.artikal_id))}</td><td class="num">${esc(n.kolicina)} ${esc(get('Magacin',n.artikal_id)?.jm||'')}</td></tr>`).join(''):'<tr><td colspan="2">—</td></tr>'}
    </tbody></table>
    ${o.napomena?`<p><b>Napomena:</b> ${esc(o.napomena)}</p>`:''}
    <div style="margin-top:40px;display:flex;justify-content:space-between">
      <div style="border-top:1px solid #ccc;padding-top:6px;width:200px;text-align:center;font-size:12px">Radnik</div>
      <div style="border-top:1px solid #ccc;padding-top:6px;width:200px;text-align:center;font-size:12px">Klijent / preuzimanje</div>
    </div>`;
  renderPDF(`Nalog-${o.tablice||o.id}.pdf`, docHTML('Radni nalog', fmtDate(o.datum)+' • '+esc(o.tablice||''), inner));
}

/* ---- PDF: dnevni raspored ---- */
function exportSchedulePDF(date){
  const ords=all('Nalozi').filter(o=>o.datum===date && o.status!=='otkazano').sort((a,b)=>(a.vreme||'').localeCompare(b.vreme||''));
  const rows=ords.map(o=>`<tr><td>${esc(o.vreme||'')}</td><td>${esc(o.tablice||'')} ${esc(o.marka||'')}</td><td>${esc(labelOf('Usluge',o.usluga_id))}</td><td>${esc(labelOf('Radnici',o.radnik_id))}</td><td>${esc(o.trajanje||0)} min</td><td>${STATUS_LABEL[o.status]}</td></tr>`).join('');
  const inner=`<table><thead><tr><th>Vreme</th><th>Vozilo</th><th>Usluga</th><th>Radnik</th><th class="num">Trajanje</th><th>Status</th></tr></thead>
    <tbody>${rows||'<tr><td colspan="6">Nema termina.</td></tr>'}</tbody></table>`;
  renderPDF(`Raspored-${date}.pdf`, docHTML('Dnevni raspored', dayName(date)+', '+fmtDate(date), inner));
}

/* ---- PDF: generička tabela entiteta ---- */
function exportEntityPDF(name){
  const cfg=ENTITIES[name]; const cols=cfg.fields.filter(f=>f.table); const rows=entityRows(name);
  const inner=`<table><thead><tr>${cols.map(c=>`<th>${esc(c.l)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(r=>`<tr>${cols.map(c=>`<td>${c.t==='ref'?esc(labelOf(c.ref,r[c.k])):(c.money?money(r[c.k]):esc(c.t==='date'?fmtDate(r[c.k]):(r[c.k]??'')))}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${cols.length}">Nema podataka.</td></tr>`}
  </tbody>${cfg.total?`<tfoot><tr class="tot"><td colspan="${cols.length-1}">Ukupno</td><td class="num">${money(rows.reduce((s,r)=>s+num(r[cfg.total]),0))}</td></tr></tfoot>`:''}</table>`;
  renderPDF(`${cfg.title}.pdf`, docHTML(cfg.title, cfg.month?subFor(name.toLowerCase()):'', inner));
}

/* ============================================================================
   USLUGE I CENOVNIK + EDITOR NORMATIVA
   ========================================================================== */
RENDER.usluge = el =>{
  el.innerHTML=`
    <div class="toolbar">
      <div class="muted">Cenovnik, trajanja i normativ potrošnje po usluzi.</div>
      <div class="spacer" style="flex:1"></div>
      <button class="btn" id="uslPdf">PDF cenovnik</button>
      <button class="btn primary" id="uslAdd" data-admin-only>+ Usluga</button>
    </div>
    <div class="table-wrap"><table><thead><tr>
      <th>Usluga</th><th>Kategorija</th><th class="num">Cena</th><th class="num">Trajanje</th><th>Normativ</th><th>Aktivna</th><th></th>
    </tr></thead><tbody id="uslBody"></tbody></table></div>`;
  $('#uslAdd').onclick=()=>uslugaForm();
  $('#uslPdf').onclick=()=>exportEntityPriceListPDF();
  drawUsluge();
};
function drawUsluge(){
  const rows=all('Usluge').slice().sort((a,b)=>String(a.kategorija).localeCompare(String(b.kategorija)));
  $('#uslBody').innerHTML = rows.map(u=>{
    const nc=all('Normativi').filter(n=>String(n.usluga_id)===String(u.id)).length;
    return `<tr>
      <td><b>${esc(u.naziv)}</b></td>
      <td><span class="tag gray">${esc(u.kategorija||'—')}</span></td>
      <td class="num tnum">${money(u.cena, u.valuta||'RSD')}</td>
      <td class="num tnum">${esc(u.trajanje||0)} min</td>
      <td><button class="btn sm ghost" data-norm="${u.id}">${nc?nc+' art.':'Dodaj'}</button></td>
      <td>${u.aktivna==='ne'?'<span class="tag gray">Ne</span>':'<span class="tag green">Da</span>'}</td>
      <td><div class="row-actions">
        <button class="btn sm ghost" data-edit="${u.id}" data-admin-only>Izmeni</button>
        <button class="btn sm ghost danger" data-del="${u.id}" data-admin-only>Obriši</button>
      </div></td></tr>`;
  }).join('') || `<tr><td colspan="7"><div class="empty">${svgIco('tag')}<div>Nema usluga.</div></div></td></tr>`;
  $$('#uslBody [data-edit]').forEach(b=>b.onclick=()=>uslugaForm(b.dataset.edit));
  $$('#uslBody [data-norm]').forEach(b=>b.onclick=()=>normativEditor(b.dataset.norm));
  $$('#uslBody [data-del]').forEach(b=>b.onclick=()=>confirmAction('Obrisati uslugu i njen normativ?',async()=>{
    for(const n of all('Normativi').filter(n=>String(n.usluga_id)===String(b.dataset.del))) await dbRemove('Normativi',n.id);
    await dbRemove('Usluge',b.dataset.del); toast('Obrisano'); route('usluge');
  }));
}
const USLUGA_FIELDS=[
  {k:'naziv',l:'Naziv usluge',req:1,full:1},
  {k:'kategorija',l:'Kategorija',t:'select',opts:[['pranje','Pranje'],['premium','Premium'],['kombi','Kombi'],['prodaja','Auto za prodaju'],['detailing','Detailing'],['b2b','Plac/B2B']]},
  {k:'cena',l:'Cena',t:'number',req:1},
  {k:'valuta',l:'Valuta',t:'select',opts:[['RSD','RSD'],['EUR','EUR']],def:'RSD'},
  {k:'trajanje',l:'Trajanje (min)',t:'number',def:30},
  {k:'aktivna',l:'Aktivna',t:'checkbox',def:'da'},
  {k:'napomena',l:'Napomena',t:'textarea',full:1}
];
function uslugaForm(id){
  const rec=id?get('Usluge',id):{aktivna:'da',valuta:'RSD',trajanje:30};
  openModal(id?'Izmena usluge':'Nova usluga', `<div class="form-grid">${USLUGA_FIELDS.map(f=>fieldHTML(f,rec[f.k])).join('')}</div>`,
    `<button class="btn ghost" data-x>Otkaži</button><button class="btn primary" data-s>Sačuvaj</button>`);
  $('#modalFoot [data-x]').onclick=closeModal;
  $('#modalFoot [data-s]').onclick=async()=>{
    const o=readForm(USLUGA_FIELDS);
    if(!o.naziv){ toast('Naziv je obavezan','err'); return; }
    if(id){ o.id=id; await dbUpdate('Usluge',id,o); } else { o.id=uid('US'); await dbCreate('Usluge',o); }
    closeModal(); toast('Sačuvano'); route('usluge');
  };
}
function normativEditor(uslugaId){
  const u=get('Usluge',uslugaId);
  const render=()=>{
    const norm=all('Normativi').filter(n=>String(n.usluga_id)===String(uslugaId));
    const artikli=all('Magacin');
    const body=`
      <p class="muted">Potrošnja po jednom izvršenju usluge — automatski se skida sa magacina kada nalog dobije status završeno/spremno/preuzeto.</p>
      <table class="mini"><thead><tr><th>Artikal</th><th class="num">Količina</th><th></th></tr></thead><tbody>
        ${norm.map(n=>`<tr><td>${esc(labelOf('Magacin',n.artikal_id))}</td><td class="num tnum">${esc(n.kolicina)} ${esc(get('Magacin',n.artikal_id)?.jm||'')}</td>
          <td><button class="btn sm ghost danger" data-rm="${n.id}">×</button></td></tr>`).join('')||'<tr><td colspan="3" class="muted">Nema stavki.</td></tr>'}
      </tbody></table>
      <div class="add-norm">
        <select id="nArt">${artikli.map(a=>`<option value="${a.id}">${esc(a.naziv)} (${esc(a.jm)})</option>`).join('')}</select>
        <input id="nKol" type="number" step="0.01" placeholder="Količina" style="max-width:120px">
        <button class="btn primary" id="nAdd">Dodaj</button>
      </div>`;
    openModal('Normativ — '+esc(u.naziv), body, `<button class="btn ghost" data-x>Zatvori</button>`, true);
    $('#modalFoot [data-x]').onclick=()=>{ closeModal(); route('usluge'); };
    $('#nAdd').onclick=async()=>{
      const art=$('#nArt').value, kol=num($('#nKol').value);
      if(!art||!kol){ toast('Izaberi artikal i količinu','err'); return; }
      await dbCreate('Normativi',{id:uid('NR'),usluga_id:uslugaId,artikal_id:art,kolicina:kol});
      render();
    };
    $$('#modalBody [data-rm]').forEach(b=>b.onclick=async()=>{ await dbRemove('Normativi',b.dataset.rm); render(); });
  };
  render();
}
function exportEntityPriceListPDF(){
  const rows=all('Usluge').filter(u=>u.aktivna!=='ne');
  const inner=`<table><thead><tr><th>Usluga</th><th>Kategorija</th><th class="num">Cena</th><th class="num">Trajanje</th></tr></thead><tbody>
    ${rows.map(u=>`<tr><td>${esc(u.naziv)}</td><td>${esc(u.kategorija||'')}</td><td class="num">${money(u.cena,u.valuta||'RSD')}</td><td class="num">${esc(u.trajanje||0)} min</td></tr>`).join('')}</tbody></table>`;
  renderPDF('Cenovnik.pdf', docHTML('Cenovnik usluga','Balkan Car Wash', inner));
}

/* ============================================================================
   MAGACIN / HEMIJA  (stanje, transakcije, popis)
   ========================================================================== */
let _magState={q:''};
RENDER.magacin = el =>{
  const low=all('Magacin').filter(a=>num(a.stanje)<num(a.min_stanje));
  el.innerHTML=`
    ${low.length?`<div class="banner warn">${svgIco('alert')}<div><b>${low.length}</b> ${low.length===1?'artikal je':'artikala je'} ispod minimalnog stanja: ${low.map(a=>esc(a.naziv)).join(', ')}.</div></div>`:''}
    <div class="toolbar">
      <div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg><input id="magSearch" placeholder="Pretraga artikala…" value="${esc(_magState.q)}"></div>
      <div class="spacer" style="flex:1"></div>
      <button class="btn" id="magPopis" data-admin-only>Mesečni popis</button>
      <button class="btn" id="magTx">Transakcija</button>
      <button class="btn primary" id="magAdd" data-admin-only>+ Artikal</button>
    </div>
    <div id="magTable"></div>
    <div class="sub-h">Poslednje transakcije</div><div id="magTx2"></div>`;
  $('#magSearch').oninput=e=>{_magState.q=e.target.value;drawMagacin();};
  $('#magAdd').onclick=()=>artikalForm();
  $('#magTx').onclick=()=>txForm();
  $('#magPopis').onclick=()=>popisForm();
  drawMagacin();
};
function drawMagacin(){
  let rows=all('Magacin').slice();
  if(_magState.q){const q=_magState.q.toLowerCase(); rows=rows.filter(a=>`${a.naziv} ${a.kategorija} ${a.dobavljac}`.toLowerCase().includes(q));}
  rows.sort((a,b)=>String(a.naziv).localeCompare(String(b.naziv)));
  $('#magTable').innerHTML = rows.length?`<div class="table-wrap"><table><thead><tr>
    <th>Artikal</th><th>Kategorija</th><th class="num">Stanje</th><th class="num">Min.</th><th class="num">Nab. cena</th><th>Dobavljač</th><th></th>
  </tr></thead><tbody>${rows.map(a=>{const lowc=num(a.stanje)<num(a.min_stanje);
    return `<tr class="${lowc?'row-low':''}">
      <td><b>${esc(a.naziv)}</b></td><td><span class="tag gray">${esc(a.kategorija||'—')}</span></td>
      <td class="num tnum">${esc(a.stanje||0)} ${esc(a.jm||'')} ${lowc?'<span class="dot-low" title="ispod minimuma"></span>':''}</td>
      <td class="num tnum">${esc(a.min_stanje||0)}</td>
      <td class="num tnum">${money(a.nabavna_cena)}</td>
      <td>${esc(a.dobavljac||'—')}</td>
      <td><div class="row-actions">
        <button class="btn sm ghost" data-tx="${a.id}">+/−</button>
        <button class="btn sm ghost" data-edit="${a.id}" data-admin-only>Izmeni</button>
        <button class="btn sm ghost danger" data-del="${a.id}" data-admin-only>Obriši</button>
      </div></td></tr>`;}).join('')}</tbody></table></div>`
    : `<div class="table-wrap"><div class="empty">${svgIco('box')}<div>Nema artikala.</div></div></div>`;
  $$('#magTable [data-edit]').forEach(b=>b.onclick=()=>artikalForm(b.dataset.edit));
  $$('#magTable [data-tx]').forEach(b=>b.onclick=()=>txForm(b.dataset.tx));
  $$('#magTable [data-del]').forEach(b=>b.onclick=()=>confirmAction('Obrisati artikal?',async()=>{ await dbRemove('Magacin',b.dataset.del); toast('Obrisano'); route('magacin'); }));
  const txs=all('MagacinTx').slice().sort((a,b)=>String(b.datum+b.id).localeCompare(a.datum+a.id)).slice(0,12);
  $('#magTx2').innerHTML = txs.length?`<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Artikal</th><th>Tip</th><th class="num">Količina</th><th>Napomena</th></tr></thead><tbody>
    ${txs.map(t=>`<tr><td class="tnum">${fmtDate(t.datum)}</td><td>${esc(labelOf('Magacin',t.artikal_id))}</td>
      <td><span class="tag ${({ulaz:'green',izlaz:'gray',otpis:'red',korekcija:'',popis:''})[t.tip]||''}">${esc(t.tip)}</span></td>
      <td class="num tnum">${esc(t.kolicina)}</td><td class="muted">${esc(t.napomena||'')}</td></tr>`).join('')}
  </tbody></table></div>`:'<p class="muted">Još nema transakcija.</p>';
}
const ARTIKAL_FIELDS=[
  {k:'naziv',l:'Naziv artikla',req:1,full:1},
  {k:'kategorija',l:'Kategorija',t:'select',opts:[['hemija','Hemija'],['potrosno','Potrošno'],['oprema','Oprema'],['ostalo','Ostalo']]},
  {k:'jm',l:'Jedinica mere',t:'select',opts:[['ml','ml'],['l','l'],['kom','kom'],['g','g'],['kg','kg']],def:'ml'},
  {k:'stanje',l:'Trenutno stanje',t:'number',def:0},
  {k:'min_stanje',l:'Minimalno stanje',t:'number',def:0},
  {k:'nabavna_cena',l:'Nabavna cena (RSD)',t:'number',def:0},
  {k:'dobavljac',l:'Dobavljač'},
  {k:'napomena',l:'Napomena',t:'textarea',full:1}
];
function artikalForm(id){
  const rec=id?get('Magacin',id):{jm:'ml',stanje:0,min_stanje:0};
  openModal(id?'Izmena artikla':'Novi artikal',`<div class="form-grid">${ARTIKAL_FIELDS.map(f=>fieldHTML(f,rec[f.k])).join('')}</div>`,
    `<button class="btn ghost" data-x>Otkaži</button><button class="btn primary" data-s>Sačuvaj</button>`);
  $('#modalFoot [data-x]').onclick=closeModal;
  $('#modalFoot [data-s]').onclick=async()=>{
    const o=readForm(ARTIKAL_FIELDS); if(!o.naziv){ toast('Naziv je obavezan','err'); return; }
    if(id){ o.id=id; await dbUpdate('Magacin',id,o); } else { o.id=uid('AR'); await dbCreate('Magacin',o); }
    closeModal(); toast('Sačuvano'); route('magacin');
  };
}
function txForm(artikalId){
  const arts=all('Magacin');
  const body=`<div class="form-grid">
    <div class="field full"><label>Artikal *</label><select id="f_art">${arts.map(a=>`<option value="${a.id}" ${a.id===artikalId?'selected':''}>${esc(a.naziv)} — stanje ${esc(a.stanje||0)} ${esc(a.jm)}</option>`).join('')}</select></div>
    <div class="field"><label>Tip *</label><select id="f_tip"><option value="ulaz">Ulaz (nabavka)</option><option value="izlaz">Ručni izlaz</option><option value="korekcija">Korekcija</option><option value="otpis">Otpis</option></select></div>
    <div class="field"><label>Količina *</label><input id="f_kol" type="number" step="0.01"></div>
    <div class="field full"><label>Napomena</label><input id="f_nap"></div>
  </div><p class="muted">Ulaz povećava stanje; izlaz/otpis smanjuju; korekcija postavlja stanje na unetu vrednost.</p>`;
  openModal('Nova transakcija', body, `<button class="btn ghost" data-x>Otkaži</button><button class="btn primary" data-s>Sačuvaj</button>`);
  $('#modalFoot [data-x]').onclick=closeModal;
  $('#modalFoot [data-s]').onclick=async()=>{
    const id=$('#f_art').value, tip=$('#f_tip').value, kol=num($('#f_kol').value), nap=$('#f_nap').value;
    if(!id||!kol){ toast('Izaberi artikal i količinu','err'); return; }
    const a=get('Magacin',id); let novo=num(a.stanje);
    if(tip==='ulaz') novo+=kol; else if(tip==='izlaz'||tip==='otpis') novo-=kol; else if(tip==='korekcija') novo=kol;
    await dbUpdate('Magacin',id,{...a,stanje:novo});
    await dbCreate('MagacinTx',{id:uid('TX'),datum:todayISO(),artikal_id:id,tip,kolicina:kol,nalog_id:'',napomena:nap});
    closeModal(); toast('Transakcija upisana'); route('magacin');
  };
}
function popisForm(){
  const arts=all('Magacin');
  const body=`<p class="muted">Unesi stvarno (popisano) stanje. Program izračunava razliku u odnosu na knjigovodstveno i pravi korekciju.</p>
    <table class="mini"><thead><tr><th>Artikal</th><th class="num">Knjigovodstveno</th><th class="num">Stvarno</th></tr></thead><tbody>
      ${arts.map(a=>`<tr><td>${esc(a.naziv)}</td><td class="num tnum">${esc(a.stanje||0)} ${esc(a.jm)}</td>
        <td class="num"><input data-pop="${a.id}" type="number" step="0.01" value="${esc(a.stanje||0)}" style="max-width:90px"></td></tr>`).join('')}
    </tbody></table>`;
  openModal('Mesečni popis', body, `<button class="btn ghost" data-x>Otkaži</button><button class="btn primary" data-s>Sačuvaj popis</button>`, true);
  $('#modalFoot [data-x]').onclick=closeModal;
  $('#modalFoot [data-s]').onclick=async()=>{
    let n=0;
    for(const inp of $$('#modalBody [data-pop]')){
      const a=get('Magacin',inp.dataset.pop); const stvarno=num(inp.value); const razlika=stvarno-num(a.stanje);
      if(razlika!==0){
        await dbUpdate('Magacin',a.id,{...a,stanje:stvarno});
        await dbCreate('MagacinTx',{id:uid('TX'),datum:todayISO(),artikal_id:a.id,tip:'popis',kolicina:razlika,nalog_id:'',napomena:'Korekcija popisom'});
        n++;
      }
    }
    closeModal(); toast(n?`Popis sačuvan — ${n} korekcija`:'Nema razlika'); route('magacin');
  };
}

/* ============================================================================
   IZVEŠTAJI — grafikoni, brojčane tabele, bonus, PDF
   ========================================================================== */
RENDER.izvestaji = el =>{
  const f=computeFinance(State.month);
  const b=computeBonus(State.month);
  const chem=chemUsage(State.month);
  // trend poslednjih 6 meseci
  const months=[]; let mk=State.month; for(let i=0;i<6;i++){ months.unshift(mk); mk=addMonths(mk,-1); }
  const trend=months.map(m=>{ const ff=computeFinance(m); return {m,ekst:ff.eksterni,intr:ff.interni,rash:ff.rashodi}; });

  el.innerHTML=`
    <div class="toolbar">
      <div class="muted">Mesečni pregled • ${subFor('izvestaji')}</div>
      <div class="spacer" style="flex:1"></div>
      <button class="btn primary" id="repPdf">PDF izveštaj</button>
    </div>
    <div class="cards">
      ${kpi('Naplaćeno spolja','up',money(f.eksterni))}
      ${kpi('Interna vrednost','grid',money(f.interni))}
      ${kpi('Rashodi','down',money(f.rashodi))}
      ${kpi('Rezultat (cash)','chart',money(f.rezultat))}
    </div>
    <div class="cols-2" style="margin-top:16px">
      <div class="panel"><div class="panel-head"><h3>Prihod vs rashod (6 meseci)</h3></div><div class="panel-body"><div class="chart-box"><canvas id="rTrend"></canvas></div></div></div>
      <div class="panel"><div class="panel-head"><h3>Interno vs eksterno</h3></div><div class="panel-body"><div class="chart-box"><canvas id="rIE"></canvas></div></div></div>
    </div>
    <div class="cols-2" style="margin-top:16px">
      <div class="panel"><div class="panel-head"><h3>Učinak po usluzi</h3></div><div class="panel-body"><div class="chart-box"><canvas id="rSvc"></canvas></div></div></div>
      <div class="panel"><div class="panel-head"><h3>Hemija — plan vs stvarno</h3></div><div class="panel-body"><div class="chart-box"><canvas id="rChem"></canvas></div></div></div>
    </div>

    <div class="sub-h">Učinak po radniku</div>
    <div class="table-wrap"><table><thead><tr><th>Radnik</th><th class="num">Naloga</th><th class="num">Vrednost rada</th><th class="num">Udeo</th><th class="num">Reklamacije</th></tr></thead><tbody>
      ${b.redovi.map(r=>`<tr><td><b>${esc(r.radnik.ime)}</b></td><td class="num tnum">${r.count}</td><td class="num tnum">${money(r.value)}</td><td class="num tnum">${Math.round(r.share*100)}%</td><td class="num tnum">${r.rekl}</td></tr>`).join('')}
    </tbody></table></div>

    <div class="sub-h">Predlog bonus fonda <span class="muted">(prag ${money(b.prag)} • ${b.met?'dostignut':'nije dostignut'})</span></div>
    <div class="table-wrap"><table><thead><tr><th>Radnik</th><th class="num">Predlog</th><th class="num">Odobreno (RSD)</th><th>Akcija</th></tr></thead><tbody>
      ${b.redovi.map(r=>{ const saved=all('Bonusi').find(x=>x.mesec===State.month&&String(x.radnik_id)===String(r.radnik.id));
        return `<tr><td>${esc(r.radnik.ime)}</td><td class="num tnum">${money(r.predlog)}</td>
        <td class="num"><input data-bon="${r.radnik.id}" type="number" value="${saved?esc(saved.iznos):r.predlog}" style="max-width:120px" data-admin-only></td>
        <td>${saved?`<span class="tag green">Odobreno</span>`:''}<button class="btn sm primary" data-approve="${r.radnik.id}" data-predlog="${r.predlog}" data-admin-only>Odobri</button></td></tr>`;}).join('')}
    </tbody></table></div>`;

  // charts
  makeChart('rTrend',{type:'line',data:{labels:trend.map(t=>t.m.slice(5)),datasets:[
    {label:'Naplaćeno',data:trend.map(t=>t.ekst),borderColor:'#0F766E',backgroundColor:'rgba(15,118,110,.12)',fill:true,tension:.35},
    {label:'Rashodi',data:trend.map(t=>t.rash),borderColor:'#DC2626',backgroundColor:'rgba(220,38,38,.08)',fill:true,tension:.35}]}});
  makeChart('rIE',{type:'doughnut',data:{labels:['Eksterno','Interno'],datasets:[{data:[f.eksterni,f.interni],backgroundColor:['#0F766E','#9CC9C4'],borderWidth:0}]},options:{cutout:'60%'}});
  const svc=Object.entries(f.perService).map(([id,v])=>[labelOf('Usluge',id),v.value]).sort((a,b)=>b[1]-a[1]);
  makeChart('rSvc',{type:'bar',data:{labels:svc.map(s=>s[0]),datasets:[{label:'Vrednost',data:svc.map(s=>s[1]),backgroundColor:PALETTE,borderRadius:6}]},options:{plugins:{legend:{display:false}}}});
  const chemArts=all('Magacin').filter(a=>chem.plan[a.id]||chem.real[a.id]);
  makeChart('rChem',{type:'bar',data:{labels:chemArts.map(a=>a.naziv),datasets:[
    {label:'Plan',data:chemArts.map(a=>chem.plan[a.id]||0),backgroundColor:'#9CC9C4',borderRadius:5},
    {label:'Stvarno',data:chemArts.map(a=>chem.real[a.id]||0),backgroundColor:'#0F766E',borderRadius:5}]}});

  $('#repPdf').onclick=()=>exportReportPDF();
  $$('#izvestaji [data-approve], [data-approve]').forEach(b=>b.onclick=async()=>{
    const rid=b.dataset.approve; const inp=$(`[data-bon="${rid}"]`); const iznos=num(inp.value);
    const ex=all('Bonusi').find(x=>x.mesec===State.month&&String(x.radnik_id)===String(rid));
    if(ex) await dbUpdate('Bonusi',ex.id,{...ex,iznos,odobreno:'da'});
    else await dbCreate('Bonusi',{id:uid('BN'),mesec:State.month,radnik_id:rid,predlog:num(b.dataset.predlog),odobreno:'da',iznos,napomena:''});
    toast('Bonus odobren'); route('izvestaji');
  });
};
function exportReportPDF(){
  const f=computeFinance(State.month); const b=computeBonus(State.month);
  const inner=`
    <div class="kv">
      <div><b>Naplaćeno spolja:</b> ${money(f.eksterni)}</div><div><b>Interna vrednost:</b> ${money(f.interni)}</div>
      <div><b>Ukupna vrednost rada:</b> ${money(f.ukupna)}</div><div><b>Rashodi:</b> ${money(f.rashodi)}</div>
      <div><b>Rezultat (cash):</b> ${money(f.rezultat)}</div><div><b>Broj pranja:</b> ${f.brojPranja}</div>
      <div><b>Do nule:</b> ${money(f.doNule)}</div><div><b>Do cilja profita:</b> ${money(f.doCilja)}</div>
    </div>
    <h3 style="font-size:14px;margin:18px 0 6px">Učinak po radniku</h3>
    <table><thead><tr><th>Radnik</th><th class="num">Naloga</th><th class="num">Vrednost</th><th class="num">Reklamacije</th><th class="num">Predlog bonusa</th></tr></thead><tbody>
      ${b.redovi.map(r=>`<tr><td>${esc(r.radnik.ime)}</td><td class="num">${r.count}</td><td class="num">${money(r.value)}</td><td class="num">${r.rekl}</td><td class="num">${money(r.predlog)}</td></tr>`).join('')}
    </tbody><tfoot><tr class="tot"><td colspan="4">Bonus fond (predlog)</td><td class="num">${money(b.fond)}</td></tr></tfoot></table>`;
  renderPDF(`Izvestaj-${State.month}.pdf`, docHTML('Mesečni izveštaj', subFor('izvestaji'), inner));
}

/* ============================================================================
   PODEŠAVANJA — povezivanje API-ja, parametri, demo reset
   ========================================================================== */
const SETTING_FIELDS=[
  {k:'mesecni_fiksni_trosak',l:'Mesečni fiksni trošak (RSD)',t:'number'},
  {k:'zeljeni_profit',l:'Željeni mesečni profit (RSD)',t:'number'},
  {k:'bonus_prag',l:'Bonus prag — vrednost rada (RSD)',t:'number'},
  {k:'bonus_procenat',l:'Bonus procenat (%)',t:'number'},
  {k:'kurs_eur',l:'EUR/RSD kurs',t:'number'},
  {k:'sati_po_radniku',l:'Radnih sati po radniku',t:'number'},
  {k:'radno_pocetak',l:'Početak radnog vremena',t:'time'},
  {k:'radno_kraj',l:'Kraj radnog vremena',t:'time'},
  {k:'subota_radna',l:'Subota',t:'select',opts:[['ne','Ne radi se'],['po_potrebi','Po potrebi'],['da','Radna']]}
];
RENDER.podesavanja = el =>{
  const s=State.settings;
  el.innerHTML=`
    <div class="panel"><div class="panel-head"><h3>Povezivanje sa Google Sheets</h3>
      <div class="spacer"></div><span class="conn-badge ${State.remote?'online':''}"><i></i>${State.remote?'Povezano':'Demo režim'}</span></div>
      <div class="panel-body">
        <p class="muted">Nalepi <b>Web App URL</b> (završava na <code>/exec</code>) iz Apps Script deploy-a. Čuva se lokalno na ovom uređaju.</p>
        <div class="api-row">
          <input id="apiUrl" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(s.apiUrl||'')}">
          <button class="btn" id="apiTest">Testiraj</button>
          <button class="btn primary" id="apiSave">Sačuvaj i poveži</button>
        </div>
        <div class="api-row" style="margin-top:10px">
          <button class="btn" id="apiSetup">Pokreni inicijalni setup (kreira tabove + demo)</button>
          <button class="btn ghost" id="apiDisc" ${State.remote?'':'disabled'}>Prekini vezu</button>
        </div>
        <div id="apiMsg" class="muted" style="margin-top:8px"></div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px" data-admin-only><div class="panel-head"><h3>Parametri poslovanja</h3></div>
      <div class="panel-body"><div class="form-grid">
        ${SETTING_FIELDS.map(f=>fieldHTML(f, s[f.k])).join('')}
      </div><div style="margin-top:14px"><button class="btn primary" id="setSave">Sačuvaj parametre</button></div></div>
    </div>

    <div class="panel" style="margin-top:16px"><div class="panel-head"><h3>Podaci</h3></div>
      <div class="panel-body">
        <p class="muted">Demo režim čuva podatke u pregledaču (localStorage). Reset vraća početne demo podatke.</p>
        <button class="btn ghost danger" id="resetDemo">Resetuj demo podatke</button>
      </div></div>`;

  $('#apiSave').onclick=async()=>{
    const url=$('#apiUrl').value.trim();
    if(!url){ toast('Unesi URL','err'); return; }
    LS.set('bcw_api',url); $('#apiMsg').textContent='Povezujem…';
    try{ const db=RemoteDB(url); const data=await db.bootstrap(); State.db=db; State.remote=true; State.data=data;
      for(const sh of SHEETS) State.data[sh]=State.data[sh]||[]; reindex(); setConn(true);
      toast('Povezano sa Google Sheets'); route('podesavanja');
    }catch(e){ $('#apiMsg').textContent='Greška: '+e.message; toast('Veza neuspela — proveri URL i dozvole','err'); }
  };
  $('#apiTest').onclick=async()=>{
    const url=$('#apiUrl').value.trim(); if(!url){ toast('Unesi URL','err'); return; }
    $('#apiMsg').textContent='Testiram…';
    try{ const r=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'list',sheet:'Podesavanja'})}); const j=await r.json();
      $('#apiMsg').textContent = j.ok? '✓ Veza radi. Odgovor primljen.' : 'Odgovor: '+(j.error||'nepoznato'); }
    catch(e){ $('#apiMsg').textContent='✗ Ne mogu da dođem do URL-a: '+e.message; }
  };
  $('#apiSetup').onclick=async()=>{
    const url=$('#apiUrl').value.trim(); if(!url){ toast('Prvo unesi URL','err'); return; }
    $('#apiMsg').textContent='Pokrećem setup…';
    try{ const r=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'setup'})}); const j=await r.json();
      $('#apiMsg').textContent= j.ok?'✓ Setup završen — tabovi kreirani.':'Greška: '+(j.error||''); if(j.ok) toast('Setup uspešan'); }
    catch(e){ $('#apiMsg').textContent='✗ '+e.message; }
  };
  $('#apiDisc').onclick=()=>confirmAction('Prekinuti vezu i vratiti se u demo režim?',async()=>{
    LS.set('bcw_api',''); State.db=LocalDB; State.remote=false; await loadAll(); setConn(false); toast('Vraćeno u demo režim'); route('podesavanja');
  });
  const ss=$('#setSave'); if(ss) ss.onclick=async()=>{
    for(const f of SETTING_FIELDS){ const el2=$('#f_'+f.k); if(el2) await saveSetting(f.k, f.t==='number'?num(el2.value):el2.value); }
    toast('Parametri sačuvani'); route('podesavanja');
  };
  $('#resetDemo').onclick=()=>confirmAction('Obrisati sve i vratiti demo podatke? (samo demo režim)',async()=>{
    if(State.remote){ toast('Reset radi samo u demo režimu','err'); return; }
    LS.set('bcw_data_v1',''); State.data=seedDemo(); LocalDB._save(State.data); reindex(); toast('Demo podaci resetovani'); route('dashboard');
  });
};

/* ============================================================================
   KORISNICI I PRAVA  (samo admin)
   ========================================================================== */
RENDER.korisnici = el =>{
  if(!Auth.can('admin')){ el.innerHTML='<div class="empty">Nemaš pristup ovom modulu.</div>'; return; }
  el.innerHTML=`
    <div class="banner info">${svgIco('key')}<div>Uloge: <b>Administrator</b> vidi i menja sve. <b>Korisnik</b> radi operativu (nalozi, vozila, magacin…) bez finansija i podešavanja. <b>Pregled</b> samo gleda, ništa ne menja.</div></div>
    <div class="toolbar">
      <div class="muted">Nalozi za prijavu i njihova ovlašćenja.</div>
      <div class="spacer" style="flex:1"></div>
      <button class="btn primary" id="usrAdd">+ Korisnik</button>
    </div>
    <div class="table-wrap"><table><thead><tr>
      <th>Ime</th><th>Korisničko ime</th><th>Uloga</th><th>Status</th><th></th>
    </tr></thead><tbody id="usrBody"></tbody></table></div>`;
  $('#usrAdd').onclick=()=>userForm();
  drawUsers();
};
function roleLabel(u){ return (ROLES[u]||{}).label || u; }
function drawUsers(){
  const rows=all('Korisnici').slice().sort((a,b)=>String(a.ime).localeCompare(String(b.ime)));
  $('#usrBody').innerHTML = rows.map(u=>{
    const self = State.user && State.user.id===u.id;
    return `<tr>
      <td><b>${esc(u.ime||'')}</b>${self?' <span class="tag gray">vi</span>':''}</td>
      <td class="tnum">${esc(u.korisnicko_ime||'')}</td>
      <td><span class="tag ${u.uloga==='admin'?'green':u.uloga==='viewer'?'gray':''}">${esc(roleLabel(u.uloga))}</span></td>
      <td>${String(u.aktivan)==='ne'?'<span class="tag red">Deaktiviran</span>':'<span class="tag green">Aktivan</span>'}</td>
      <td><div class="row-actions">
        <button class="btn sm ghost" data-edit="${u.id}">Izmeni</button>
        <button class="btn sm ghost" data-pass="${u.id}">Lozinka</button>
        <button class="btn sm ghost danger" data-del="${u.id}" ${self?'disabled title="Ne možeš obrisati svoj nalog"':''}>Obriši</button>
      </div></td></tr>`;
  }).join('') || `<tr><td colspan="5"><div class="empty">${svgIco('key')}<div>Nema korisnika.</div></div></td></tr>`;
  $$('#usrBody [data-edit]').forEach(b=>b.onclick=()=>userForm(b.dataset.edit));
  $$('#usrBody [data-pass]').forEach(b=>b.onclick=()=>passwordForm(b.dataset.pass));
  $$('#usrBody [data-del]').forEach(b=>{ if(b.disabled) return; b.onclick=()=>confirmAction('Obrisati ovog korisnika?',async()=>{ await dbRemove('Korisnici',b.dataset.del); toast('Korisnik obrisan'); route('korisnici'); }); });
}
function userForm(id){
  const rec = id? get('Korisnici',id) : {uloga:'korisnik',aktivan:'da'};
  const isNew=!id;
  const fields = [
    {k:'ime',l:'Ime i prezime',req:1,full:1},
    {k:'korisnicko_ime',l:'Korisničko ime',req:1},
    {k:'uloga',l:'Uloga / ovlašćenje',t:'select',opts:ROLE_OPTS},
    {k:'aktivan',l:'Status',t:'select',opts:[['da','Aktivan'],['ne','Deaktiviran']]}
  ];
  const passField = isNew? `<div class="field full"><label for="f_lozinka">Početna lozinka *</label><input id="f_lozinka" type="text" placeholder="min. 4 znaka"><span class="hint">Korisnik je može kasnije promeniti preko admina.</span></div>` : '';
  openModal(isNew?'Novi korisnik':'Izmena korisnika',
    `<div class="form-grid">${fields.map(f=>fieldHTML(f,rec[f.k])).join('')}${passField}</div>`,
    `<button class="btn ghost" data-x>Otkaži</button><button class="btn primary" data-s>Sačuvaj</button>`);
  $('#modalFoot [data-x]').onclick=closeModal;
  $('#modalFoot [data-s]').onclick=async()=>{
    const o=readForm(fields);
    if(!o.ime||!o.korisnicko_ime){ toast('Popuni ime i korisničko ime','err'); return; }
    try{
      if(isNew){
        const lozinka=$('#f_lozinka').value;
        if(!lozinka||lozinka.length<4){ toast('Lozinka mora imati bar 4 znaka','err'); return; }
        await Auth.createUser({id:uid('usr'),...o}, lozinka);
      } else {
        await Auth.updateUser(id, o);
      }
      closeModal(); toast('Sačuvano'); route('korisnici');
    }catch(e){ toast(e.message||'Greška','err'); }
  };
}
function passwordForm(id){
  const u=get('Korisnici',id);
  openModal('Nova lozinka — '+esc(u.ime||u.korisnicko_ime),
    `<div class="form-grid"><div class="field full"><label for="f_np">Nova lozinka *</label><input id="f_np" type="text" placeholder="min. 4 znaka" autofocus></div></div>`,
    `<button class="btn ghost" data-x>Otkaži</button><button class="btn primary" data-s>Postavi lozinku</button>`);
  $('#modalFoot [data-x]').onclick=closeModal;
  $('#modalFoot [data-s]').onclick=async()=>{
    const np=$('#f_np').value;
    if(!np||np.length<4){ toast('Lozinka mora imati bar 4 znaka','err'); return; }
    try{ await Auth.resetPassword(id, np); closeModal(); toast('Lozinka promenjena'); }
    catch(e){ toast(e.message||'Greška','err'); }
  };
}
