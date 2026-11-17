/**
 * server/netguard.js — Protezione SSRF e download sicuro per import da URL.
 *
 * - Valida host/IP (IPv4 + IPv6, anche con parentesi e IPv4-mapped).
 * - Risolve il DNS e collega la richiesta SOLO all'IP già validato (anti DNS-rebinding).
 * - Redirect gestiti a mano (max 3), con rivalidazione a ogni passaggio.
 * - Timeout complessivo e tetto di byte in streaming.
 */

import { BlockList, isIP } from 'node:net';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';

export class ErroreImport extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'ErroreImport';
    this.code = code;
    this.status = status;
  }
}

/* ── Intervalli di indirizzi non raggiungibili ────────────────────── */
const bloccati = new BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
].forEach(([a, p]) => bloccati.addSubnet(a, p, 'ipv4'));
[
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['64:ff9b::', 96],
].forEach(([a, p]) => bloccati.addSubnet(a, p, 'ipv6'));

/** Rimuove parentesi IPv6 e punto finale dal nome host. */
export function normalizzaHost(hostname) {
  let h = String(hostname || '').trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  while (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

/** true se l'indirizzo IP (v4 o v6) appartiene a una rete privata/locale/riservata. */
export function ipPrivato(ip) {
  const tipo = isIP(ip);
  if (!tipo) return true; // se non e' un IP valido, per prudenza lo consideriamo bloccato
  const fam = tipo === 4 ? 'ipv4' : 'ipv6';
  if (bloccati.check(ip, fam)) return true;
  // IPv4-mapped (::ffff:a.b.c.d o ::ffff:7f00:1): controlla anche la parte v4
  if (fam === 'ipv6') {
    const m = ip.toLowerCase().match(/^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
    if (m) {
      let v4 = m[1];
      if (!v4) {
        const hi = parseInt(m[2], 16), lo = parseInt(m[3], 16);
        v4 = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
      }
      return bloccati.check(v4, 'ipv4');
    }
  }
  return false;
}

/** Ritorna un motivo di blocco (stringa) oppure null se il nome/IP letterale è ammesso. */
export function hostBloccato(hostname) {
  const h = normalizzaHost(hostname);
  if (!h) return 'host vuoto';
  if (isIP(h)) return ipPrivato(h) ? 'indirizzo IP privato o riservato' : null;
  if (h === 'localhost' || h.endsWith('.localhost')) return 'localhost';
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localdomain') || h.endsWith('.lan') || h.endsWith('.home.arpa')) return 'dominio interno';
  if (!h.includes('.')) return 'nome host senza dominio';
  return null;
}

/** Risolve il DNS e verifica che TUTTI gli indirizzi siano pubblici. Ritorna il primo. */
export async function risolviSicuro(hostname, lookup = dns.promises.lookup) {
  const h = normalizzaHost(hostname);
  if (isIP(h)) return { address: h, family: isIP(h) };
  let elenco;
  try {
    elenco = await lookup(h, { all: true, verbatim: true });
  } catch {
    throw new ErroreImport('UPSTREAM_UNREACHABLE', 502, "Impossibile raggiungere l'indirizzo indicato (nome non risolvibile).");
  }
  if (!elenco || !elenco.length) throw new ErroreImport('UPSTREAM_UNREACHABLE', 502, "Impossibile raggiungere l'indirizzo indicato.");
  if (elenco.some(r => ipPrivato(r.address))) {
    throw new ErroreImport('BLOCKED_HOST', 400, 'Questo indirizzo non può essere importato (rete non pubblica).');
  }
  return { address: elenco[0].address, family: elenco[0].family };
}

/** Valida URL e ritorna l'oggetto URL (solo http/https, porte 80/443, host ammesso). */
export function validaUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new ErroreImport('INVALID_URL', 400, 'URL non valido.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new ErroreImport('UNSUPPORTED_SCHEME', 400, 'Sono consentiti solo indirizzi http o https.');
  }
  if (u.username || u.password) throw new ErroreImport('INVALID_URL', 400, 'URL non valido (credenziali non ammesse).');
  const porta = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (porta !== '80' && porta !== '443') throw new ErroreImport('BLOCKED_PORT', 400, 'Sono consentite solo le porte web standard (80 e 443).');
  if (hostBloccato(u.hostname)) throw new ErroreImport('BLOCKED_HOST', 400, 'Questo indirizzo non può essere importato.');
  return u;
}

function richiestaSingola(u, ip, { timeoutMs, maxBytes, impl }) {
  return new Promise((resolve, reject) => {
    const mod = impl || (u.protocol === 'https:' ? https : http);
    const lookupFisso = (_host, opts, cb) => {
      if (opts && opts.all) cb(null, [{ address: ip.address, family: ip.family }]);
      else cb(null, ip.address, ip.family);
    };
    let concluso = false;
    const fine = (fn, v) => { if (!concluso) { concluso = true; clearTimeout(timer); fn(v); } };
    const req = mod.request(u, {
      method: 'GET', lookup: lookupFisso, headers: { 'User-Agent': 'WizTrail/1.0', Accept: '*/*', 'Accept-Encoding': 'identity' },
    }, (res) => {
      const stato = res.statusCode || 0;
      const headers = res.headers;
      if (stato >= 300 && stato < 400 && headers.location) { res.resume(); return fine(resolve, { redirect: headers.location }); }
      if (stato < 200 || stato >= 300) { res.resume(); return fine(reject, new ErroreImport('UPSTREAM_ERROR', 502, `Il sito ha risposto con un errore (${stato}).`)); }
      const ct = headers['content-type'] || '';
      const cl = Number(headers['content-length']);
      if (Number.isFinite(cl) && cl > maxBytes) { res.destroy(); return fine(reject, new ErroreImport('TOO_LARGE', 413, 'File troppo grande (max 5 MB).')); }
      // Controllo del tipo PRIMA di scaricare il corpo
      const tipoOk = /xml|gpx|octet-stream|text\/plain/i.test(ct);
      if (!tipoOk) {
        res.destroy();
        if (/text\/html/i.test(ct)) {
          return fine(reject, new ErroreImport('HTML_PAGE', 422, 'Questo link è una pagina web, non un file. Usa il link di download diretto del GPX oppure carica il file.'));
        }
        return fine(reject, new ErroreImport('NOT_GPX', 422, `Il file non sembra un GPX/TCX (tipo: ${ct || 'sconosciuto'}).`));
      }
      const pezzi = []; let tot = 0;
      res.on('data', (c) => {
        tot += c.length;
        if (tot > maxBytes) { res.destroy(); fine(reject, new ErroreImport('TOO_LARGE', 413, 'File troppo grande (max 5 MB).')); }
        else pezzi.push(c);
      });
      res.on('end', () => fine(resolve, { buffer: Buffer.concat(pezzi), contentType: ct }));
      res.on('error', () => fine(reject, new ErroreImport('UPSTREAM_UNREACHABLE', 502, 'Download interrotto.')));
    });
    const timer = setTimeout(() => {
      req.destroy();
      fine(reject, new ErroreImport('UPSTREAM_TIMEOUT', 504, 'Il sito non ha risposto in tempo (8 secondi). Riprova o carica il file.'));
    }, timeoutMs);
    req.on('error', () => fine(reject, new ErroreImport('UPSTREAM_UNREACHABLE', 502, "Impossibile raggiungere l'indirizzo indicato.")));
    req.end();
  });
}

/**
 * Scarica un URL in modo sicuro. Opzioni (per i test): lookup, impl (modulo http), consentiPrivati.
 * @returns {Promise<{buffer:Buffer, contentType:string, finalUrl:string}>}
 */
export async function scaricaSicuro(raw, opzioni = {}) {
  const { maxRedirect = 3, timeoutMs = 8000, maxBytes = 5 * 1024 * 1024, lookup, impl, consentiPrivati = false } = opzioni;
  const scadenza = Date.now() + timeoutMs;
  let corrente = consentiPrivati ? new URL(raw) : validaUrl(raw);
  for (let hop = 0; hop <= maxRedirect; hop++) {
    const restante = scadenza - Date.now();
    if (restante <= 0) throw new ErroreImport('UPSTREAM_TIMEOUT', 504, 'Il sito non ha risposto in tempo (8 secondi). Riprova o carica il file.');
    const ip = consentiPrivati
      ? { address: corrente.hostname.replace(/^\[|\]$/g, ''), family: isIP(corrente.hostname.replace(/^\[|\]$/g, '')) || 4 }
      : await risolviSicuro(corrente.hostname, lookup);
    const r = await richiestaSingola(corrente, ip, { timeoutMs: restante, maxBytes, impl });
    if (r.redirect) {
      let prossimo;
      try { prossimo = new URL(r.redirect, corrente); } catch { throw new ErroreImport('INVALID_URL', 502, 'Il sito ha indicato un reindirizzamento non valido.'); }
      corrente = consentiPrivati ? prossimo : validaUrl(prossimo.toString());
      continue;
    }
    return { buffer: r.buffer, contentType: r.contentType, finalUrl: corrente.toString() };
  }
  throw new ErroreImport('TOO_MANY_REDIRECTS', 502, 'Troppi reindirizzamenti: usa il link diretto al file.');
}
