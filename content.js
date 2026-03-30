const BADGE_ID = "atproto-domain-verification-badge";
const BADGE_WRAPPER_ID = "atproto-domain-verification-badge-wrapper";
const MODAL_BACKDROP_ID = "atproto-domain-verification-modal-backdrop";
const MODAL_ID = "atproto-domain-verification-modal";
const PROFILE_PATH_PREFIX = "/profile/";
const LEARN_MORE_URL = "https://www.google.com/site_name";
let lastProcessedProfile = "";
let lastVerificationDomain = "";
let lastVerificationResult = null;
let renderRetryInFlight = false;
let mutationObserver = null;

function escapeHtml(input) {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isValidDomainLike(maybeDomain) {
  const domain = String(maybeDomain || "").trim().toLowerCase();
  if (!domain) {
    return false;
  }

  // Bluesky "app domains" like `@iohn.bsky.social` are not what we want to verify.
  // If the handle ends with `.bsky.social`, don't show the badge at all.
  if (domain === "bsky.social" || domain.endsWith(".bsky.social")) {
    return false;
  }

  // We only treat domain-style handles as verifiable (e.g. "example.com").
  // Handles without a dot (e.g. "@alice") should not show a badge.
  if (!domain.includes(".")) {
    return false;
  }

  // Enforce DNS-like label rules (not perfect, but good practical validation).
  if (domain.length > 253) {
    return false;
  }

  const labels = domain.split(".");
  if (labels.some((l) => !l)) {
    return false;
  }

  const labelRe = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  const tld = labels[labels.length - 1];
  if (tld.length < 2) {
    return false;
  }

  return labels.every((label) => labelRe.test(label));
}

function getDomainFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (!url.pathname.startsWith(PROFILE_PATH_PREFIX)) {
      return null;
    }

    const profileSegment = url.pathname.slice(PROFILE_PATH_PREFIX.length).split("/")[0];
    if (!profileSegment) {
      return null;
    }

    const candidate = decodeURIComponent(profileSegment).replace(/^@/, "").trim().toLowerCase();
    return isValidDomainLike(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function getDomainFromHandleText() {
  const handleNode = Array.from(document.querySelectorAll("span, div, a")).find((node) => {
    const text = node.textContent ? node.textContent.trim() : "";
    return text.startsWith("@") && text.includes(".");
  });

  if (!handleNode || !handleNode.textContent) {
    return null;
  }

  const candidate = handleNode.textContent.replace(/^@/, "").trim().toLowerCase();
  return isValidDomainLike(candidate) ? candidate : null;
}

function isElementInSidebarOrNav(el) {
  if (!el || !el.closest) {
    return false;
  }

  // Bluesky's markup can vary; side rails are commonly <nav>/<aside>, but we also
  // exclude common sidebar containers used by SPA layouts.
  return Boolean(
    el.closest("nav") ||
    el.closest('[role="navigation"]') ||
    el.closest("aside") ||
    el.closest('[role="complementary"]') ||
    el.closest('[data-testid*="sidebar" i]') ||
    el.closest('[data-testid*="side" i][data-testid*="bar" i]') ||
    el.closest('[aria-label*="navigation" i]')
  );
}

function isElementVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function normalizeHandleText(text) {
  return String(text || "")
    .replace(/\u200B/g, "") // zero-width spaces
    .replace(/\s+/g, " ")
    .trim();
}

function findHandleAnchor(domain) {
  const atDomain = `@${domain}`;
  const mainElement = document.querySelector("main");

  // 1) Primary strategy: visible handle *text element* inside <main>.
  // This is crucial for layouts where the header handle is NOT an <a> tag.
  if (mainElement) {
    const exactCandidates = Array.from(
      mainElement.querySelectorAll(
        '[data-testid="profileHeaderDisplayName"], div[dir="auto"], span[dir="auto"]'
      )
    ).filter((el) => {
      if (!el || !el.textContent) return false;
      if (!isElementVisible(el)) return false;
      if (isElementInSidebarOrNav(el)) return false;

      const normalized = normalizeHandleText(el.textContent);
      if (!normalized) return false;

      const normalizedNoAt = normalized.startsWith("@") ? normalized.slice(1) : normalized;
      return normalized === atDomain || normalized === domain || normalizedNoAt === domain;
    });

    if (exactCandidates.length > 0) {
      // Prefer the visually most prominent candidate (helps when side rails also contain the same text).
      const bestExact = exactCandidates
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return { el, width: rect.width || 0, top: rect.top || 0 };
        })
        .sort((a, b) => (b.width - a.width) || (a.top - b.top))[0];
      return bestExact ? bestExact.el : exactCandidates[0];
    }

    // Second pass: handle may be nested/split; still keep it scoped to <main>.
    const containsCandidates = Array.from(mainElement.querySelectorAll("span, div")).filter((el) => {
      if (!el || !el.textContent) return false;
      if (!isElementVisible(el)) return false;
      if (isElementInSidebarOrNav(el)) return false;

      const normalized = normalizeHandleText(el.textContent);
      if (!normalized) return false;
      return normalized.includes(atDomain) || normalized.includes(domain);
    });

    if (containsCandidates.length > 0) {
      const bestContains = containsCandidates
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return { el, width: rect.width || 0, top: rect.top || 0 };
        })
        .sort((a, b) => (b.width - a.width) || (a.top - b.top))[0];
      return bestContains ? bestContains.el : containsCandidates[0];
    }
  }

  // 2) Fallback: profile link, but only if it is located within <main>.
  const profileLink = findProfileLinkAnchor(domain);
  if (profileLink) return profileLink;

  // 3) Last resort: any visible element inside <main> containing the handle.
  if (mainElement) {
    const lastResort = Array.from(mainElement.querySelectorAll("span, div, a")).find((el) => {
      if (!el || !el.textContent) return false;
      if (!isElementVisible(el)) return false;
      if (isElementInSidebarOrNav(el)) return false;
      const normalized = normalizeHandleText(el.textContent);
      return normalized.includes(atDomain) || normalized.includes(domain);
    });
    return lastResort || null;
  }

  return null;
}

