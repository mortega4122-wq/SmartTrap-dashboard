// Shared header and footer for the website pages.
// Each page has <div data-site-header></div> followed by this script, and
// <div data-site-footer></div> near the end of <body>. Pages that open with a
// full-bleed photo put class="has-dark-hero" on <body>, which keeps the header
// transparent until the visitor scrolls. Links are relative because GitHub
// Pages serves the site under /SmartTrap-dashboard/.
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

  const wordmark = `<a class="wordmark" href="index.html" aria-label="VerdanTech Solutions home"><span class="wordmark-verdan">Verdan</span><span class="wordmark-tech">Tech</span></a>`;

  // Photos not yet added to assets/img/ fail to load. Remove them so the .media
  // block shows its placeholder label instead of a broken-image icon.
  document.addEventListener("error", e => {
    if (e.target instanceof HTMLImageElement && e.target.closest(".media")) e.target.remove();
  }, true);

  const headerSlot = document.querySelector("[data-site-header]");
  if (headerSlot) {
    const navLinks = NAV.map(item => `<li><a href="${item.href}"${currentAttr(item.href)}>${item.label}</a></li>`).join("");
    headerSlot.outerHTML = `
      <header class="site-header">
        <div class="container header-inner">
          ${wordmark}
          <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">
            <span class="sr-only">Menu</span><span class="nav-toggle-bar"></span>
          </button>
          <nav class="site-nav" id="site-nav" aria-label="Main">
            <ul>${navLinks}</ul>
            <div class="nav-actions">
              <a class="btn btn-cta" href="${CONTACT_URL}"${currentAttr(CONTACT_URL)}>Contact Us <span aria-hidden="true">↗</span></a>
              <a class="btn btn-primary" href="${DASHBOARD_URL}">Dashboard Login <span aria-hidden="true">↗</span></a>
            </div>
          </nav>
        </div>
      </header>`;

    const header = document.querySelector(".site-header");
    const toggle = header.querySelector(".nav-toggle");
    const nav    = header.querySelector(".site-nav");
    const hasDarkHero = document.body.classList.contains("has-dark-hero");

    const updateHeader = () => {
      header.classList.toggle("is-solid", !hasDarkHero || window.scrollY > 24 || nav.classList.contains("open"));
    };

    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      nav.classList.toggle("open", open);
      updateHeader();
    });
    window.addEventListener("scroll", updateHeader, { passive: true });
    updateHeader();
  }

  function renderFooter() {
    const footerSlot = document.querySelector("[data-site-footer]");
    if (!footerSlot) return;
    const links = [...NAV, { href: CONTACT_URL, label: "Contact Us" }, { href: DASHBOARD_URL, label: "Dashboard Login" }]
      .map(item => `<li><a href="${item.href}">${item.label}</a></li>`).join("");
    footerSlot.outerHTML = `
      <footer class="site-footer">
        <div class="footer-card">
          <div class="footer-main">
            <div class="footer-brand">
              ${wordmark}
              <p class="footer-tagline">Smart pest monitoring for orchards</p>
            </div>
            <div class="footer-details">
              <div>
                <span class="footer-label">Contact</span>
                <address>
                  <span>Email: coming soon</span>
                  <span>Phone: coming soon</span>
                  <span>Address: coming soon</span>
                </address>
              </div>
              <nav aria-label="Footer">
                <span class="footer-label">Explore</span>
                <ul class="footer-links">${links}</ul>
              </nav>
            </div>
          </div>
          <div class="media" data-label="assets/img/footer-orchard.jpg">
            <img src="assets/img/footer-orchard.jpg" alt="" loading="lazy">
          </div>
          <div class="footer-bottom">
            <span>© ${new Date().getFullYear()} VerdanTech Solutions. All rights reserved.</span>
            <a href="${CONTACT_URL}">Request a field demo ↗</a>
          </div>
        </div>
      </footer>`;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderFooter);
  else renderFooter();
})();
