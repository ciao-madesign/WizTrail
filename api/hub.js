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
 *   register    POST  — crea nuova API key dinamica (admin)
 *   listkeys    GET   — lista API key registrate (admin)
 *   revokekey   POST  — revoca API key (admin)
 *   requestkey  POST  — self-service: l'utente richiede una key, la riceve via email (pubblico)
 */

import { checkRateLimit, getIP } from './lib/ratelimit.js';

/* ── Variabili d'ambiente ─────────────────────────────────────── */
const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_REPO   = process.env.GITHUB_REPO;
const SECRET        = process.env.HUB_SECRET_TOKEN;
const ADMIN         = process.env.HUB_ADMIN_TOKEN;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const RESEND_FROM   = process.env.RESEND_FROM || 'WizTrail <noreply@wiz-trail.vercel.app>';

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
    // Strip REDIS_NS prefix so callers get bare keys (consistent with redisGet/redisSet)
    keys.push(...json.result[1].map(k => k.startsWith(REDIS_NS) ? k.slice(REDIS_NS.length) : k));
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
    pacing:          body.pacing          || null,
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
  await redisSet(`hub:feedback:${id}`, {
    id,
    delta_pct: body.delta_pct,
    km:        body.km   ?? null,
    dplus:     body.dplus ?? null,
    ts:        new Date().toISOString(),
  }, TTL_SECONDS);
  const stats = (await redisGet('hub:feedback:stats')) || { n: 0, sum_delta: 0, last: null };
  await redisSet('hub:feedback:stats', {
    n:         (stats.n         || 0) + 1,
    sum_delta: (stats.sum_delta || 0) + body.delta_pct,
    last:      new Date().toISOString(),
  });
  return res.status(200).json({ ok: true, id });
}

/* ── Action: register / listkeys / revokekey ──────────────────── */

function generateApiKey() {
  // wt_ + 32 hex chars (UUID senza trattini = 128 bit di entropia)
  return 'wt_' + crypto.randomUUID().replace(/-/g, '');
}

async function handleRegister(req, res) {
  setCors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });
  const auth = checkAuth(req, res);
  if (!auth.ok || !auth.isAdmin) {
    if (auth.ok) res.status(403).json({ error: 'Richiede token admin' });
    return;
  }
  const { description, email } = req.body || {};
  if (!description?.trim()) return res.status(400).json({ error: 'Campo description obbligatorio.' });

  const key        = generateApiKey();
  const created_at = new Date().toISOString();
  const entry      = { key, description: description.trim(), email: email?.trim() || null, created_at, active: true };

  // Salva entry + aggiunge all'indice (pipeline atomica)
  await fetch(`${UPSTASH_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['SET', `${REDIS_NS}apikeys:${key}`, JSON.stringify(entry)],
      ['SADD', `${REDIS_NS}apikeys:_index`, key],
    ]),
  });

  return res.status(200).json({ ok: true, key, description: entry.description, email: entry.email, created_at });
}

async function handleListKeys(req, res) {
  setCors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });
  const auth = checkAuth(req, res);
  if (!auth.ok || !auth.isAdmin) {
    if (auth.ok) res.status(403).json({ error: 'Richiede token admin' });
    return;
  }

  // Leggi indice (SMEMBERS)
  const idxRes  = await fetch(`${UPSTASH_URL}/smembers/${encodeURIComponent(`${REDIS_NS}apikeys:_index`)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const idxJson = await idxRes.json();
  const keyList = Array.isArray(idxJson.result) ? idxJson.result : [];

  if (!keyList.length) return res.status(200).json({ ok: true, keys: [] });

  // Leggi metadata di ogni key (pipeline MGET)
  const mgetArgs = keyList.map(k => `${REDIS_NS}apikeys:${k}`);
  const mgetRes  = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['MGET', ...mgetArgs]]),
  });
  const mgetJson = await mgetRes.json();
  const values   = mgetJson[0]?.result || [];

  const keys = values
    .map(v => { try { return JSON.parse(v); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => a.created_at < b.created_at ? 1 : -1);

  return res.status(200).json({ ok: true, keys });
}

async function handleRevokeKey(req, res) {
  setCors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });
  const auth = checkAuth(req, res);
  if (!auth.ok || !auth.isAdmin) {
    if (auth.ok) res.status(403).json({ error: 'Richiede token admin' });
    return;
  }
  const { key } = req.body || {};
  if (!key?.trim()) return res.status(400).json({ error: 'Campo key obbligatorio.' });

  const existing = await redisGet(`apikeys:${key}`);
  if (!existing)  return res.status(404).json({ error: 'Chiave non trovata.' });
  if (!existing.active) return res.status(200).json({ ok: true, already_revoked: true });

  await redisSet(`apikeys:${key}`, { ...existing, active: false, revoked_at: new Date().toISOString() });
  return res.status(200).json({ ok: true });
}

