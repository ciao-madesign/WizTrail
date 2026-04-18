/**
 * api/hub/run.js
 * POST /api/hub/run
 */
import { checkAuth } from './auth.js';

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_REPO   = process.env.GITHUB_REPO;

async function cmd(args) {
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Upstash: ${json.error}`);
  return json.result;
}

async function get(key) {
  const r = await cmd(['GET', key]);
  if (r === null) return null;
  try { return JSON.parse(r); } catch { return r; }
}

async function set(key, value) {
  return cmd(['SET', key, JSON.stringify(value)]);
}

async function isAuthorizedRunner(alias, isAdmin) {
  if (isAdmin) return true;
  if (!alias)  return false;
  const runners = (await get('hub:authorized_runners')) || [];
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

  const stats = (await get('hub:stats')) || {};
  if (stats.pipeline_running) {
    return res.status(409).json({
      error: 'Pipeline già in corso',
      started_at: stats.pipeline_started_at,
      started_by: stats.pipeline_started_by,
    });
  }

  await triggerGitHubActions(alias || 'admin');

  const now = new Date().toISOString();
  await set('hub:stats', { ...stats, pipeline_running: true, pipeline_started_at: now, pipeline_started_by: alias || 'admin' });

  return res.status(200).json({ ok: true, message: 'Pipeline avviata su GitHub Actions', started_at: now });
}
