/**
 * api/hub/run.js
 * POST /api/hub/run
 *
 * Avvia la pipeline di calibrazione su GitHub Actions.
 * Richiede admin O alias in lista hub:authorized_runners.
 *
 * Body: { key, alias }
 *
 * Flusso:
 *   1. Verifica autorizzazione
 *   2. Controlla che non ci sia già una pipeline in corso
 *   3. Triggera repository_dispatch su GitHub
 *   4. Aggiorna hub:stats con last_run_started
 *
 * Restituisce: { ok: true, run_id: ... }
 */

import { checkAuth } from './auth.js';

const UPSTASH_URL    = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN  = process.env.UPSTASH_REDIS_REST_TOKEN;
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
const GITHUB_REPO    = process.env.GITHUB_REPO; // es. "micheledev/wiztrail"

async function redisGet(key) {
  const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) throw new Error(`Redis GET error: ${json.error}`);
  return json.result ? JSON.parse(json.result) : null;
}

async function redisSet(key, value) {
  const res = await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ value: JSON.stringify(value) }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Redis SET error: ${json.error}`);
  return json.result;
}

async function isAuthorizedRunner(alias, isAdmin) {
  if (isAdmin) return true;
  if (!alias)  return false;
  const runners = (await redisGet('hub:authorized_runners')) || [];
  return runners.includes(alias);
}

async function triggerGitHubActions(alias) {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    throw new Error('GITHUB_TOKEN o GITHUB_REPO non configurati');
  }

  const [owner, repo] = GITHUB_REPO.split('/');
  const url = `https://api.github.com/repos/${owner}/${repo}/dispatches`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: 'hub_calibration',
      client_payload: {
        triggered_by: alias || 'admin',
        timestamp:    new Date().toISOString(),
      },
    }),
  });

  // GitHub risponde 204 No Content se OK
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${text}`);
  }
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  const auth = checkAuth(req, res);
  if (!auth.ok) return;

  const alias = req.body?.alias?.trim() || null;

  // Verifica autorizzazione runner
  const canRun = await isAuthorizedRunner(alias, auth.isAdmin);
  if (!canRun) {
    return res.status(403).json({
      error: 'Non autorizzato ad avviare la pipeline',
      message: 'Contatta l\'admin per richiedere l\'accesso',
    });
  }

  // Controlla se pipeline già in corso (evita run doppi)
  const stats = (await redisGet('hub:stats')) || {};
  if (stats.pipeline_running) {
    return res.status(409).json({
      error: 'Pipeline già in corso',
      started_at: stats.pipeline_started_at,
      started_by: stats.pipeline_started_by,
    });
  }

  // Triggera GitHub Actions
  await triggerGitHubActions(alias || 'admin');

  // Aggiorna stato su Redis
  const now = new Date().toISOString();
  await redisSet('hub:stats', {
    ...stats,
    pipeline_running:    true,
    pipeline_started_at: now,
    pipeline_started_by: alias || 'admin',
  });

  return res.status(200).json({
    ok:         true,
    message:    'Pipeline avviata su GitHub Actions',
    started_at: now,
    started_by: alias || 'admin',
  });
}
