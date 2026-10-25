/**
 * Type declarations for the admin SPA, which lives under `public/admin` as
 * plain JavaScript.
 *
 * The SPA is deliberately build-free — it is served straight out of `public/`
 * by the assets binding, so there is no bundler and no `.ts` in that tree. It
 * is still type-*checked*: `tsconfig.admin.json` turns on `checkJs`, and this
 * file supplies the few globals the Worker injects into the shell.
 *
 * Kept out of `public/` on purpose: everything under `public/` is a deployed
 * asset, and a type declaration is not something a browser should be able to
 * fetch.
 */

interface Window {
  /**
   * The admin prefix, injected into `index.html` by `serveAdminIndex()`.
   *
   * `undefined` when the shell is loaded without the injection (a direct file
   * open, a test harness); `js/state.js` falls back to `/admin` in that case,
   * which is the default prefix rather than a guess.
   */
  CFP_ADMIN_BASE?: string;
  CFP?: any;
}

/**
 * One row in a `openDialog()` form.
 *
 * The dialog is the admin's only generic form builder, and every screen that
 * uses it builds the array by hand. Without a shared shape each call site
 * inferred its own union from the first literal it happened to write — which
 * is why pushing a `type: "select"` row onto an array that started with two
 * plain text rows was a type error even though `openDialog` handles both.
 */
type DialogFieldOption = string | { value: any; label: any };

interface DialogField {
  name: string;
  label: string;
  /** "text" (default) | "textarea" | "select" | "checkbox" | "number" */
  type?: string;
  value?: any;
  options?: DialogFieldOption[];
  placeholder?: string;
  required?: boolean;
  /** Rendered as the control's  attribute; nothing else reads it. */
  disabled?: boolean;
  hint?: string;
}
