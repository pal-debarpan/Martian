// Vercel Function for GET /api/sources/health
import app from '../../server';

export const config = { maxDuration: 30 };
export default app;
