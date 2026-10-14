// Shared Supabase client and login check for every dashboard page.
// Load order in each page's <head>: supabase-js UMD → this file → requireLogin().

const SUPABASE_URL = "https://nqhmvymrikjnkvtxtcst.supabase.co";
const SUPABASE_KEY = "sb_publishable_e-UEF6y_4kk-QSFb7CfzHQ_lgLVSG6l";

// GitHub Pages serves scan.html at /dashboard/scan, so links leave off ".html". Old
// bookmarks and the Supabase email links still arrive at the .html address; show the
// clean one. The hash is kept, since supabase-js reads sign-in tokens from it.
const cleanPath = location.pathname.replace(/\/index\.html$/, "/").replace(/\.html$/, "");
if (cleanPath !== location.pathname) history.replaceState(null, "", cleanPath + location.search + location.hash);

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// supabase-js keeps the session in localStorage under this key.
const AUTH_STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

function redirectToLogin() {
  const page = cleanPath.split("/").pop() || "./";
  location.replace(`login?next=${encodeURIComponent(page + location.search)}`);
}

// Fast synchronous check so logged-out visitors never see the page flash.
// authHeaders() does the real check and catches expired or revoked sessions.
function requireLogin() {
  let stored = null;
  try { stored = localStorage.getItem(AUTH_STORAGE_KEY); } catch {}
  if (!stored) redirectToLogin();
}

// Headers for Supabase REST calls. They carry the signed-in user's token (not the
// publishable key) so row-level security can tell users apart. If the session is
// gone, this redirects to login and never resolves, which halts the caller.
async function authHeaders(extra = {}) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    redirectToLogin();
    return new Promise(() => {});
  }
  return { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${session.access_token}`, ...extra };
}

async function signOut() {
  await sb.auth.signOut();
  location.replace("login");
}
