const express = require("express");
const path = require("path");
const dns = require("dns").promises;
const crypto = require("crypto");
const z = require("zod");

const { initDb } = require("./db");

const app = express();
const db = initDb();

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

function normalizeDomain(input) {
  const domain = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, ""); // strip trailing dot
  return domain;
}

function isValidDomain(domain) {
  // Conservative validator: hostname with labels.
  if (!domain || domain.length > 253) return false;
  if (!domain.includes(".")) return false;
  const labels = domain.split(".");
  return labels.every((label) => {
    if (label.length < 1 || label.length > 63) return false;
    if (!/^[a-z0-9-]+$/.test(label)) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    return true;
  });
}

function normalizeTxtRecord(rawData) {
  if (typeof rawData !== "string") return "";

  // DoH TXT answers are often quoted and may be chunked like: "part1" "part2".
  return rawData
    .replace(/\"\\s+\"/g, "")
    .replace(/^\"+|\"+$/g, "")
    .trim();
}

async function lookupTxtValues(txtName) {
  // Preferred: system resolver (fast, no HTTP). Fallback: DoH via dns.google.
  try {
    const answers = await dns.resolveTxt(txtName);
    return (answers || []).map((parts) => parts.join(""));
  } catch (err) {
    // Fallback to DNS-over-HTTPS to avoid local resolver restrictions.
    const url = `https://dns.google/resolve?name=${encodeURIComponent(txtName)}&type=TXT&ts=${Date.now()}`;
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/dns-json" },
    });
    if (!resp.ok) {
      throw err;
    }

    const data = await resp.json();
    const answerList = Array.isArray(data.Answer) ? data.Answer : [];
    const txtRecords = answerList
      .filter((record) => {
        const type = record && record.type;
        return type === 16 || String(type) === "16" || String(type).toUpperCase() === "TXT";
      })
      .map((record) => normalizeTxtRecord(record.data))
      .filter(Boolean);

    return txtRecords;
  }
}

const signupSchema = z.object({
  domain: z
    .string()
    .min(1)
    .transform(normalizeDomain)
    .refine((d) => isValidDomain(d), { message: "Invalid domain" }),
  email: z.string().min(3).email(),
  verificationMethod: z.enum(["domain_email", "personal_email_txt"]),
  frequencySeconds: z.number().int(),
});

const allowedFrequencySeconds = new Set([21600]);
for (let days = 1; days <= 14; days++) allowedFrequencySeconds.add(days * 86400);

// Re-verification of the TXT/domain state is scheduled daily (per spec).
const dnsReverificationSeconds = 24 * 60 * 60;

const signupSchemaWithFrequency = signupSchema.refine((v) => allowedFrequencySeconds.has(v.frequencySeconds), {
  message: "Invalid frequency option",
  path: ["frequencySeconds"],
});

app.post("/api/signup", async (req, res) => {
  const parsed = signupSchemaWithFrequency.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const { domain, email, verificationMethod, frequencySeconds } = parsed.data;
  const emailDomain = normalizeDomain(email.split("@")[1]);

  const monitorId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  if (verificationMethod === "domain_email") {
    if (emailDomain !== domain) {
      return res.status(400).json({
        error: "Email domain does not match the provided domain",
        details: { expectedDomain: domain, emailDomain },
      });
    }

    db.insertMonitor({
      id: monitorId,
      domain,
      email,
      verification_method: "domain_email",
      status: "verified",
      personal_txt_token: null,
      monitoring_interval_seconds: frequencySeconds,
      created_at: nowIso,
      verified_at: nowIso,
      next_check_at: new Date(Date.now() + dnsReverificationSeconds * 1000).toISOString(),
      note: "Saved immediately (domain email verification). Keep re-verifying the domain every day.",
    });

    return res.status(200).json({
      monitorId,
      status: "verified",
      domain,
      email,
      note: "Saved immediately (domain email verification). Keep re-verifying the domain every day.",
    });
  }

  if (verificationMethod === "personal_email_txt") {
    // Create a pending record and give the user the required TXT value.
    const token = crypto.randomBytes(16).toString("hex");
    const txtHost = `_seniorproject.${domain}`;

    db.insertMonitor({
      id: monitorId,
      domain,
      email,
      verification_method: "personal_email_txt",
      status: "pending",
      personal_txt_token: token,
      monitoring_interval_seconds: frequencySeconds,
      created_at: nowIso,
      verified_at: null,
      next_check_at: new Date(Date.now() + dnsReverificationSeconds * 1000).toISOString(),
      note: "TXT verification is required. After it matches, the domain will be marked verified and monitored at the configured interval.",
    });

    return res.status(200).json({
      monitorId,
      status: "pending",
      domain,
      email,
      verification: {
        txtHost,
        txtValue: token,
      },
      note: "Add the TXT record, then click Verify to confirm it."
    });
  }

  return res.status(400).json({ error: "Unsupported verificationMethod" });
});

const verifyTxtSchema = z.object({
  monitorId: z.string().min(1),
});

app.post("/api/verify-txt", async (req, res) => {
  const parsed = verifyTxtSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const { monitorId } = parsed.data;

  const row = db.getMonitorById(monitorId);
  if (!row) return res.status(404).json({ error: "Monitor not found" });

  if (row.verification_method !== "personal_email_txt") {
    return res.status(400).json({ error: "TXT verification only applies to personal_email_txt signups" });
  }

  if (row.status === "verified") {
    return res.status(200).json({
      monitorId,
      status: "verified",
      verifiedAt: row.verified_at,
      nextCheckAt: row.next_check_at,
    });
  }

  const domain = row.domain;
  const txtName = `_seniorproject.${domain}`;
  const expectedToken = row.personal_txt_token;

  let receivedValues;
  try {
    receivedValues = await lookupTxtValues(txtName);
  } catch (err) {
    return res.status(409).json({
      error: "TXT record not found yet",
      details: { name: txtName, expectedValue: expectedToken, code: err && err.code },
    });
  }

  const matched = (receivedValues || []).some((v) => v === expectedToken);

  if (!matched) {
    return res.status(409).json({
      error: "TXT record value does not match yet",
      details: { name: txtName, expectedValue: expectedToken, received: (receivedValues || []).slice(0, 5) },
    });
  }

  const nowIso = new Date().toISOString();
  const nextCheckAt = new Date(Date.now() + dnsReverificationSeconds * 1000).toISOString();
  db.updateMonitor(monitorId, (existing) => ({
    ...existing,
    status: "verified",
    verified_at: nowIso,
    next_check_at: nextCheckAt,
    note:
      (existing.note || "") +
      " Verified via TXT match. Keep re-verifying the domain every day.",
  }));

  return res.status(200).json({
    monitorId,
    status: "verified",
    verifiedAt: nowIso,
    nextCheckAt,
  });
});

app.get("/api/monitors", (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const rows = db
    .getAllMonitors()
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
  res.json({ monitors: rows });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Domain monitor service listening on http://localhost:${port}`);
});