function findProfileLinkAnchor(domain) {
  const hrefExact = `/profile/${domain}`;
  const mainElement = document.querySelector("main");
  if (!mainElement) {
    return null;
  }

  const anchors = Array.from(mainElement.querySelectorAll("a[href]"));
  const matches = anchors.filter((a) => {
    const href = a.getAttribute("href") || "";
    if (!href) {
      return false;
    }

    // Handles:
    // - "/profile/<domain>"
    // - "https://bsky.app/profile/<domain>"
    // - "bsky.app/profile/<domain>" (rare but possible)
    if (href === hrefExact) {
      return true;
    }

    try {
      const u = new URL(href, window.location.origin);
      return u.pathname === hrefExact;
    } catch {
      return false;
    }
  });

  const mainCandidates = matches.filter((a) => !isElementInSidebarOrNav(a));
  return mainCandidates[0] || null;
}

function removeExistingBadge() {
  const wrapper = document.getElementById(BADGE_WRAPPER_ID);
  if (wrapper) {
    wrapper.remove();
    return;
  }

  const existing = document.getElementById(BADGE_ID);
  if (existing) {
    existing.remove();
  }
}

function removeExistingModal() {
  const backdrop = document.getElementById(MODAL_BACKDROP_ID);
  if (backdrop) {
    backdrop.remove();
  }
}

function showInfoModal({ isVerified, label, domain, queriedName, learnedText, extraLine, lookupError, matchedTxt }) {
  removeExistingModal();

  const backdrop = document.createElement("div");
  backdrop.id = MODAL_BACKDROP_ID;
  backdrop.className = "atproto-modal-backdrop";

  const modal = document.createElement("div");
  modal.id = MODAL_ID;
  modal.className = "atproto-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", `${label} details`);

  const detailsBlock = lookupError
    ? `<div class="atproto-modal-muted">Details: ${escapeHtml(String(lookupError))}</div>`
    : "";
  const matchedBlock = matchedTxt
    ? `<div class="atproto-modal-muted">Found matching DNS TXT that includes <code>did=</code>.</div>`
    : "";

  modal.innerHTML = `
    <div class="atproto-modal-header">
      <div class="atproto-modal-title">${label}</div>
      <button class="atproto-modal-close" type="button" aria-label="Close">×</button>
    </div>
    <div class="atproto-modal-body">
      <div class="atproto-modal-text">${learnedText}</div>
      <div class="atproto-modal-muted">Checked: ${escapeHtml(queriedName)}</div>
      <div class="atproto-modal-text">${extraLine}</div>
      ${matchedBlock}
      ${detailsBlock}
    </div>
    <div class="atproto-modal-actions">
      <a class="atproto-modal-link" href="${LEARN_MORE_URL}" target="_blank" rel="noreferrer">Learn more</a>
      <button class="atproto-modal-ok" type="button">Got it</button>
    </div>
  `;

  backdrop.appendChild(modal);
  document.documentElement.appendChild(backdrop);

  const closeBtn = modal.querySelector(".atproto-modal-close");
  const okBtn = modal.querySelector(".atproto-modal-ok");
  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      window.removeEventListener("keydown", onKeyDown);
      removeExistingModal();
    }
  };

  const close = () => {
    window.removeEventListener("keydown", onKeyDown);
    removeExistingModal();
  };

  closeBtn && closeBtn.addEventListener("click", close);
  okBtn && okBtn.addEventListener("click", close);

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      close();
    }
  });

  window.addEventListener("keydown", onKeyDown);
}

