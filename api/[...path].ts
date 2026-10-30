// Vercel file-system function entry point for every /api/* request.
// Keeping this separate from the Vite SPA fallback prevents API requests from
// being answered by index.html (and consequently parsed as JSON by the client).
import app from '../server';

export default app;
