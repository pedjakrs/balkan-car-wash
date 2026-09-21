/* ============================================================
   BALKAN CAR WASH — konfiguracija
   ------------------------------------------------------------
   Zameni obe vrednosti podacima svog Supabase projekta:
   Supabase → Project Settings → API

     SUPABASE_URL       = "Project URL"        (npr. https://abcdefgh.supabase.co)
     SUPABASE_ANON_KEY  = "anon public" ključ  (dugačak JWT, počinje sa eyJ...)

   VAŽNO: anon ključ JESTE javan i namenjen je pregledaču.
   Zaštitu podataka obezbeđuju isključivo RLS politike iz
   supabase_schema.sql. NIKADA ovde ne stavljaj "service_role" ključ.
   ============================================================ */
window.BCW_CONFIG = {
  SUPABASE_URL:      'https://kwihbopcgnilqndcgjmb.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3aWhib3BjZ25pbHFuZGNnam1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5ODE2NzMsImV4cCI6MjEwNTU1NzY3M30.ghejTk7ZSMage1xRvfPNGrkOKYNRt5zvBJFzdYaRpsQ'
};
