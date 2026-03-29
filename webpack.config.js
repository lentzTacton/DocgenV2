const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const devCerts = require('office-addin-dev-certs');

module.exports = async (env, argv) => {
const isDev = argv.mode !== 'production';

// Get trusted HTTPS certs for local dev (installs CA into OS trust store).
// Skip when just building (no devServer needed) or if env.noCert is set.
// Grab HTTPS certs for the local dev server (installs CA into OS trust store)
const httpsOptions = isDev ? await devCerts.getHttpsServerOptions() : {};

return {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.[contenthash:8].js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: 'babel-loader',
      },
      {
        test: /\.css$/,
        use: [
          isDev ? 'style-loader' : MiniCssExtractPlugin.loader,
          'css-loader',
        ],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/index.html',
      filename: 'taskpane.html',
    }),
    new MiniCssExtractPlugin({
      filename: 'styles.[contenthash:8].css',
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: 'assets', to: 'assets', noErrorOnMissing: true },
        { from: 'manifest.xml', to: 'manifest.xml' },
      ],
    }),
  ],
  devServer: {
    static: path.resolve(__dirname, 'dist'),
    port: 3000,
    server: isDev ? { type: 'https', options: httpsOptions } : 'https',
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
    },
    hot: true,

    // ── Server-side middleware for OAuth token endpoints ──────────
    // The browser calls these endpoints; Node.js calls Tacton directly,
    // avoiding CORS entirely.
    setupMiddlewares: (middlewares, devServer) => {
      const express = require('express');

      // ── Shared helper: POST to a Tacton /oauth2/token endpoint ──
      async function fetchTactonToken(tokenUrl, params, log) {
        const response = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(params).toString(),
        });
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { error: text.substring(0, 200) }; }

        if (response.ok && data.access_token) {
          log('32', `Token obtained (expires_in=${data.expires_in}s) from ${tokenUrl}`);
          return {
            ok: true,
            token: data.access_token,
            refreshToken: data.refresh_token || null,
            expiresIn: data.expires_in ?? 3600,
          };
        }
        const err = data.error_description || data.error || `HTTP ${response.status}`;
        log('31', `Token failed from ${tokenUrl}: ${err}`);
        return { ok: false, status: response.status, error: err };
      }

      const log = (color, ...args) => console.log(`\x1b[${color}m[DocGen]\x1b[0m`, ...args);

      // Register JSON body parser + routes directly on the Express app
      // (same pattern as original DocgenPlugin — ensures routes fire before
      // webpack's static-file / fallback middleware)
      devServer.app.use(express.json());

      // ── /verify-connection — admin-level client_credentials token ──
      devServer.app.post('/verify-connection', async (req, res) => {
        const { instanceUrl, clientId, clientSecret } = req.body || {};
        if (!instanceUrl || !clientId || !clientSecret) {
          return res.status(400).json({ ok: false, error: 'instanceUrl, clientId and clientSecret are required' });
        }

        const tokenUrl = `${instanceUrl.replace(/\/+$/, '')}/oauth2/token`;
        log('36', `POST ${tokenUrl}`);

        try {
          const result = await fetchTactonToken(tokenUrl, {
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'api',
          }, log);
          if (result.ok) return res.json(result);
          return res.status(result.status || 401).json({ ok: false, error: result.error });
        } catch (err) {
          log('31', `Network error: ${err.message}`);
          res.status(502).json({ ok: false, error: err.message });
        }
      });

      // ── /ticket-token — ticket-scoped client_credentials token ──
      devServer.app.post('/ticket-token', async (req, res) => {
        const { instanceUrl, ticketId, clientId, clientSecret } = req.body || {};
        if (!instanceUrl || !ticketId || !clientId || !clientSecret) {
          return res.status(400).json({ ok: false, error: 'instanceUrl, ticketId, clientId and clientSecret are required' });
        }

        const tokenUrl = `${instanceUrl.replace(/\/+$/, '')}/!tickets~${ticketId}/oauth2/token`;
        log('36', `POST ${tokenUrl} (ticket-scoped)`);

        try {
          const result = await fetchTactonToken(tokenUrl, {
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'api',
          }, log);
          if (result.ok) return res.json(result);
          return res.status(result.status || 401).json({ ok: false, error: result.error });
        } catch (err) {
          log('31', `Network error: ${err.message}`);
          res.status(502).json({ ok: false, error: err.message });
        }
      });

      // ── /ticket-token-exchange — Authorization Code → access token ──
      devServer.app.post('/ticket-token-exchange', async (req, res) => {
        const { instanceUrl, ticketId, clientId, clientSecret, code, redirectUri } = req.body || {};
        if (!instanceUrl || !ticketId || !clientId || !clientSecret || !code || !redirectUri) {
          return res.status(400).json({ ok: false, error: 'instanceUrl, ticketId, clientId, clientSecret, code, and redirectUri are required' });
        }

        const tokenUrl = `${instanceUrl.replace(/\/+$/, '')}/!tickets~${ticketId}/oauth2/token`;
        log('36', `POST ${tokenUrl} (authorization_code exchange)`);

        try {
          const result = await fetchTactonToken(tokenUrl, {
            grant_type: 'authorization_code',
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
          }, log);
          if (result.ok) return res.json(result);
          return res.status(result.status || 401).json({ ok: false, error: result.error });
        } catch (err) {
          log('31', `Network error: ${err.message}`);
          res.status(502).json({ ok: false, error: err.message });
        }
      });

      // ── /ticket-token-refresh — Refresh Token → new access token ──
      devServer.app.post('/ticket-token-refresh', async (req, res) => {
        const { instanceUrl, ticketId, clientId, clientSecret, refreshToken } = req.body || {};
        if (!instanceUrl || !ticketId || !clientId || !clientSecret || !refreshToken) {
          return res.status(400).json({ ok: false, error: 'instanceUrl, ticketId, clientId, clientSecret, and refreshToken are required' });
        }

        const tokenUrl = `${instanceUrl.replace(/\/+$/, '')}/!tickets~${ticketId}/oauth2/token`;
        log('36', `POST ${tokenUrl} (refresh_token)`);

        try {
          const result = await fetchTactonToken(tokenUrl, {
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
          }, log);
          if (result.ok) return res.json(result);
          return res.status(result.status || 401).json({ ok: false, error: result.error });
        } catch (err) {
          log('31', `Network error: ${err.message}`);
          res.status(502).json({ ok: false, error: err.message });
        }
      });

      return middlewares;
    },

    // ── /tacton-proxy/* — forward data API calls server-side ──────
    proxy: [
      {
        context: (pathname) => pathname.startsWith('/tacton-proxy'),
        target: 'https://placeholder.tactoncpq.com',
        router: (req) => req.headers['x-proxy-target'],
        changeOrigin: true,
        secure: false,
        pathRewrite: { '^/tacton-proxy': '' },
        on: {
          proxyReq: (_proxyReq, req) => {
            console.log(`\x1b[36m[DocGen]\x1b[0m proxy ${req.method} ${req.headers['x-proxy-target']}${req.url.replace('/tacton-proxy', '')}`);
          },
          error: (err, _req, res) => {
            console.log(`\x1b[31m[DocGen]\x1b[0m proxy error: ${err.message}`);
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          },
        },
      },
    ],
  },
  resolve: {
    extensions: ['.js'],
  },
  devtool: isDev ? 'eval-source-map' : 'source-map',
};
};
