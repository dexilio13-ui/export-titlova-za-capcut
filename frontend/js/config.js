/**
 * Serbian Transcriber — frontend configuration.
 *
 * ⚠️  NEVER put API keys in this file. The Groq key lives ONLY on the backend.
 *
 * Change API_BASE_URL after deploying your backend (e.g. Render, Railway, Fly.io).
 * For local development with the backend on port 3000, "http://localhost:3000" works.
 * If you serve the frontend and backend from the same origin, use "" (empty string).
 */
window.APP_CONFIG = {
  API_BASE_URL: "http://localhost:3000",

  // Optional overrides — safe to leave as-is.
  APP_NAME: "Export titlova za CapCut",
};
