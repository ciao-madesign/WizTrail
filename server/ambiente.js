/**
 * server/ambiente.js — Rilevamento ambiente di esecuzione (Vercel).
 *
 * VERCEL_ENV vale 'production' | 'preview' | 'development'. In locale non e' definita.
 * Solo 'production' puo' avere effetti esterni (email, GitHub Actions, scritture su dati reali).
 */

export function ambiente() {
  return process.env.VERCEL_ENV || 'locale';
}

export function inProduzione() {
  return process.env.VERCEL_ENV === 'production';
}

/**
 * Per le azioni con effetti esterni: in ambienti non production risponde 403 PREVIEW_DISABLED
 * e ritorna true (l'handler deve fermarsi).
 */
export function bloccaSeNonProduzione(res, azione) {
  if (inProduzione()) return false;
  res.status(403).json({
    ok: false,
    code: 'PREVIEW_DISABLED',
    error: `L'azione "${azione}" è disabilitata negli ambienti di anteprima e in locale.`,
  });
  return true;
}
