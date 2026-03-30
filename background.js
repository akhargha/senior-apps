function normalizeTxtRecord(rawData) {
  if (typeof rawData !== "string") {
    return "";
  }

  // DoH TXT answers are often quoted and may be chunked like: "part1" "part2".
  return rawData
    .replace(/"\s+"/g, "")
    .replace(/^"+|"+$/g, "")
    .trim();
}

function isTxtRecord(record) {
  const type = record && record.type;
  return type === 16 || String(type) === "16" || String(type).toUpperCase() === "TXT";
}

function extractTxtRecords(answerList) {
  return answerList
    .filter((record) => record && isTxtRecord(record))
    .map((record) => normalizeTxtRecord(record.data))
    .filter(Boolean);
}

async function verifyDomainHandle(domain) {
  const trimmedDomain = String(domain || "").trim().toLowerCase();
  if (!trimmedDomain) {
    return {
      verified: false,
      matchedTxt: null,
      queriedName: null,
      error: "Missing domain"
    };
  }

  const queriedName = `_atproto.${trimmedDomain}`;
  const url = `https://dns.google/resolve?name=${encodeURIComponent(queriedName)}&type=TXT`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/dns-json"
      }
    });

    if (!response.ok) {
      return {
        verified: false,
        matchedTxt: null,
        queriedName,
        error: `Lookup failed: HTTP ${response.status}`
      };
    }

    const data = await response.json();
    const answerList = Array.isArray(data.Answer) ? data.Answer : [];
    const txtRecords = extractTxtRecords(answerList);

    const matchedTxt = txtRecords.find((record) => record.toLowerCase().includes("did=")) || null;

    return {
      verified: Boolean(matchedTxt),
      matchedTxt,
      queriedName,
      error: null
    };
  } catch (error) {
    return {
      verified: false,
      matchedTxt: null,
      queriedName,
      error: `Lookup failed: ${error instanceof Error ? error.message : "Unknown error"}`
    };
  }
}

async function verifyGithubOrgDomain(org, domain) {
  const trimmedOrg = String(org || "").trim().toLowerCase();
  const trimmedDomain = String(domain || "").trim().toLowerCase();

  if (!trimmedOrg) {
    return {
      verified: false,
      queriedName: null,
      txtRecords: [],
      error: "Missing organization"
    };
  }

  if (!trimmedDomain) {
    return {
      verified: false,
      queriedName: null,
      txtRecords: [],
      error: "Missing domain"
    };
  }

  const queriedName = `_gh-${trimmedOrg}-o.${trimmedDomain}`;
  const url = `https://dns.google/resolve?name=${encodeURIComponent(queriedName)}&type=TXT&ts=${Date.now()}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/dns-json"
      }
    });

    if (!response.ok) {
      return {
        verified: false,
        queriedName,
        txtRecords: [],
        error: `Lookup failed: HTTP ${response.status}`
      };
    }

    const data = await response.json();
    const answerList = Array.isArray(data.Answer) ? data.Answer : [];
    const txtRecords = extractTxtRecords(answerList);

    return {
      verified: txtRecords.length > 0,
      queriedName,
      txtRecords,
      error: null
    };
  } catch (error) {
    return {
      verified: false,
      queriedName,
      txtRecords: [],
      error: `Lookup failed: ${error instanceof Error ? error.message : "Unknown error"}`
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === "VERIFY_BLUESKY_DOMAIN") {
    verifyDomainHandle(message.domain).then((result) => sendResponse(result));
    return true;
  }

  if (message.type === "VERIFY_GITHUB_ORG_DOMAIN") {
    verifyGithubOrgDomain(message.org, message.domain).then((result) => sendResponse(result));
    return true;
  }

  return false;
});
