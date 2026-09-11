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
| `scan.html`, `detail.html`, `orchard-setup.html`, `index-mobile.html` (root) | Redirects into `dashboard/`, so existing bookmarks and the QR codes on traps keep working |
| `supabase/rls-policies.sql` | Database access rules to apply once login works |
| `supabase/demo-requests.sql` | Creates the table behind the Contact Us form |

# Contact form setup (one time, in Supabase)
Run `supabase/demo-requests.sql` in the SQL Editor. Visitors can submit requests but can't read them. View new requests under **Table Editor → demo_requests**.

# Dashboard login setup (one time, in Supabase)
1. **Authentication → Sign In / Providers**: keep Email enabled and turn off *Allow new users to sign up* (accounts are invite-only).
2. **Authentication → URL Configuration**
   - Site URL: `https://mortega4122-wq.github.io/SmartTrap-dashboard/dashboard/login.html`
   - Redirect URLs: add `https://mortega4122-wq.github.io/SmartTrap-dashboard/dashboard/set-password.html`
3. **Authentication → Users → Invite user.** The invite email opens `set-password.html`, where the user chooses a password.
4. Once sign-in works, read the header of `supabase/rls-policies.sql` and run it. Until then, the tables can still be read and written with the publishable key.
