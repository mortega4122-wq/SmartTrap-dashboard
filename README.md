# VerdanTech Solutions — SmartTrap

- Website: https://mortega4122-wq.github.io/SmartTrap-dashboard/
- Dashboard (login required): https://mortega4122-wq.github.io/SmartTrap-dashboard/dashboard/

# Objective
The overall goal of this project is to deploy and validate an autonomous SmartTrap Pest Monitoring Network for early detection, orchard-scale hotspot mapping, and decision support for Carpophilus truncatus in California almond orchards.

The SmartTraps operate as distributed field nodes, while an autonomous robotic platform traverses the orchard and wirelessly collects data once within communication range. In this role, the robotic platform functions as an autonomous mobile Wi-Fi gateway for the SmartTrap network.

# Repository layout
| Path | Purpose |
|---|---|
| `index.html`, `about.html`, `product.html`, `case-studies.html`, `docs.html` | Company website |
| `contact.html`, `assets/js/contact.js` | Contact Us page: field demo request form, saved to Supabase `demo_requests` |
| `assets/css/site.css` | Website styles; colors and fonts are tokens at the top |
| `assets/js/site.js` | Shared website header (including the Contact Us and Dashboard Login buttons) and footer |
| `assets/img/` | Website photos; `assets/img/README.md` lists the file names each page expects |
| `downloads/` | PDFs linked from the Documentation page |
| `dashboard/` | SmartTrap dashboard pages, plus `login.html` and `set-password.html` |
| `dashboard/js/auth.js` | Supabase client, login check, and request headers used by every dashboard page |
| `dashboard/layout.html` | Layout pane: spreads traps evenly inside the orchard boundary and hands you each point's coordinates for the field |
| `dashboard/js/geo.js` | Metres projection, polygon area, and the trap layout generator. No Supabase, Leaflet, or DOM, so it can be tested on its own |
| `tests/geo-harness.html` | Assertions for `dashboard/js/geo.js`. Open it in a browser; the tab title says OK or FAIL |
| `scan.html`, `detail.html`, `orchard-setup.html`, `index-mobile.html` (root) | Redirects into `dashboard/`, so existing bookmarks and the QR codes on traps keep working |
| `supabase/rls-policies.sql` | Per-account access rules (row-level security); run once login works |
| `supabase/trap-layouts.sql` | Creates the table the Layout pane saves to; run once before using that pane |
| `supabase/demo-data.sql` | Simulated 10-trap orchard for the demo login, refreshed daily |
| `supabase/demo-requests.sql` | Creates the table behind the Contact Us form |

# Contact form setup (one time, in Supabase)
Run `supabase/demo-requests.sql` in the SQL Editor. Visitors can submit requests but can't read them. View new requests under **Table Editor → demo_requests**.

# Dashboard login setup (one time, in Supabase)
1. **Authentication → Sign In / Providers**: keep Email enabled and turn off *Allow new users to sign up* (accounts are invite-only).
2. **Authentication → URL Configuration**
   - Site URL: `https://mortega4122-wq.github.io/SmartTrap-dashboard/dashboard/login.html`
   - Redirect URLs: add `https://mortega4122-wq.github.io/SmartTrap-dashboard/dashboard/set-password.html`
3. **Authentication → Users → Invite user.** The invite email opens `set-password.html`, where the user chooses a password.
4. Once sign-in works, run `supabase/rls-policies.sql` (steps at the top of the file). Until then, anyone with the publishable key can read the dashboard tables.
5. Run `supabase/trap-layouts.sql` to create the table the Layout pane saves to. Until then that pane still generates and exports layouts, but can't save one.

# Planning a trap layout
For a block with more than a handful of traps, **Layout** places them evenly instead of by eye.
1. Mark the block in **Orchard setup** and save. The next-step link takes you to Layout.
2. Set a trap count (or a spacing in feet), turn the grid to run along your tree rows, and set how far in from the edge to stay. Mark any point as a repeater.
   - The grid is centred in the block, so the margins on opposite sides match. To build it around a particular spot instead, set a **centre point** on the map and a trap lands exactly there.
   - Distances are in feet and areas in acres, matching the °F readings elsewhere in the dashboard.
3. Save. The layout is on your account, so it's there when you open the dashboard on your phone in the field.
4. At each point tap **Navigate** to walk to it with Google Maps, hang the trap, then **Add this trap** to record where it actually went in. The pane then shows how far that trap ended up from its planned spot.

Planned points are not traps. A trap exists only once you save it from **Add trap** standing at it, so the recorded position is always the real one, never the intended one.

# Per-account data
Each login sees only its own traps, readings, orchard boundary, and rover track. Supabase row-level security does the filtering; the dashboard pages don't filter by user.
- A trap belongs to the login that registered it (QR code → `scan.html`). Its `trap_data` readings follow the node ID, so the Raspberry Pi needs no account setting.
- Node IDs are unique across logins. Register field traps while signed in to the field login.
- Field devices upload with a Supabase **secret** key, which these rules don't limit.

# Demo account
`supabase/demo-data.sql` loads a simulated 10-trap orchard (`demo-01` … `demo-10`) into one login, for showing the dashboard without real data. It generates the 4 days before it runs and schedules a daily refresh with Supabase Cron, so the charts stay full. Run `select public.refresh_demo_data();` for a fresh copy right before a demo; removal steps are at the bottom of the file.
