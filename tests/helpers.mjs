// Helper di test: finti req/res in stile Vercel e stub di fetch (nessuna rete reale, nessun Redis reale).

export function mockReq({ method = 'GET', query = {}, headers = {}, body } = {}) {
  return { method, query, headers, body, socket: { remoteAddress: '203.0.113.9' } };
}

export function mockRes() {
  const res = {
    statusCode: 200, headers: {}, body: undefined, ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; this.ended = true; return this; },
    send(t) { this.body = t; this.ended = true; return this; },
    end() { this.ended = true; return this; },
  };
  return res;
}

/**
 * Sostituisce globalThis.fetch con un registratore. `risposte` e' una funzione (url, opts) => Response|oggetto.
 * Ritorna { chiamate, ripristina }.
 */
export function stubFetch(risposte = () => { throw new Error('fetch non previsto nel test'); }) {
  const originale = globalThis.fetch;
  const chiamate = [];
  globalThis.fetch = async (url, opts) => {
    chiamate.push({ url: String(url), opts });
    return risposte(String(url), opts);
  };
  return { chiamate, ripristina() { globalThis.fetch = originale; } };
}

export function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

/** Imposta variabili d'ambiente e ritorna la funzione di ripristino. */
export function setEnv(vars) {
  const prima = {};
  for (const [k, v] of Object.entries(vars)) {
    prima[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return () => { for (const [k, v] of Object.entries(prima)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
}
