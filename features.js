/**
 * features.js — Flag funzionali lato client e testi condivisi (M2).
 *
 * Allineato ai flag lato server: stravaEnabled <-> STRAVA_ENABLED (api/strava/*).
 * Per riattivare Strava: impostare stravaEnabled = true QUI e STRAVA_ENABLED=true su Vercel.
 * Il codice Strava non e' stato rimosso: i flag lo spengono soltanto.
 * Nessuna dipendenza. Caricare PRIMA di main.js / degli script di pagina.
 */
window.WizFeatures = (function () {
  'use strict';

  var flags = {
    stravaEnabled: false,       // integrazione Strava (OAuth, lista attività, import)
    raceDetailEnabled: false    // schede di dettaglio gara del ranking
  };

  /* Nota unica mostrata prima di ogni percorso verso Strava / orologi (copy UX S1+S4) */
  var NOTA_SORGENTI =
    'Strava e sincronizzazione con gli orologi: non ancora disponibili. ' +
    'Carica il file GPX esportato dalla tua app o dal tuo orologio ' +
    '(su strava.com: menu "…" dell’attività > "Esporta GPX").';

  var MSG_STRAVA_NON_DISPONIBILE =
    'L’importazione da Strava non è ancora disponibile. Carica il file GPX dell’attività.';

  /* Testi italiani per gli errori di /api/import/url (copy UX S7), mappati su `code` / status HTTP */
  function testoErroreImport(code, status) {
    switch (code) {
      case 'HTML_PAGE':
        return 'Questo link porta a una pagina web, non a un file GPX. Scarica il GPX dall’app o dal sito di origine e caricalo qui sopra.';
      case 'RATE_LIMITED':
        return 'Troppe richieste in poco tempo. Riprova tra un minuto.';
      case 'UPSTREAM_TIMEOUT':
        return 'Il sito di origine non ha risposto in tempo. Riprova o carica il file dal tuo dispositivo.';
      case 'TOO_LARGE':
        return 'Il file è troppo grande (massimo 5 MB). Carica un file più piccolo dal tuo dispositivo.';
      default:
        if (status === 429) return 'Troppe richieste in poco tempo. Riprova tra un minuto.';
        if (status === 504) return 'Il sito di origine non ha risposto in tempo. Riprova o carica il file dal tuo dispositivo.';
        return 'Non riesco a leggere questo link. Controlla che sia pubblico e che punti a un file GPX, oppure carica il file dal tuo dispositivo.';
    }
  }

  /* true se la risposta dell'API indica funzione spenta (503 FEATURE_UNAVAILABLE) */
  function funzioneNonDisponibile(res, data) {
    return !!res && res.status === 503 && !!data && data.code === 'FEATURE_UNAVAILABLE';
  }

  return {
    stravaEnabled: flags.stravaEnabled,
    raceDetailEnabled: flags.raceDetailEnabled,
    NOTA_SORGENTI: NOTA_SORGENTI,
    MSG_STRAVA_NON_DISPONIBILE: MSG_STRAVA_NON_DISPONIBILE,
    testoErroreImport: testoErroreImport,
    funzioneNonDisponibile: funzioneNonDisponibile
  };
})();
