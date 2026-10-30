// Vercel Function for GET /api/nasa/sync/latest
import app from '../../../server';

export const config = { maxDuration: 30 };
export default app;