function renderBadge(result, domain) {
  try {
    const anchor = findHandleAnchor(domain);
    if (!anchor || !anchor.parentElement) {
      return false;
    }

    removeExistingBadge();

    const isVerified = Boolean(result && result.verified);
    const label = isVerified ? "Verified" : "Unverified";
    const icon = isVerified ? "✔" : "✖";

    const wrapper = document.createElement("span");
    wrapper.id = BADGE_WRAPPER_ID;
    wrapper.className = "atproto-badge-wrapper";

    const badge = document.createElement("button");
    badge.id = BADGE_ID;
    badge.className = isVerified
      ? "atproto-badge atproto-badge-verified"
      : "atproto-badge atproto-badge-unverified";
    badge.type = "button";
    badge.setAttribute("aria-label", `${label}. Learn more`);
    const normalText = `${icon} ${label}`;
    const hoverText = `${icon} Learn more`;
    badge.textContent = normalText;
    badge.addEventListener("mouseenter", () => {
      badge.textContent = hoverText;
    });
    badge.addEventListener("mouseleave", () => {
      badge.textContent = normalText;
    });

    const queriedName = result && result.queriedName ? result.queriedName : `_atproto.${domain}`;
    const learnedText = isVerified
      ? "Good news: DNS for this domain includes a proof that links it to a Bluesky identity."
      : result && result.error
        ? "We couldn’t check the DNS TXT record for this domain right now."
        : "We checked the DNS TXT record for this domain, but we didn’t find the proof we needed (did=).";

    const extraLine = isVerified
      ? "This badge means the domain has an identity proof in DNS."
      : "Unverified does not mean the profile is wrong—just that no DNS proof was found.";

    // Hover text (native browser tooltip) and clickable behavior.
    badge.title = "Learn more";

    badge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showInfoModal({
        isVerified,
        label,
        domain,
        queriedName,
        learnedText,
        extraLine,
        lookupError: result && result.error ? result.error : null,
        matchedTxt: result && result.matchedTxt ? result.matchedTxt : null
      });
    });

    wrapper.appendChild(badge);

    // Insert right after the handle element so the badge stays visually near the header.
    if (anchor.insertAdjacentElement) {
      anchor.insertAdjacentElement("afterend", wrapper);
    } else if (anchor.parentElement) {
      anchor.parentElement.insertBefore(wrapper, anchor.nextSibling);
    }
    return true;
  } catch (error) {
    // Avoid leaving the page in a broken state due to a UI crash.
    removeExistingBadge();
    return false;
  }
}

async function renderBadgeWithRetry(result, domain) {
  // Prevent overlapping retry loops for the same profile.
  if (renderRetryInFlight) {
    return;
  }

  renderRetryInFlight = true;
  try {
    // Retry insertion shortly in case the handle link/text hasn't been painted yet.
    for (let i = 0; i < 6; i += 1) {
      const inserted = renderBadge(result, domain);
      if (inserted) {
        return;
      }
      // Small backoff to wait for Bluesky SPA rendering.
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  } finally {
    renderRetryInFlight = false;
  }
}

async function verifyCurrentProfile() {
  try {
    const domain = getDomainFromUrl(window.location.href) || getDomainFromHandleText();
    if (!domain) {
      removeExistingBadge();
      return;
    }

    const badgeExists = Boolean(document.getElementById(BADGE_ID));

    if (domain === lastProcessedProfile && badgeExists) {
      return;
    }

    // If we already have DNS result for this profile but couldn't attach the badge yet,
    // don't re-run DNS lookup—just retry rendering.
    if (domain === lastVerificationDomain && lastVerificationResult && !badgeExists) {
      await renderBadgeWithRetry(lastVerificationResult, domain);
      lastProcessedProfile = domain;
      return;
    }

    lastProcessedProfile = domain;
    const result = await chrome.runtime.sendMessage({
      type: "VERIFY_BLUESKY_DOMAIN",
      domain
    });

    lastVerificationDomain = domain;
    lastVerificationResult = result;

    await renderBadgeWithRetry(result, domain);
  } catch (error) {
    // If messaging fails, don't break the rest of the page UI.
    removeExistingBadge();
  }
}

function installSpaWatchers() {
  if (mutationObserver) {
    mutationObserver.disconnect();
  }

  mutationObserver = new MutationObserver(() => {
    void verifyCurrentProfile();
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  const originalPushState = history.pushState;
  history.pushState = function pushStateWrapped(...args) {
    originalPushState.apply(this, args);
    void verifyCurrentProfile();
  };

  window.addEventListener("popstate", () => {
    void verifyCurrentProfile();
  });
}

function init() {
  installSpaWatchers();
  void verifyCurrentProfile();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
