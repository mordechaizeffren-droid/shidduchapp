import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ixqcvzbkgcvrdtyfveou.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4cWN2emJrZ2N2cmR0eWZ2ZW91Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3ODkyMDYsImV4cCI6MjA3MjM2NTIwNn0.6Fu7leRQLaS04V0k112ytAmLR4IMFGWq1GZGI_epqUU";

export const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);



