// ============================================================
// Provo YSA 8th Ward - Application Configuration
// ============================================================

window.SUPABASE_CONFIG = {
  // Supabase Project Base URL
  url: "https://dvsuzohrgbrwkgzsylbp.supabase.co",

  // Public Anon API Key
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2c3V6b2hyZ2Jyd2tnenN5bGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2OTAwOTUsImV4cCI6MjEwMzI2NjA5NX0.qXRW92s1BaiAT3uPGWBxe-UnMEPLYJamYs-JtyCJNR8"
};

// Public VAPID key for Web Push admin notifications (safe to expose —
// it's the "application server key" browsers use to identify this app,
// not a secret; the matching private key stays server-side only).
window.VAPID_PUBLIC_KEY = "BP55H0sYioCsiP9_cex_27jJpc7pNXNFIorskWTZnWz03CFm4WMCsdcehXBek6Q-x7c8NXOhT_cbQC5I-1CqeWk";
