function normalizeTxtRecord(rawData) {
  if (typeof rawData !== "string") {
    return "";
  }

  // DoH TXT answers are usually returned with quoted strings.
  return rawData.replace(/^"+|"+$/g, "").trim();
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
    const txtRecords = answerList
      .filter((record) => record && record.type === 16)
      .map((record) => normalizeTxtRecord(record.data))
      .filter(Boolean);

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "VERIFY_BLUESKY_DOMAIN") {
    return false;
  }

  verifyDomainHandle(message.domain).then((result) => sendResponse(result));
  return true;
});
