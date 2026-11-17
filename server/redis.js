/**
 * server/redis.js — Namespace Redis per ambiente.
 *
 * Solo l'ambiente 'production' usa il prefisso storico 'wiztrail:'. Preview, sviluppo e locale
 * usano 'wiztrail:<ambiente>:' anche se condividono le stesse credenziali Upstash: non possono
 * leggere ne' sovrascrivere i dati reali (hub:*, apikeys:*, ratelimit:*).
 * Calcolato a ogni chiamata (le env possono cambiare nei test).
 */

export function ns() {
  const env = process.env.VERCEL_ENV;
  if (env === 'production') return 'wiztrail:';
  return `wiztrail:${env || 'locale'}:`;
}
