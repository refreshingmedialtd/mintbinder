/* eslint-disable @typescript-eslint/no-require-imports */

require("dotenv/config");

const { createServer } = require("node:http");
const { parse } = require("node:url");
const next = require("next");

const appDir = __dirname;
const port = Number(cliArg("port") || process.env.PORT || process.env.NODE_PORT || 3000);
const hostname = cliArg("hostname") || process.env.APP_HOST || process.env.HOST || "127.0.0.1";
const dev = process.env.NODE_ENV === "development";

const app = next({ dev, dir: appDir, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((request, response) => {
    const parsedUrl = parse(request.url || "/", true);

    handle(request, response, parsedUrl);
  }).listen(port, hostname, () => {
    console.log(`Mint Binder listening on http://${hostname}:${port}`);
    console.log(`Mint Binder app directory: ${appDir}`);
    console.log(`Mint Binder working directory: ${process.cwd()}`);
    console.log(`Mint Binder mode: ${dev ? "development" : "production"}`);
  });
}).catch((error) => {
  console.error("Mint Binder failed to start.", error);
  process.exit(1);
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
