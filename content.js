const BADGE_ID = "atproto-domain-verification-badge";
const BADGE_WRAPPER_ID = "atproto-domain-verification-badge-wrapper";
const MODAL_BACKDROP_ID = "atproto-domain-verification-modal-backdrop";
const MODAL_ID = "atproto-domain-verification-modal";
const PROFILE_PATH_PREFIX = "/profile/";
const LEARN_MORE_URL = "https://www.google.com/site_name";

let lastProcessedKey = "";
let lastVerificationKey = "";
let lastVerificationResult = null;
let renderRetryInFlight = false;
let mutationObserver = null;
let historyWrapped = false;

function escapeHtml(input) {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isValidDomainLike(maybeDomain, options = {}) {
  const domain = String(maybeDomain || "").trim().toLowerCase();
  if (!domain) return false;

  if (!options.allowBskySocial) {
    if (domain === "bsky.social" || domain.endsWith(".bsky.social")) {
      return false;
    }
  }

  if (!domain.includes(".")) return false;
  if (domain.length > 253) return false;

  const labels = domain.split(".");
  if (labels.some((l) => !l)) return false;

  const labelRe = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  const tld = labels[labels.length - 1];
  if (tld.length < 2) return false;
  return labels.every((label) => labelRe.test(label));
}

function normalizeHandleText(text) {
  return String(text || "")
    .replace(/\u200B/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isElementVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function isElementInSidebarOrNav(el) {
  if (!el || !el.closest) {
    return false;
  }
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

function removeExistingBadge() {
  const wrapper = document.getElementById(BADGE_WRAPPER_ID);
  if (wrapper) wrapper.remove();

  const existing = document.getElementById(BADGE_ID);
  if (existing) existing.remove();
}

function removeExistingModal() {
  const backdrop = document.getElementById(MODAL_BACKDROP_ID);
  if (backdrop) backdrop.remove();
}

function showInfoModal({ label, learnedText, extraLine, checkedLine, detailsHtml, lookupError }) {
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

  const checkedBlock = checkedLine
    ? `<div class="atproto-modal-muted">Checked: ${escapeHtml(checkedLine)}</div>`
    : "";
  const detailsBlock = detailsHtml ? `<div class="atproto-modal-muted">${detailsHtml}</div>` : "";
  const errorBlock = lookupError
    ? `<div class="atproto-modal-muted">Details: ${escapeHtml(String(lookupError))}</div>`
    : "";

  modal.innerHTML = `
    <div class="atproto-modal-header">
      <div class="atproto-modal-title">${label}</div>
      <button class="atproto-modal-close" type="button" aria-label="Close">×</button>
    </div>
    <div class="atproto-modal-body">
      <div class="atproto-modal-text">${learnedText}</div>
      ${checkedBlock}
      <div class="atproto-modal-text">${extraLine}</div>
      ${detailsBlock}
      ${errorBlock}
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
    if (e.target === backdrop) close();
  });
  window.addEventListener("keydown", onKeyDown);
}

function getDomainFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (!url.pathname.startsWith(PROFILE_PATH_PREFIX)) return null;

    const profileSegment = url.pathname.slice(PROFILE_PATH_PREFIX.length).split("/")[0];
    if (!profileSegment) return null;

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
  if (!handleNode || !handleNode.textContent) return null;

  const candidate = handleNode.textContent.replace(/^@/, "").trim().toLowerCase();
  return isValidDomainLike(candidate) ? candidate : null;
}

function findBlueskyProfileLinkAnchor(domain) {
  const hrefExact = `/profile/${domain}`;
  const mainElement = document.querySelector("main");
  if (!mainElement) return null;

  const anchors = Array.from(mainElement.querySelectorAll("a[href]"));
  const matches = anchors.filter((a) => {
    const href = a.getAttribute("href") || "";
    if (!href) return false;
    if (href === hrefExact) return true;

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

function findBlueskyHandleAnchor(domain) {
  const atDomain = `@${domain}`;
  const mainElement = document.querySelector("main");
  if (!mainElement) return null;

  const exactCandidates = Array.from(
    mainElement.querySelectorAll('[data-testid="profileHeaderDisplayName"], div[dir="auto"], span[dir="auto"]')
  ).filter((el) => {
    if (!el || !el.textContent) return false;
    if (!isElementVisible(el) || isElementInSidebarOrNav(el)) return false;

    const normalized = normalizeHandleText(el.textContent);
    const normalizedNoAt = normalized.startsWith("@") ? normalized.slice(1) : normalized;
    return normalized === atDomain || normalized === domain || normalizedNoAt === domain;
  });

  if (exactCandidates.length > 0) {
    const best = exactCandidates
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { el, width: rect.width || 0, top: rect.top || 0 };
      })
      .sort((a, b) => (b.width - a.width) || (a.top - b.top))[0];
    return best ? best.el : exactCandidates[0];
  }

  const containsCandidates = Array.from(mainElement.querySelectorAll("span, div")).filter((el) => {
    if (!el || !el.textContent) return false;
    if (!isElementVisible(el) || isElementInSidebarOrNav(el)) return false;
    const normalized = normalizeHandleText(el.textContent);
    return normalized.includes(atDomain) || normalized.includes(domain);
  });

  if (containsCandidates.length > 0) return containsCandidates[0];

  const profileLink = findBlueskyProfileLinkAnchor(domain);
  if (profileLink) return profileLink;

  return Array.from(mainElement.querySelectorAll("span, div, a")).find((el) => {
    if (!el || !el.textContent) return false;
    if (!isElementVisible(el) || isElementInSidebarOrNav(el)) return false;
    const normalized = normalizeHandleText(el.textContent);
    return normalized.includes(atDomain) || normalized.includes(domain);
  }) || null;
}

function getGithubOrgFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (url.hostname !== "github.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;

    if (parts[0].toLowerCase() === "orgs" && parts[1]) {
      return parts[1].toLowerCase();
    }

    const reserved = new Set([
      "about", "account", "codespaces", "collections", "contact", "copilot", "customers",
      "dashboard", "enterprise", "events", "explore", "features", "gist", "global", "home",
      "issues", "login", "marketplace", "new", "notifications", "orgs", "pricing", "pulls",
      "repositories", "search", "security", "settings", "signup", "site", "sponsors", "topics",
      "trending"
    ]);
    const first = parts[0].toLowerCase();
    if (reserved.has(first)) return null;
    return first;
  } catch {
    return null;
  }
}

function isGithubOrgPage() {
  if (window.location.hostname !== "github.com") return false;

  const hovercardMeta = document.querySelector('meta[name="hovercard-subject-tag"]');
  if (hovercardMeta && String(hovercardMeta.content || "").startsWith("organization:")) {
    return true;
  }

  return Boolean(document.querySelector('[itemtype="http://schema.org/Organization"]'));
}

function parseDomainFromHref(hrefValue) {
  if (!hrefValue) return null;
  try {
    const url = new URL(hrefValue, window.location.origin);
    const host = String(url.hostname || "").trim().toLowerCase();
    return isValidDomainLike(host, { allowBskySocial: true }) ? host : null;
  } catch {
    return null;
  }
}

function getGithubWebsiteDomain() {
  const websiteLink = document.querySelector(
    'main header.orghead a[itemprop="url"], main header.orghead a[rel~="nofollow"][href^="http"]'
  );
  if (!websiteLink) return null;
  return parseDomainFromHref(websiteLink.getAttribute("href"));
}

function getGithubVerifiedDomainsFromHeader() {
  const domains = new Set();
  const verifiedDetails = Array.from(
    document.querySelectorAll("main header.orghead details")
  ).filter((details) => {
    const summary = details.querySelector("summary");
    if (!summary) return false;
    const title = String(summary.getAttribute("title") || "");
    const text = String(summary.textContent || "");
    return /verified/i.test(title) || /verified/i.test(text);
  });

  verifiedDetails.forEach((details) => {
    Array.from(details.querySelectorAll("strong, li")).forEach((node) => {
      const text = normalizeHandleText(node.textContent || "").toLowerCase();
      if (!text) return;

      const candidates = text.match(/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/g) || [];
      candidates.forEach((candidate) => {
        if (isValidDomainLike(candidate, { allowBskySocial: true })) {
          domains.add(candidate);
        }
      });
    });
  });

  return Array.from(domains);
}

function getGithubCandidateDomains() {
  const out = new Set();
  const websiteDomain = getGithubWebsiteDomain();
  if (websiteDomain) out.add(websiteDomain);
  getGithubVerifiedDomainsFromHeader().forEach((domain) => out.add(domain));
  return Array.from(out).sort();
}

function findGithubOrgAnchor() {
  const main = document.querySelector("main");
  if (!main) return null;

  const candidates = [
    ...Array.from(main.querySelectorAll("header.orghead h1")),
    ...Array.from(main.querySelectorAll('[itemtype="http://schema.org/Organization"] header h1')),
    ...Array.from(main.querySelectorAll("h1.h2")),
    ...Array.from(main.querySelectorAll("h1"))
  ].filter((el, idx, arr) => arr.indexOf(el) === idx);

  const visible = candidates.filter((el) => isElementVisible(el) && !isElementInSidebarOrNav(el));
  if (visible.length > 0) return visible[0];
  return null;
}

function buildGithubModalDetailsHtml(domainResults) {
  const rows = domainResults.map((item) => {
    const icon = item.verified ? "✔" : "✖";
    const status = item.verified ? "Verified" : "Unverified";
    const line = `${icon} ${escapeHtml(item.domain)} - ${status}`;
    const sub = escapeHtml(item.queriedName || `_gh-?-o.${item.domain}`);
    const err = item.error ? ` (${escapeHtml(item.error)})` : "";
    return `<li>${line}<br><span style="opacity:0.9">Checked: ${sub}${err}</span></li>`;
  });
  return `<ul>${rows.join("")}</ul>`;
}

function renderBadge(result) {
  try {
    let anchor = null;
    if (result.site === "bluesky") {
      anchor = findBlueskyHandleAnchor(result.domain);
    } else if (result.site === "github") {
      anchor = findGithubOrgAnchor();
    }
    if (!anchor || !anchor.parentElement) return false;

    removeExistingBadge();
    const isVerified = Boolean(result.verified);
    const label = isVerified ? "Verified" : "Unverified";
    const icon = isVerified ? "✔" : "✖";

    const wrapper = document.createElement("span");
    wrapper.id = BADGE_WRAPPER_ID;
    wrapper.className = "atproto-badge-wrapper";

    const badge = document.createElement("button");
    badge.id = BADGE_ID;
    badge.type = "button";
    badge.className = isVerified
      ? "atproto-badge atproto-badge-verified"
      : "atproto-badge atproto-badge-unverified";
    badge.setAttribute("aria-label", `${label}. Learn more`);

    const normalText = `${icon} ${label}`;
    const hoverText = `${icon} Learn more`;
    badge.textContent = normalText;
    badge.title = "Learn more";
    badge.addEventListener("mouseenter", () => {
      badge.textContent = hoverText;
    });
    badge.addEventListener("mouseleave", () => {
      badge.textContent = normalText;
    });

    badge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (result.site === "github") {
        const learnedText = isVerified
          ? "Good news: every discovered organization domain has the required GitHub TXT record."
          : "One or more discovered organization domains are missing the required GitHub TXT record.";
        const extraLine = "We check TXT records at _gh-[org]-o.[domain] for each discovered domain.";
        showInfoModal({
          label,
          learnedText,
          extraLine,
          checkedLine: `org=${result.org}`,
          detailsHtml: buildGithubModalDetailsHtml(result.domainResults || [])
        });
        return;
      }

      const queriedName = result.queriedName || `_atproto.${result.domain}`;
      const learnedText = isVerified
        ? "Good news: DNS for this domain includes a proof that links it to a Bluesky identity."
        : result.error
          ? "We could not check the DNS TXT record for this domain right now."
          : "We checked the DNS TXT record for this domain, but we did not find the proof we needed (did=).";
      const extraLine = isVerified
        ? "This badge means the domain has an identity proof in DNS."
        : "Unverified does not mean the profile is wrong, only that no DNS proof was found.";
      const detailsHtml = result.matchedTxt
        ? `<div>Found matching DNS TXT that includes <code>did=</code>.</div>`
        : "";

      showInfoModal({
        label,
        learnedText,
        extraLine,
        checkedLine: queriedName,
        detailsHtml,
        lookupError: result.error || null
      });
    });

    wrapper.appendChild(badge);
    if (anchor.insertAdjacentElement) {
      anchor.insertAdjacentElement("afterend", wrapper);
    } else {
      anchor.parentElement.insertBefore(wrapper, anchor.nextSibling);
    }
    return true;
  } catch {
    removeExistingBadge();
    return false;
  }
}

async function renderBadgeWithRetry(result) {
  if (renderRetryInFlight) return;
  renderRetryInFlight = true;
  try {
    for (let i = 0; i < 6; i += 1) {
      const inserted = renderBadge(result);
      if (inserted) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  } finally {
    renderRetryInFlight = false;
  }
}

function isBlueskyPage() {
  return window.location.hostname === "bsky.app";
}

function isGithubPage() {
  return window.location.hostname === "github.com";
}

async function verifyBlueskyProfile() {
  const domain = getDomainFromUrl(window.location.href) || getDomainFromHandleText();
  if (!domain) {
    removeExistingBadge();
    return;
  }

  const key = `bsky:${domain}`;
  const badgeExists = Boolean(document.getElementById(BADGE_ID));
  if (key === lastProcessedKey && badgeExists) return;

  if (key === lastVerificationKey && lastVerificationResult && !badgeExists) {
    await renderBadgeWithRetry(lastVerificationResult);
    lastProcessedKey = key;
    return;
  }

  lastProcessedKey = key;
  const response = await chrome.runtime.sendMessage({
    type: "VERIFY_BLUESKY_DOMAIN",
    domain
  });

  const result = {
    site: "bluesky",
    domain,
    verified: Boolean(response && response.verified),
    queriedName: response && response.queriedName ? response.queriedName : `_atproto.${domain}`,
    error: response && response.error ? response.error : null,
    matchedTxt: response && response.matchedTxt ? response.matchedTxt : null
  };

  lastVerificationKey = key;
  lastVerificationResult = result;
  await renderBadgeWithRetry(result);
}

async function verifyGithubOrganization() {
  if (!isGithubOrgPage()) {
    removeExistingBadge();
    return;
  }

  const org = getGithubOrgFromUrl(window.location.href);
  if (!org) {
    removeExistingBadge();
    return;
  }

  const domains = getGithubCandidateDomains();
  if (domains.length === 0) {
    removeExistingBadge();
    return;
  }

  const key = `gh:${org}:${domains.join(",")}`;
  const badgeExists = Boolean(document.getElementById(BADGE_ID));
  if (key === lastProcessedKey && badgeExists) return;

  if (key === lastVerificationKey && lastVerificationResult && !badgeExists) {
    await renderBadgeWithRetry(lastVerificationResult);
    lastProcessedKey = key;
    return;
  }

  lastProcessedKey = key;
  const checks = await Promise.all(
    domains.map(async (domain) => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "VERIFY_GITHUB_ORG_DOMAIN",
          org,
          domain
        });
        return {
          domain,
          verified: Boolean(response && response.verified),
          queriedName: response && response.queriedName ? response.queriedName : `_gh-${org}-o.${domain}`,
          error: response && response.error ? response.error : null
        };
      } catch (error) {
        return {
          domain,
          verified: false,
          queriedName: `_gh-${org}-o.${domain}`,
          error: error instanceof Error ? error.message : "Lookup failed"
        };
      }
    })
  );

  const result = {
    site: "github",
    org,
    domains,
    domainResults: checks,
    verified: checks.length > 0 && checks.every((item) => item.verified)
  };

  lastVerificationKey = key;
  lastVerificationResult = result;
  await renderBadgeWithRetry(result);
}

async function verifyCurrentProfile() {
  try {
    if (isBlueskyPage()) {
      await verifyBlueskyProfile();
      return;
    }

    if (isGithubPage()) {
      await verifyGithubOrganization();
      return;
    }

    removeExistingBadge();
  } catch {
    removeExistingBadge();
  }
}

function installSpaWatchers() {
  if (mutationObserver) mutationObserver.disconnect();

  mutationObserver = new MutationObserver(() => {
    void verifyCurrentProfile();
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });

  if (!historyWrapped) {
    const originalPushState = history.pushState;
    history.pushState = function pushStateWrapped(...args) {
      originalPushState.apply(this, args);
      void verifyCurrentProfile();
    };
    historyWrapped = true;
  }

  window.addEventListener("popstate", () => void verifyCurrentProfile());
  window.addEventListener("turbo:render", () => void verifyCurrentProfile());
  window.addEventListener("turbo:load", () => void verifyCurrentProfile());
  window.addEventListener("pjax:end", () => void verifyCurrentProfile());
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
