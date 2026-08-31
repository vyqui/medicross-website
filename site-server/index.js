import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { parse as parseToml } from 'smol-toml';

/* netlify.toml is the single hand-edited source of truth for every
   redirect and header rule (see the comment at its own top) — Cyberfolks
   reads a generated .htaccess, Cloudflare Pages a generated _redirects/
   _headers, and this Railway service just parses the TOML itself at boot,
   so there is nothing here to regenerate after an edit. */
const ROOT = path.resolve(import.meta.dirname, '..');
const cfg = parseToml(fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8'));

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* Same shape netlify.toml uses everywhere in this repo: a literal path,
   optionally ending in "/*" for a prefix match. Confirmed (see
   tools/build-htaccess.py) that "*" never appears anywhere else in a
   `from` value, so no general glob support is needed. */
function toRegex(from) {
  if (from.endsWith('*')) {
    const base = escapeRegex(from.slice(0, -1).replace(/\/$/, ''));
    return new RegExp(`^${base}(/.*)?$`);
  }
  return new RegExp(`^${escapeRegex(from)}$`);
}

const redirects = (cfg.redirects ?? []).map((r) => ({
  pattern: toRegex(r.from),
  to: r.to,
  status: r.status ?? 301,
}));

const headerBlocks = (cfg.headers ?? []).map((block) => ({
  pattern: toRegex(block.for),
  values: block.values ?? {},
}));

/* Unlike server/public/ (a curated copy of only the files the platform
   needs), this service points @fastify/static at the whole repository —
   the marketing site's ~350MB of images and video make a duplicated
   copy wasteful. That means netlify.toml, package.json, .htaccess,
   site-server/ itself etc. all physically exist under ROOT too, so
   without a gate they'd be served the same as any real page. Cyberfolks
   never had this problem (those files simply weren't uploaded) and
   Cloudflare solved it with .assetsignore; here it's this allowlist —
   closed by default, so a new non-page file dropped at the repo root
   stays hidden without anyone needing to remember to exclude it.
   Top-level pages are exactly "/name" or "/name.html" (matches this
   repo's own naming — lowercase, digits, dashes only); everything under
   assets/ or materials/ is fair game, plus the couple of well-known
   root files search engines expect. */
const TOP_LEVEL_PAGE = /^\/[a-z0-9-]+(\.html)?$/;
const ALLOWED_STATIC_PREFIX = /^\/(assets|materials)\//;
const ALLOWED_EXACT = new Set(['/', '/robots.txt', '/sitemap.xml']);
const HAS_DOTFILE_SEGMENT = /(^|\/)\.[^/]+/;

function isServable(urlPath) {
  if (HAS_DOTFILE_SEGMENT.test(urlPath)) return false;
  if (ALLOWED_EXACT.has(urlPath)) return true;
  if (ALLOWED_STATIC_PREFIX.test(urlPath)) return true;
  return TOP_LEVEL_PAGE.test(urlPath);
}

const app = Fastify({ logger: { level: 'info' } });

/* Redirect map first (WordPress cutover + the platform-page redirects),
   exactly like .htaccess: an exact/wildcard rule always wins over the
   generic clean-URL behaviour below it. Then the reverse direction for
   a real top-level page — a request for the literal ".html" file
   redirects to the extensionless URL, matching its own canonical tag.
   (Deliberately scoped to top-level pages only: materials/bodymap.html
   is embedded by its literal .html filename in an iframe and must not
   get redirected out from under it.) Finally, anything not servable at
   all goes straight to the 404 page instead of falling into
   @fastify/static and either serving or leaking a file it shouldn't. */
app.addHook('onRequest', async (request, reply) => {
  const urlPath = request.raw.url.split('?')[0];

  for (const r of redirects) {
    if (r.pattern.test(urlPath)) {
      return reply.code(r.status).redirect(r.to);
    }
  }

  if (TOP_LEVEL_PAGE.test(urlPath) && urlPath.endsWith('.html')) {
    return reply.code(301).redirect(urlPath.slice(0, -'.html'.length) || '/');
  }

  if (!isServable(urlPath)) {
    return reply.callNotFound();
  }
});

app.addHook('onSend', async (request, reply, payload) => {
  const urlPath = request.raw.url.split('?')[0];
  for (const block of headerBlocks) {
    if (block.pattern.test(urlPath)) {
      for (const [key, value] of Object.entries(block.values)) {
        reply.header(key, value);
      }
    }
  }
  return payload;
});

await app.register(fastifyStatic, {
  root: ROOT,
  index: ['index.html'],
  extensions: ['html'],
});

app.setNotFoundHandler((request, reply) => {
  reply.code(404).sendFile('404.html');
});

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    process.exit(0);
  });
}