/* ── Action: requestkey (self-service, pubblico) ──────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function rlRequestKey(ip) {
  // Rate limit dedicato: max 3 richieste/ora per IP
  const key = REDIS_NS + 'rl:reqkey:' + ip;
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['INCR', key], ['EXPIRE', key, 3600]]),
  });
  const json = await res.json();
  const count = json[0]?.result ?? 1;
  return { allowed: count <= 3, count };
}

function buildKeyEmail(key, description) {
  return `
<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { margin:0; padding:0; background:#0d1117; font-family:system-ui,sans-serif; }
  .wrap { max-width:560px; margin:40px auto; background:#161b22; border-radius:12px;
          border:1px solid #21262d; overflow:hidden; }
  .head { background:#0d1117; padding:28px 32px 24px; border-bottom:1px solid #21262d; }
  .head h1 { margin:0; font-size:1.1rem; color:#e6edf3; font-weight:600; }
  .head p  { margin:6px 0 0; color:#7d8590; font-size:0.85rem; }
  .body { padding:28px 32px; }
  .label { font-size:0.72rem; letter-spacing:.06em; text-transform:uppercase;
           color:#7d8590; margin-bottom:8px; }
  .key-box { background:#0d1117; border:1px solid #21262d; border-radius:7px;
             padding:14px 16px; font-family:'JetBrains Mono',monospace; font-size:0.95rem;
             color:#4fd1c5; letter-spacing:.03em; word-break:break-all; margin-bottom:20px; }
  .info { font-size:0.85rem; color:#7d8590; line-height:1.65; margin-bottom:20px; }
  .info strong { color:#e6edf3; }
  .ex-block { background:#0d1117; border-radius:7px; border:1px solid #21262d;
              padding:14px 16px; font-family:monospace; font-size:0.78rem;
              color:#a5d6ff; margin-bottom:24px; white-space:pre-wrap; line-height:1.65; }
  .footer { padding:18px 32px; border-top:1px solid #21262d; font-size:0.78rem; color:#7d8590; }
</style></head>
<body>
<div class="wrap">
  <div class="head">
    <h1>🏔 WizTrail — Chiave API</h1>
    <p>La tua chiave è pronta. Conservala in un posto sicuro.</p>
  </div>
  <div class="body">
    <div class="label">La tua chiave API</div>
    <div class="key-box">${key}</div>
    <div class="info">
      <strong>Come si usa:</strong> aggiungi l'header <code style="background:#21262d;padding:1px 5px;border-radius:3px;color:#4fd1c5">x-api-key</code>
      ad ogni richiesta alle API WizTrail.
    </div>
    <div class="ex-block">POST https://wiz-trail.vercel.app/api/v1/wdi
x-api-key: ${key}
Content-Type: application/json

{ "distance_km": 42, "dplus": 2800 }</div>
    <div class="info">
      <strong>Limiti:</strong> 30 richieste/minuto per IP.<br>
      <strong>Descrizione registrata:</strong> ${description || '—'}
    </div>
  </div>
  <div class="footer">
    Hai ricevuto questa email perché qualcuno ha richiesto una chiave API WizTrail con il tuo indirizzo.
    Se non sei stato tu, ignora questa email — la chiave non è attiva finché non viene usata.
  </div>
</div>
</body></html>`.trim();
}

async function sendKeyEmail(to, key, description) {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY mancante');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    RESEND_FROM,
      to:      [to],
      subject: 'La tua chiave API WizTrail',
      html:    buildKeyEmail(key, description),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend HTTP ${res.status}: ${body}`);
  }
  return await res.json();
}

async function handleRequestKey(req, res) {
  setCors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  if (!RESEND_KEY) {
    return res.status(503).json({ error: 'Servizio email non configurato. Contatta l\'amministratore.' });
  }

  const ip = getIP(req);
  const rl = await rlRequestKey(ip);
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Troppe richieste. Puoi richiedere al massimo 3 chiavi per ora.' });
  }

  const { email, description } = req.body || {};

  if (!email?.trim() || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'Indirizzo email non valido.' });
  }

  const emailKey   = email.trim().toLowerCase();
  const emailIndex = `apikeys:email:${emailKey}`;

  // Controlla se esiste già una chiave per questa email
  const existing = await redisGet(emailIndex);
  if (existing?.key) {
    const keyData = await redisGet(`apikeys:${existing.key}`);
    if (keyData?.active) {
      // Rimanda la chiave esistente senza crearne una nuova
      try {
        await sendKeyEmail(emailKey, existing.key, description || keyData.description);
      } catch (e) {
        console.error('requestkey: sendKeyEmail error (resend)', e.message);
        return res.status(502).json({ error: 'Errore nell\'invio email. Riprova tra qualche minuto.' });
      }
      return res.status(200).json({ ok: true, resent: true });
    }
  }

  // Crea chiave nuova
  const key        = generateApiKey();
  const created_at = new Date().toISOString();
  const desc       = description?.trim() || 'Self-service via email';
  const entry      = { key, description: desc, email: emailKey, created_at, active: true };

  await fetch(`${UPSTASH_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['SET', `${REDIS_NS}apikeys:${key}`,        JSON.stringify(entry)],
      ['SADD', `${REDIS_NS}apikeys:_index`,        key],
      ['SET', `${REDIS_NS}${emailIndex}`,          JSON.stringify({ key, created_at })],
    ]),
  });

  try {
    await sendKeyEmail(emailKey, key, desc);
  } catch (e) {
    console.error('requestkey: sendKeyEmail error', e.message);
    // Chiave già scritta su Redis — logga l'errore ma non rollbackare
    return res.status(502).json({ error: 'Chiave creata, ma l\'invio email è fallito. Contatta l\'amministratore citando il tuo indirizzo email.' });
  }

  return res.status(200).json({ ok: true });
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
    case 'register':   return await handleRegister(req, res);
    case 'listkeys':   return await handleListKeys(req, res);
    case 'revokekey':   return await handleRevokeKey(req, res);
    case 'requestkey':  return await handleRequestKey(req, res);
    default:
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(400).json({ error: 'Parametro action mancante o non valido' });
  }
}
