// Demo request form on contact.html.
// Submissions are inserted into the Supabase demo_requests table (see
// supabase/demo-requests.sql). Same project and publishable key as
// dashboard/js/auth.js. The table accepts inserts from visitors but
// can't be read back with this key.
(function () {
  const SUPABASE_URL = "https://nqhmvymrikjnkvtxtcst.supabase.co";
  const SUPABASE_KEY = "sb_publishable_e-UEF6y_4kk-QSFb7CfzHQ_lgLVSG6l";

  const form      = document.getElementById("demo-form");
  const statusEl  = document.getElementById("form-status");
  const submitBtn = document.getElementById("demo-submit");

  function setStatus(text, type = "") {
    statusEl.textContent = text;
    statusEl.className = `form-status ${type}`;
  }

  function showSuccess() {
    form.hidden = true;
    const success = document.getElementById("form-success");
    success.hidden = false;
    success.focus();
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const data = new FormData(form);

    // Spam trap: people never see this field, so anything in it came from a bot.
    // Pretend it worked so the bot doesn't retry.
    if (data.get("website")) { showSuccess(); return; }

    const value = name => (data.get(name) || "").toString().trim() || null;
    const payload = {
      full_name:    value("full_name"),
      email:        value("email"),
      phone:        value("phone"),
      organization: value("organization"),
      role:         value("role"),
      crop:         value("crop"),
      location:     value("location"),
      acreage:      value("acreage"),
      timeframe:    value("timeframe"),
      message:      value("message"),
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";
    setStatus("");

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/demo_requests`, {
        method: "POST",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      showSuccess();
    } catch (err) {
      console.error("Demo request failed:", err);
      setStatus("Sorry, we couldn't send your request. Please try again in a few minutes.", "error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Request a demo";
    }
  });
})();
