/**
 * api/hub.js — Handler hub unificato
 *
 * Sostituisce i 6 file api/hub/*.js per restare entro il limite
 * di 12 funzioni serverless del piano Vercel Hobby.
 *
 * Routing: GET|POST /api/hub?action=<azione>
 *
 * Azioni disponibili:
 *   auth        GET   — verifica token, ritorna { ok, isAdmin }
 *   upload      POST  — carica attività GPX su Redis
 *   activities  GET   — lista attività + stats + plots
 *   run         POST  — avvia pipeline calibrazione via GitHub Actions
 *   patch       POST  — riceve risultati calibrazione dalla pipeline (admin)
 *   feedback    POST  — feedback anonimo post-gara (pubblico, rate-limited)
 */

import { checkRateLimit, getIP } from './lib/ratelimit.js';

/* ── Variabili d'ambiente ─────────────────────────────────────── */
const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_REPO   = process.env.GITHUB_REPO;
const SECRET        = process.env.HUB_SECRET_TOKEN;
const ADMIN         = process.env.HUB_ADMIN_TOKEN;

/* ── Redis helpers ────────────────────────────────────────────── */
const REDIS_NS = 'wiztrail:'; // namespace per isolare da altri progetti sullo stesso DB

async function redisGet(key) {
  const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(REDIS_NS + key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) throw new Error(`Redis GET: ${json.error}`);
  if (json.result === null) return null;
  try { return JSON.parse(json.result); } catch { return json.result; }
}

async function redisSet(key, value, ttlSeconds = null) {
  const cmd = ttlSeconds
    ? ['SET', REDIS_NS + key, JSON.stringify(value), 'EX', ttlSeconds]
    : ['SET', REDIS_NS + key, JSON.stringify(value)];
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([cmd]),
  });
  const json = await res.json();
  if (json[0]?.error) throw new Error(`Redis SET: ${json[0].error}`);
  return json[0]?.result;
}

async function redisScan(pattern, maxKeys = 1000) {
  const keys = [];
  let cursor = '0';
  do {
    const res = await fetch(
      `${UPSTASH_URL}/scan/${cursor}?match=${encodeURIComponent(REDIS_NS + pattern)}&count=100`,
      { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } }
    );
    const json = await res.json();
    if (json.error) throw new Error(`Redis SCAN: ${json.error}`);
    cursor = json.result[0];
    keys.push(...json.result[1]);
  } while (cursor !== '0' && keys.length < maxKeys);
  return keys;
}

/* ── Auth helpers ─────────────────────────────────────────────── */
function extractToken(req) {
  return (
    req.query?.key ||
    req.headers?.['x-hub-key'] ||
    req.body?.key ||
    null
  );
}

function checkAuth(req, res) {
  if (!SECRET || !ADMIN) {
    res.status(500).json({ error: 'Variabili HUB_SECRET_TOKEN / HUB_ADMIN_TOKEN mancanti' });
    return { ok: false, isAdmin: false };
  }
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Token mancante' });
    return { ok: false, isAdmin: false };
  }
  if (token === ADMIN)  return { ok: true, isAdmin: true };
  if (token === SECRET) return { ok: true, isAdmin: false };
  res.status(401).json({ error: 'Token non valido' });
  return { ok: false, isAdmin: false };
}

/* ── CORS helpers ─────────────────────────────────────────────── */
const CORS_HEADERS = 'Content-Type, X-Hub-Key';

function setCors(res, methods) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', `${methods}, OPTIONS`);
  res.setHeader('Access-Control-Allow-Headers', CORS_HEADERS);
}

/* feedback usa CORS per-origin (protezione CSRF) */
const ALLOWED_ORIGINS = [
  'https://wiz-trail.vercel.app',
  'https://ciao-madesign.github.io',
];

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try { return new URL(origin).hostname.endsWith('.vercel.app'); } catch { return false; }
}

