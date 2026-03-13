import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js?v=2026.03.14.03";

// Using ESM build from jsdelivr to avoid a build step (Node not required).
// When you later move to a bundled app, replace this with a normal npm dependency.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const url = String(SUPABASE_URL || "https://hijfnphtjjuhsqhlmtcd.supabase.co").trim().replace(/\/+$/, "");
const anonKey = String(SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhpamZucGh0amp1aHNxaGxtdGNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3NTkzOTgsImV4cCI6MjA4NjMzNTM5OH0.1aPxWp8S5v8o-313Rx4g9uJGysYWDS1zqUdeNp_kGm8").trim();

if (!url || !anonKey) {
  // Keep this as a runtime error so misconfiguration is obvious on first load.
  throw new Error(
    "Missing Supabase config. Edit web/config.js and set SUPABASE_URL and SUPABASE_ANON_KEY."
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
