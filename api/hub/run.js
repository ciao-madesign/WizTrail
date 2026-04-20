/**
 * api/hub/run.js
 * POST /api/hub/run
 */
import { checkAuth } from './auth.js';

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_REPO   = process.env.GITHUB_REPO;

async function redisGet(key) {
  const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  const json = await res.json();
  if (json.error) throw new Error(`Redis GET: ${json.error}`);
  if (json.result === null) return null;
  try { return JSON.parse(json.result); } catch { return json.result; }
}

async function redisSet(key, value) {
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['SET', key, JSON.stringify(value)]])
  });
  const json = await res.json();
  if (json[0]?.error) throw new Error(`Redis SET: ${json[0].error}`);
  return json[0]?.result;
}

async function isAuthorizedRunner(alias, isAdmin) {
  if (isAdmin) return true;
  if (!alias)  return false;
  const runners = (await redisGet('hub:authorized_runners')) || [];
  return runners.includes(alias);
}

async function triggerGitHubActions(alias) {
  if (!GITHUB_TOKEN || !GITHUB_REPO) throw new Error('GITHUB_TOKEN o GITHUB_REPO non configurati');
  const [owner, repo] = GITHUB_REPO.split('/');
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: 'hub_calibration',
      client_payload: { triggered_by: alias || 'admin', timestamp: new Date().toISOString() },
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`GitHub API ${res.status}: ${t}`); }
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = checkAuth(req, res);
  if (!auth.ok) return;

  const alias = req.body?.alias?.trim() || null;

  const canRun = await isAuthorizedRunner(alias, auth.isAdmin);
  if (!canRun) return res.status(403).json({ error: 'Non autorizzato ad avviare la pipeline' });

  const stats = (await redisGet('hub:stats')) || {};

  // Auto-reset se pipeline bloccata da più di 40 minuti
  if (stats.pipeline_running && stats.pipeline_started_at) {
    const elapsed = Date.now() - new Date(stats.pipeline_started_at).getTime();
    if (elapsed > 40 * 60 * 1000) {
      stats.pipeline_running    = false;
      stats.pipeline_started_at = null;
      stats.pipeline_started_by = null;
    }
  }

  if (stats.pipeline_running) {
    return res.status(409).json({
      error:      'Pipeline già in corso',
      started_at: stats.pipeline_started_at,
      started_by: stats.pipeline_started_by,
    });
  }

  await triggerGitHubActions(alias || 'admin');

  const now = new Date().toISOString();
  await redisSet('hub:stats', {
    ...stats,
    pipeline_running:    true,
    pipeline_started_at: now,
    pipeline_started_by: alias || 'admin',
  });

  return res.status(200).json({ ok: true, message: 'Pipeline avviata su GitHub Actions', started_at: now });
}
