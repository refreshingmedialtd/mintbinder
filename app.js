/* eslint-disable @typescript-eslint/no-require-imports */

require("dotenv/config");

const { timingSafeEqual } = require("node:crypto");
const { createServer } = require("node:http");
const tls = require("node:tls");
const { parse } = require("node:url");
const next = require("next");

const port = Number(process.env.PORT || process.env.NODE_PORT || 3000);
const hostname = process.env.APP_HOST || process.env.HOST || "127.0.0.1";
const dev = process.env.NODE_ENV !== "production";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((request, response) => {
    const parsedUrl = parse(request.url || "/", true);

    if (request.method === "POST" && parsedUrl.pathname === "/api/jobs/email-smoke") {
      handleEmailSmoke(request, response);
      return;
    }

    handle(request, response, parsedUrl);
  }).listen(port, hostname, () => {
    console.log(`Mint Binder listening on http://${hostname}:${port}`);
  });
});

async function handleEmailSmoke(request, response) {
  try {
    requireJobSecret(request);

    const to = requiredEnv("EMAIL_SMOKE_TO", "EMAIL_SMOKE_TO is not configured.");
    const from = requiredEnv("EMAIL_FROM", "EMAIL_FROM is not configured.");
    const body = await readJsonBody(request);
    const sentAt = new Date().toISOString();
    const origin = process.env.NEXT_PUBLIC_APP_URL || request.headers.host || "https://mintbinder.co.uk";
    const appUrl = origin.startsWith("http") ? origin : `https://${origin}`;
    const subject = stringValue(body.subject) || `Mint Binder production email smoke - ${sentAt}`;
    const note = stringValue(body.note) || "Triggered by the Mint Binder production smoke command.";
    const text = [
      "Mint Binder production email delivery is configured.",
      "",
      `App URL: ${appUrl}`,
      `Provider: smtp`,
      `Sent at: ${sentAt}`,
      note ? `Note: ${note}` : "",
    ].join("\n");
    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;">
        <h1 style="font-size:20px;margin:0 0 12px;">Mint Binder production email delivery is configured.</h1>
        <p>The deployed app can send transactional email.</p>
        <p><strong>App URL:</strong> ${escapeHtml(appUrl)}</p>
        <p><strong>Provider:</strong> smtp</p>
        <p><strong>Sent at:</strong> ${escapeHtml(sentAt)}</p>
        ${note ? `<p><strong>Note:</strong> ${escapeHtml(note)}</p>` : ""}
      </div>
    `;
    const emailId = await sendSmtpEmail({ from, html, subject, text, to });

    sendJson(response, 200, {
      emailId,
      ok: true,
      provider: "smtp",
      sentAt,
    });
  } catch (error) {
    sendJson(response, errorStatus(error), {
      error: error instanceof Error ? error.message : "Unable to run email smoke test.",
    });
  }
}

function requireJobSecret(request) {
  const expected = process.env.JOB_SECRET;

  if (!expected) {
    const error = new Error("JOB_SECRET is not configured.");
    error.statusCode = 501;
    throw error;
  }

  const provided = bearerToken(request.headers.authorization) || request.headers["x-job-secret"];

  if (!provided || !constantTimeEqual(provided, expected)) {
    const error = new Error("Job authentication failed.");
    error.statusCode = 401;
    throw error;
  }
}

function bearerToken(value) {
  if (!value || !value.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return value.slice(7).trim();
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function sendSmtpEmail({ from, html, subject, text, to }) {
  const host = requiredEnv("SMTP_HOST", "SMTP_HOST is not configured.");
  const user = requiredEnv("SMTP_USER", "SMTP_USER is not configured.");
  const pass = requiredEnv("SMTP_PASSWORD", "SMTP_PASSWORD is not configured.");
  const port = Number.parseInt(process.env.SMTP_PORT || "465", 10);
  const secure = booleanSetting(process.env.SMTP_SECURE, port === 465);

  if (!secure) {
    throw new Error("The app.js smoke sender currently requires SMTP_SECURE=true.");
  }

  const fromAddress = emailAddress(from);
  const toAddress = emailAddress(to);
  const messageId = `<${Date.now()}.${Math.random().toString(16).slice(2)}@mintbinder.co.uk>`;
  const boundary = `mintbinder-${Date.now().toString(16)}`;
  const rawMessage = [
    `From: ${sanitizeHeader(from)}`,
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${sanitizeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const socket = tls.connect({
    host,
    port,
    servername: host,
  });

  try {
    await waitForSocket(socket);
    await expectSmtp(socket, [220]);
    await smtpCommand(socket, `EHLO mintbinder.co.uk`, [250]);
    await smtpCommand(socket, "AUTH LOGIN", [334]);
    await smtpCommand(socket, Buffer.from(user).toString("base64"), [334]);
    await smtpCommand(socket, Buffer.from(pass).toString("base64"), [235]);
    await smtpCommand(socket, `MAIL FROM:<${fromAddress}>`, [250]);
    await smtpCommand(socket, `RCPT TO:<${toAddress}>`, [250, 251]);
    await smtpCommand(socket, "DATA", [354]);
    socket.write(`${dotStuff(rawMessage)}\r\n.\r\n`);
    await expectSmtp(socket, [250]);
    await smtpCommand(socket, "QUIT", [221]).catch(() => undefined);
  } finally {
    socket.end();
  }

  return messageId;
}

function smtpCommand(socket, command, expectedCodes) {
  const response = expectSmtp(socket, expectedCodes);
  socket.write(`${command}\r\n`);
  return response;
}

function expectSmtp(socket, expectedCodes) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || "";
      const match = last.match(/^(\d{3})\s/);

      if (!match) {
        return;
      }

      cleanup();
      const code = Number.parseInt(match[1], 10);

      if (expectedCodes.includes(code)) {
        resolve({ code, message: buffer });
      } else {
        reject(new Error(`SMTP command failed with ${code}: ${buffer.trim()}`));
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };

    socket.on("data", onData);
    socket.on("error", onError);
  });
}

function waitForSocket(socket) {
  return new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk.toString("utf8");

      if (body.length > 16_384) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function requiredEnv(name, message) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(message);
  }

  return value;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function emailAddress(value) {
  const match = value.match(/<([^>]+)>/);

  return (match ? match[1] : value).trim();
}

function sanitizeHeader(value) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function dotStuff(value) {
  return value.replace(/^\./gm, "..");
}

function booleanSetting(value, fallback) {
  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function errorStatus(error) {
  return error && typeof error.statusCode === "number" ? error.statusCode : 400;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (match) => {
    switch (match) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
