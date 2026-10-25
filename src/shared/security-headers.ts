/**
 * Security response headers — **one writer**.
 *
 * The Worker answers from a dozen places (pages, feeds, sitemaps, the admin
 * SPA, the admin API, media, redirects), and before this module none of them
 * set a single security header. That is not a crash; it is a CMS whose whole
 * pitch is "the smallest attack surface" answering with the browser defaults.
 *
 * Applying the headers at the top of `fetch()` is the only way to get all of
 * them: a helper called from each route is a list someone forgets to extend,
 * and the routes that forget are the ones nobody looks at.
 *
 * ## What is deliberately permissive, and why
 *
 * - **`script-src 'unsafe-inline'`.** The admin publishes 17 inline `onclick`
 *   handlers through `WINDOW_HANDLERS`, and every bundled theme ships inline
 *   `<script>`. Removing it needs a nonce threaded through the template engine,
 *   which is a separate project. Even with it, this policy still blocks
 *   *external* script loads, which is the realistic injection path here.
 *
 * - **`img-src https:`.** Bundled themes reference `upload.wikimedia.org`, and
 *   the media library can be pointed at imgbb / postimages.org. Restricting to
 *   `'self'` would blank those images with no error anywhere.
 *
 * - **The Google ad hosts.** The ad-insertion plugin's own sample code tells
 *   the operator to paste `pagead2.googlesyndication.com`. A policy that blocks
 *   the feature the product documents is a regression wearing a security hat.
 *
 * - **`frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`, not `none`.**
 *   The widgets screen previews a page in an iframe served from the same
 *   origin; `none`/`DENY` would silently blank that canvas. Cross-origin
 *   framing is still refused.
 *
 * ## What this does not do
 *
 * It does not stop stored XSS from inline script in a post body — `'unsafe-inline'`
 * allows that by construction. Content is rendered through a restricted engine,
 * but the `none` template path renders raw HTML on purpose, and members can
 * author. That is a content-trust question, not a header question.
 */

/** Joined once; `withSecurityHeaders` runs on every response. */
const CSP = [
  "default-src 'self'",
  // See the module comment: inline handlers in the admin and inline scripts in
  // every bundled theme. External script loads are still blocked except the ad
  // hosts the ad-insertion plugin's own sample code asks the operator to paste.
  // Listed one host at a time rather than with a wildcard: the comment-marker
  // guard in `architecture.test.mjs` counts block-comment openers literally, and
  // a wildcard host is a slash followed by an asterisk — which reads as one.
  "script-src 'self' 'unsafe-inline' https://pagead2.googlesyndication.com https://tpc.googlesyndication.com https://www.googletagservices.com https://adservice.google.com https://googleads.g.doubleclick.net https://securepubads.g.doubleclick.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/**
 * Return a copy of `res` carrying the platform's security headers.
 *
 * ⚠️ **This must never turn a working response into a 500.** Two shapes defeat
 * the obvious implementation, and both were found by injecting a defect and
 * watching a suite abort rather than go red:
 *
 *   1. **Immutable headers.** `Response` objects produced by the runtime
 *      (redirects, asset responses) reject `headers.set`, so the headers are
 *      applied to a copy instead.
 *   2. **A locked body.** `new Response(res.body, res)` throws
 *      `Response body object should not be disturbed or locked`. A route that
 *      hands back an already-consumed body is broken on its own, but the
 *      security layer must not be the thing that converts it into a 500 with a
 *      stack trace — that hides the real defect behind this one.
 *
 * So: mutate when possible, copy when the headers are immutable, and hand the
 * response back untouched when even the copy is impossible. Headers are
 * best-effort by construction; a request that still answers is worth more than
 * one that answers with every header and no page.
 */
export function withSecurityHeaders(res: Response, request: Request): Response {
  const apply = (target: Response) => {
    target.headers.set("X-Content-Type-Options", "nosniff");
    target.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    target.headers.set("X-Frame-Options", "SAMEORIGIN");
    target.headers.set("Content-Security-Policy", CSP);
    // HSTS on a plain-http response is ignored by browsers, but sending it there
    // makes local `wrangler dev` output look like production and hides the one
    // environment where the header matters. Only claim it over TLS.
    if (new URL(request.url).protocol === "https:") {
      target.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    return target;
  };

  try {
    return apply(res);
  } catch {
    try {
      return apply(new Response(res.body, res));
    } catch {
      return res;
    }
  }
}

/** Exported for the contract suite: the policy is asserted, not just shipped. */
export const CONTENT_SECURITY_POLICY = CSP;
