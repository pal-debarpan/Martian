// Vercel Function for GET /api/nasa/mars2020/raw
import app from '../../../server';

export const config = { maxDuration: 30 };
export default app;
