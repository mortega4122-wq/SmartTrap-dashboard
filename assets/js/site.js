// Shared header and footer for the website pages.
// Each page has <div data-site-header></div> followed by this script, and
// <div data-site-footer></div> near the end of <body>. Links are relative
// because GitHub Pages serves the site under /SmartTrap-dashboard/.
(function () {
  const NAV = [
    { href: "about.html",        label: "About Us" },
    { href: "product.html",      label: "Our Product" },
    { href: "case-studies.html", label: "Case Studies" },
    { href: "docs.html",         label: "Documentation" },
  ];
  const CONTACT_URL   = "contact.html";
  const DASHBOARD_URL = "dashboard/index.html";
  const current = location.pathname.split("/").pop() || "index.html";
  const currentAttr = href => (href === current ? ' aria-current="page"' : "");

  const navLinks = NAV.map(item => `<li><a href="${item.href}"${currentAttr(item.href)}>${item.label}</a></li>`).join("");

  const wordmark = `
    <a class="wordmark" href="index.html" aria-label="VerdanTech Solutions home">
      <span class="wordmark-verdan">Verdan</span><span class="wordmark-tech">Tech</span><span class="wordmark-sub">Solutions</span>
    </a>`;

  const header = document.querySelector("[data-site-header]");
  if (header) {
    header.outerHTML = `
      <header class="site-header">
        <div class="container header-inner">
          ${wordmark}
          <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">
            <span class="sr-only">Menu</span><span class="nav-toggle-bar"></span>
          </button>
          <nav class="site-nav" id="site-nav" aria-label="Main">
            <ul>${navLinks}</ul>
            <div class="nav-actions">
              <a class="btn btn-cta" href="${CONTACT_URL}"${currentAttr(CONTACT_URL)}>Contact Us</a>
              <a class="btn btn-primary" href="${DASHBOARD_URL}">Dashboard Login →</a>
            </div>
          </nav>
        </div>
      </header>`;

    const toggle = document.querySelector(".nav-toggle");
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      document.getElementById("site-nav").classList.toggle("open", open);
    });
  }

  function renderFooter() {
    const footer = document.querySelector("[data-site-footer]");
    if (!footer) return;
    const footerLinks = NAV.map(item => `<li><a href="${item.href}">${item.label}</a></li>`).join("");
    footer.outerHTML = `
      <footer class="site-footer">
        <div class="container">
          <div class="footer-inner">
            <div>
              ${wordmark}
              <p class="footer-tagline">Smart, affordable pest monitoring for orchards.</p>
            </div>
            <nav aria-label="Footer">
              <ul class="footer-links">${footerLinks}<li><a href="${CONTACT_URL}">Contact Us</a></li><li><a href="${DASHBOARD_URL}">Dashboard Login</a></li></ul>
            </nav>
          </div>
          <div class="footer-bottom">© ${new Date().getFullYear()} VerdanTech Solutions. Contact details coming soon.</div>
        </div>
      </footer>`;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderFooter);
  else renderFooter();
})();
