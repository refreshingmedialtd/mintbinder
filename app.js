/* eslint-disable @typescript-eslint/no-require-imports */

const { createServer } = require("node:http");
const { parse } = require("node:url");
const next = require("next");

const port = Number(process.env.PORT || process.env.NODE_PORT || 3000);
const hostname = process.env.HOSTNAME || process.env.HOST || "127.0.0.1";
const dev = process.env.NODE_ENV !== "production";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((request, response) => {
    const parsedUrl = parse(request.url || "/", true);
    handle(request, response, parsedUrl);
  }).listen(port, hostname, () => {
    console.log(`Mint Binder listening on http://${hostname}:${port}`);
  });
});
