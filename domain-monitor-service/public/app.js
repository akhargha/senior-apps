function $(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setResult(html, kind) {
  const resultBody = $("resultBody");
  resultBody.classList.remove("success", "error");
  if (kind) resultBody.classList.add(kind);
  resultBody.innerHTML = html;
}

async function postJson(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data && data.error ? data.error : `Request failed (${resp.status})`;
    throw new Error(msg);
  }
  return data;
}

function fillFrequencyOptions() {
  const select = $("frequencySeconds");
  const options = [{ label: "Every 6 hours", value: 6 * 60 * 60 }];
  for (let days = 1; days <= 14; days++) {
    options.push({
      label: `Every ${days} day${days === 1 ? "" : "s"}`,
      value: days * 24 * 60 * 60,
    });
  }

  for (const opt of options) {
    const el = document.createElement("option");
    el.value = String(opt.value);
    el.textContent = opt.label;
    select.appendChild(el);
  }
}

function selectedVerificationMethod() {
  const checked = document.querySelector('input[name="verificationMethod"]:checked');
  return checked ? checked.value : "domain_email";
}

function getFormValues() {
  return {
    domain: document.querySelector('input[name="domain"]').value.trim(),
    email: document.querySelector('input[name="email"]').value.trim(),
    verificationMethod: selectedVerificationMethod(),
    frequencySeconds: Number($("frequencySeconds").value),
  };
}

function setVerifyButton(monitorId) {
  const btn = $("verifyBtn");
  if (!btn) return;
  btn.dataset.monitorId = monitorId;
}

function wireVerifyHandler() {
  const btn = $("verifyBtn");
  if (!btn) return;

  // Use `onclick` to avoid stacking multiple handlers on re-render.
  btn.onclick = async () => {
    const monitorId = btn.dataset.monitorId;
    btn.disabled = true;
    setResult("Verifying TXT record...", null);
    try {
      const data = await postJson("/api/verify-txt", { monitorId });
      setResult(
        `<div class="success">Verified.</div><div class="muted">Next check: ${escapeHtml(
          String(data.nextCheckAt || "")
        )}</div>`,
        "success"
      );
    } catch (err) {
      setResult(`<div class="error">${escapeHtml(err.message)}</div>`, "error");
    } finally {
      btn.disabled = false;
    }
  };
}

document.addEventListener("DOMContentLoaded", () => {
  fillFrequencyOptions();

  const form = $("signupForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = $("submitBtn");
    submitBtn.disabled = true;
    setResult("Creating your signup...", null);

    try {
      const values = getFormValues();
      const data = await postJson("/api/signup", values);

      if (values.verificationMethod === "domain_email") {
        setResult(
          `
            <div class="success">Saved and verified.</div>
            <div class="muted">Monitor ID: <span class="mono">${escapeHtml(data.monitorId || "")}</span></div>
            <div class="divider"></div>
            <div class="muted">Domain: <span class="mono">${escapeHtml(data.domain || values.domain)}</span></div>
            <div class="muted">Email: <span class="mono">${escapeHtml(data.email || values.email)}</span></div>
            <div class="muted">${escapeHtml(data.note || "")}</div>
          `,
          "success"
        );
      } else {
        const v = data.verification || {};
        setResult(
          `
            <div class="${escapeHtml(data.status === "pending" ? "muted" : "")}">Signup created: pending TXT verification.</div>
            <div class="muted">Monitor ID: <span class="mono">${escapeHtml(data.monitorId || "")}</span></div>
            <div class="divider"></div>
            <div class="muted">
              Create this TXT record:
              <div class="mono">${escapeHtml(v.txtHost || "")}</div>
              <div class="muted">TXT value:</div>
              <div class="mono">${escapeHtml(v.txtValue || "")}</div>
            </div>
            <div class="divider"></div>
            <div class="actions" style="justify-content:flex-start;">
              <button id="verifyBtn" type="button">Verify TXT</button>
            </div>
            <div class="help">${escapeHtml(data.note || "")}</div>
          `,
          null
        );
        // Wire handler after HTML insertion.
        setVerifyButton(data.monitorId);
        wireVerifyHandler();
      }
    } catch (err) {
      setResult(`<div class="error">${escapeHtml(err.message)}</div>`, "error");
    } finally {
      submitBtn.disabled = false;
    }
  });
});