function setFeedbackCors(res, origin) {
  const corsOrigin = isAllowedOrigin(origin) ? (origin || ALLOWED_ORIGINS[0]) : '';
  if (corsOrigin) res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* ── Action: auth ─────────────────────────────────────────────── */
function handleAuth(req, res) {
  setCors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = checkAuth(req, res);
  if (!auth.ok) return;
  res.status(200).json({ ok: true, isAdmin: auth.isAdmin });
}

/* ── Action: upload ───────────────────────────────────────────── */
function estimateWDI(km, dplus, technicality) {
  if (!km || !dplus) return null;
  const EXP   = 0.48;
  const kT    = 0.50;
  const REF42 = Math.pow(42, EXP);
  const dkm   = dplus / 1000;
  const VS    = (dkm * 10) / (1 + Math.sqrt(Math.max(dkm,  0.001)) / 8)
              + (dkm *  4) / (1 + Math.sqrt(Math.max(dkm,  0.001)) / 6);
  const TS    = technicality * 10;
  const DF    = km <= 100
    ? Math.pow(km, EXP) / REF42
    : Math.pow(100, EXP) / REF42 + (Math.pow(km, 0.42) - Math.pow(100, 0.42)) / REF42 * 0.6;
  return Math.round((VS + TS * kT) * DF * 10) / 10;
}

function validateUpload(body) {
  const errors = [];
  if (!body.alias?.trim())       errors.push('alias obbligatorio');
  if (!body.name?.trim())        errors.push('nome attività obbligatorio');
  if (!['personal','reference'].includes(body.type)) errors.push('type non valido');
  if (!body.gpx_base64)         errors.push('GPX obbligatorio');
  if (body.gpx_base64?.length > 7_000_000) errors.push('GPX troppo grande (max ~5MB)');
  if (typeof body.km !== 'number' || body.km <= 0) errors.push('km non valido');
  if (typeof body.dplus !== 'number' || body.dplus < 0) errors.push('D+ non valido');
  if (typeof body.technicality !== 'number' || body.technicality < 0 || body.technicality > 10)
    errors.push('technicality deve essere tra 0 e 10');
  if (!['runnable','mixed','technical','alpine','extreme'].includes(body.tech_label))
    errors.push('tech_label non valido');
  if (body.time_hours != null && (typeof body.time_hours !== 'number' || body.time_hours <= 0))
    errors.push('time_hours non valido');
  return errors;
}

async function handleUpload(req, res) {
  setCors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = checkAuth(req, res);
  if (!auth.ok) return;
  const body = req.body;
  if (!body) return res.status(400).json({ error: 'Body mancante' });
  const errors = validateUpload(body);
  if (errors.length > 0) return res.status(400).json({ error: 'Dati non validi', details: errors });

  const id = crypto.randomUUID();
  const activity = {
    id,
    alias:        body.alias.trim(),
    name:         body.name.trim(),
    type:         body.type,
    gpx_base64:   body.gpx_base64,
    gpx_filename: body.gpx_filename || `${id}.gpx`,
    km:           body.km,
    dplus:        body.dplus,
    time_hours:   body.time_hours ?? null,
    technicality: body.technicality,
    tech_label:   body.tech_label,
    comment:      body.comment?.trim() || null,
    status:       'pending',
    timestamp:    new Date().toISOString(),
    wdi_estimate: estimateWDI(body.km, body.dplus, body.technicality),
  };

  await redisSet(`hub:activities:${id}`, activity, 180 * 24 * 3600);
  const stats = (await redisGet('hub:stats')) || { n_total: 0, n_pending: 0, last_run: null, last_rmse: null };
  await redisSet('hub:stats', {
    ...stats,
    n_total:   (stats.n_total   || 0) + 1,
    n_pending: (stats.n_pending || 0) + 1,
  });
  return res.status(200).json({ ok: true, id, wdi_estimate: activity.wdi_estimate });
}

/* ── Action: activities ───────────────────────────────────────── */
function stripGpx(a) {
  const { gpx_base64, ...rest } = a;
  return rest;
}

async function handleActivities(req, res) {
  setCors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = checkAuth(req, res);
  if (!auth.ok) return;
  const alias = req.query?.alias?.trim() || null;
  try {
    const keys  = await redisScan('hub:activities:*');
    const all   = await Promise.all(keys.map(k => redisGet(k).catch(() => null)));
    const valid = all.filter(a => a && typeof a === 'object' && a.name).map(stripGpx);
    const activities = auth.isAdmin
      ? valid.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
      : valid
          .filter(a => a.alias === alias)
          .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    const stats     = (await redisGet('hub:stats')) || { n_total: 0, n_pending: 0, last_run: null, last_rmse: null };
    const model     = await redisGet('hub:model:current');
    const plot_rmse = await redisGet('hub:plot:rmse');
    const plotNames = ['wdi_scatter','pacing_scatter','insights_distribution',
                       'insights_tech_vs_wdi','insights_spread','history_rmse'];
    const plots = {};
    await Promise.all(plotNames.map(async name => {
      const b = await redisGet(`hub:plot:${name}`).catch(() => null);
      if (b) plots[name] = b;
    }));
    const report_md          = await redisGet('hub:report:md').catch(() => null);
    const authorized_runners = auth.isAdmin ? ((await redisGet('hub:authorized_runners')) || []) : null;
    return res.status(200).json({
      ok: true, activities, stats, model, plot_rmse,
      plots, report_md, isAdmin: auth.isAdmin, authorized_runners,
    });
  } catch (e) {
    console.error('[activities] error:', e);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
}

/* ── Action: run ──────────────────────────────────────────────── */
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

async function handleRun(req, res) {
  setCors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = checkAuth(req, res);
  if (!auth.ok) return;
  const alias = req.body?.alias?.trim() || null;
  const canRun = await isAuthorizedRunner(alias, auth.isAdmin);
  if (!canRun) return res.status(403).json({ error: 'Non autorizzato ad avviare la pipeline' });
  const stats = (await redisGet('hub:stats')) || {};
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

/* ── Action: patch ────────────────────────────────────────────── */
async function markActivitiesCalibrated() {
  const keys = await redisScan('hub:activities:*');
  await Promise.all(keys.map(async k => {
    const a = await redisGet(k);
    if (a?.status === 'pending') await redisSet(k, { ...a, status: 'calibrated' });
  }));
}

async function handlePatch(req, res) {
  setCors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = checkAuth(req, res);
  if (!auth.ok) return;
  if (!auth.isAdmin) return res.status(403).json({ error: 'Solo admin' });
  const body = req.body;
  if (!body) return res.status(400).json({ error: 'Body mancante' });
  if (body._reset_pipeline) {
    const s = (await redisGet('hub:stats')) || {};
    await redisSet('hub:stats', { ...s, pipeline_running: false, pipeline_started_at: null, pipeline_started_by: null });
    return res.status(200).json({ ok: true, action: 'pipeline_reset' });
  }
  const ts = new Date().toISOString();
  const model = {
    wdi_calibration: body.wdi_calibration || null,
    timing:          body.timing          || null,
    pacing:          body.timing          || body.pacing || null,
    stats:           body.stats           || null,
    timestamp:       ts,
    patch_js:        body.patch_js        || null,
  };
  await redisSet('hub:model:current', model);
  await redisSet(`hub:model:history:${ts}`, model);
  if (body.plot_rmse_base64) await redisSet('hub:plot:rmse', body.plot_rmse_base64);
  if (body.plots && typeof body.plots === 'object') {
    for (const [name, b64] of Object.entries(body.plots)) {
      await redisSet(`hub:plot:${name}`, b64);
    }
  }
  if (body.report_md) await redisSet('hub:report:md', body.report_md);
  const prevStats = (await redisGet('hub:stats')) || {};
  const newRmse   = body.wdi_calibration?.rmse_after ?? prevStats.last_rmse;
  await redisSet('hub:stats', {
    n_total:             prevStats.n_total || 0,
    n_pending:           0,
    last_run:            ts,
    last_rmse:           newRmse,
    pipeline_running:    false,
    pipeline_started_at: null,
    pipeline_started_by: null,
  });
  await markActivitiesCalibrated();
  if (Array.isArray(body.authorized_runners)) {
    await redisSet('hub:authorized_runners', body.authorized_runners);
  }
  return res.status(200).json({ ok: true, timestamp: ts, rmse: newRmse });
}

/* ── Action: feedback ─────────────────────────────────────────── */
function validateFeedback(body) {
  const errors = [];
  if (typeof body.delta_pct !== 'number') errors.push('delta_pct deve essere un numero');
  if (Math.abs(body.delta_pct) > 300)    errors.push('delta_pct fuori range (max ±300%)');
  if (body.km != null && (typeof body.km !== 'number' || body.km <= 0 || body.km > 500))
    errors.push('km non valido');
  if (body.dplus != null && (typeof body.dplus !== 'number' || body.dplus < 0 || body.dplus > 30000))
    errors.push('dplus non valido');
  return errors;
}

async function handleFeedback(req, res) {
  const origin = req.headers.origin || '';
  setFeedbackCors(res, origin);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });
  if (origin && !isAllowedOrigin(origin)) return res.status(403).json({ error: 'Origine non autorizzata' });
  const ip = getIP(req);
  const { allowed, remaining } = await checkRateLimit(ip);
  if (!allowed) {
    res.setHeader('X-RateLimit-Remaining', '0');
    return res.status(429).json({ error: 'Troppe richieste. Riprova tra un minuto.' });
  }
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  const body = req.body;
  if (!body) return res.status(400).json({ error: 'Body mancante' });
  const errors = validateFeedback(body);
  if (errors.length > 0) return res.status(400).json({ error: 'Dati non validi', details: errors });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const TTL_SECONDS = 90 * 24 * 60 * 60;
  const feedbackData = JSON.stringify({
    id,
    delta_pct: body.delta_pct,
    km:        body.km   ?? null,
    dplus:     body.dplus ?? null,
    ts:        new Date().toISOString(),
  });
  const ttlRes = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['SET', `hub:feedback:${id}`, feedbackData],
      ['EXPIRE', `hub:feedback:${id}`, TTL_SECONDS],
    ]),
  });
  const ttlJson = await ttlRes.json();
  if (ttlJson[0]?.error) throw new Error(`Redis SET feedback: ${ttlJson[0].error}`);
  const stats = (await redisGet('hub:feedback:stats')) || { n: 0, sum_delta: 0, last: null };
  await redisSet('hub:feedback:stats', {
    n:         (stats.n         || 0) + 1,
    sum_delta: (stats.sum_delta || 0) + body.delta_pct,
    last:      new Date().toISOString(),
  });
  return res.status(200).json({ ok: true, id });
}

/* ── Router principale ────────────────────────────────────────── */
export default async function handler(req, res) {
  const action = req.query?.action;

  switch (action) {
    case 'auth':       return handleAuth(req, res);
    case 'upload':     return await handleUpload(req, res);
    case 'activities': return await handleActivities(req, res);
    case 'run':        return await handleRun(req, res);
    case 'patch':      return await handlePatch(req, res);
    case 'feedback':   return await handleFeedback(req, res);
    default:
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(400).json({ error: 'Parametro action mancante o non valido' });
  }
}
