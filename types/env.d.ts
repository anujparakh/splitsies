// Secrets are set with `wrangler secret put`, not declared in wrangler.jsonc,
// so `wrangler types` cannot see them. Declare them here by interface merging
// onto the generated `Env` so the Worker gets type-safe access.
declare global {
  interface Env {
    /** HMAC key for password hashing. See DEPLOYMENT.md. */
    PASSWORD_PEPPER: string;
    /** HMAC key for signing session cookies. Rotating it logs everyone out. */
    SESSION_SECRET: string;
  }

  namespace Cloudflare {
    interface Env {
      PASSWORD_PEPPER: string;
      SESSION_SECRET: string;
    }
  }
}

export {};
