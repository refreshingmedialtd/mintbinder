/* eslint-disable @typescript-eslint/no-require-imports */

require("dotenv/config");

const { createServer } = require("node:http");
const { parse } = require("node:url");
const next = require("next");

const port = Number(cliArg("port") || process.env.PORT || process.env.NODE_PORT || 3000);
const hostname = cliArg("hostname") || process.env.APP_HOST || process.env.HOST || "127.0.0.1";
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

function cliArg(name) {
  const prefix = `--${name}=`;
  const inlineValue = process.argv.find((argument) => argument.startsWith(prefix));

  if (inlineValue) {
    return inlineValue.slice(prefix.length);
  }

  const index = process.argv.indexOf(`--${name}`);

  if (index !== -1) {
    return process.argv[index + 1];
  }

  return undefined;
}
