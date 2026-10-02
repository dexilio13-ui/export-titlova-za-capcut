'use strict';

/**
 * Serbian Transcriber — Express server entry point.
 *
 * Secrets live ONLY here (process.env.GROQ_API_KEY). The server exposes:
 *   GET  /api/health
 *   POST /api/transcribe   (multipart/form-data: video, [language])
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const { corsMiddleware } = require('./middleware/cors');
const { notFound, errorHandler } = require('./middleware/errors');
const transcribeRoutes = require('./routes/transcribe');
const { sweepOldFiles } = require('./utils/tempFiles');
const logger = require('./utils/logger');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(corsMiddleware);
app.use('/api', transcribeRoutes);

app.use(notFound);
app.use(errorHandler);

// Remove stale temp files from any previous crashed run.
sweepOldFiles();

const server = app.listen(PORT, () => {
  logger.info(`Serbian Transcriber API listening on port ${PORT}`, {
    env: process.env.NODE_ENV || 'development',
    groqKeyConfigured: Boolean(process.env.GROQ_API_KEY),
  });
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    logger.info(`${sig} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
