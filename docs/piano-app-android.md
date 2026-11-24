# Piano: WizTrail come app nativa Android (Capacitor)

Stato: **solo piano, nessun codice scritto** (24/11/2026). Ordine deciso: prima Surfer (repo separata, non toccata da questa sessione), poi WizTrail con lo stesso percorso.

## Obiettivo
Pubblicare WizTrail su Google Play come app Capacitor che impacchetta il frontend esistente, con una **home dedicata all'app** diversa dalla landing del sito.

## Perché è fattibile
- Frontend HTML/JS puro, nessun bundler: la cartella da impacchettare è semplice.
- Engine WDI, parser GPX, pacing e timing girano già nel browser e funzionano offline.
- Leaflet è self-hosted.
- Nessun vincolo nativo critico (a differenza di Surfer, che ha bisogno del GPS in background).

## Lavori necessari

### 1. Struttura progetto
- Cartella `android-app/` (o `app/`) con `package.json`, `capacitor.config.json` e script di copia dei file statici in `www/`.
- Nessun bundler: la regola "non introdurre build tools" resta valida (solo script di copia).
- `appId` dedicato, ad esempio `app.wiztrail`. Da decidere prima della pubblicazione: non si cambia più.
- Escludere dalla copia: `docs/`, `wiztrail-calibration/`, `tests/`, `api/`, `server/`, `CLAUDE.md`, `README.md` e simili (stesso criterio di `.vercelignore`).

### 2. Chiamate alle API
- Nell'app le chiamate a `/api/...` diventano cross-origin: serve un URL base assoluto (`https://wiz-trail.vercel.app`) quando `Capacitor.isNativePlatform()` è vero.
- Aggiungere l'origine dell'app (`https://localhost`, `capacitor://localhost`) all'allowlist CORS di `api/hub.js` (oggi solo per `feedback`) e di `api/import/url.js`.
- Verificare tutte le pagine che usano `fetch` verso le API: feedback, import da URL, API v1 (queste ultime hanno chiave, non interessano l'app).
- Gestire il caso offline: calcolo da GPX e manuale funzionano; feedback e import da URL no (messaggio chiaro in italiano).

### 3. Service worker e PWA
- Disattivare la registrazione del service worker nella build nativa (i file sono già locali).
- Web Share Target e `manifest.webmanifest` non valgono nell'app: sostituirli con gli intent filter Android per aprire file `.gpx` da altre app ("Apri con WizTrail").
- Plugin: `@capacitor/app` (evento `appUrlOpen`), `@capacitor/filesystem` o equivalente per leggere il file ricevuto.

### 4. Routing e link
- I redirect di `vercel.json` (`/` → `/landing.html`, `/wdi.html` e `/pacing.html` → `about.html`) non esistono nell'app: usare link diretti.
- Canonical, sitemap e header SEO non servono nella build nativa.
- Link esterni (privacy, condizioni, sito) aperti con `@capacitor/browser`.

### 5. Home specifica per l'app (possibile)
La landing del sito è pensata per SEO e conversione; l'app ha bisogno di un punto di ingresso operativo.

- Nuova pagina `app-home.html`, caricata come pagina iniziale solo nella build nativa (`start_url` / `server.url` o `webDir` con `index` dedicato).
- Contenuti da definire (bozza): "Nuova analisi" (GPX / manuale), ultime analisi salvate sul telefono, accesso a Training Analyzer, Ranking (beta), Info/Stato funzioni.
- Stesso design system e `wiztrail.css`; nuove regole in `wiztrail.css` (file CSS unico, regola 7).
- Nel web resta tutto com'è: `landing.html` è la home del sito. La stessa app-home può anche stare sul sito come pagina non indicizzata, ma non è necessario.
- Rilevamento piattaforma in un punto solo, ad esempio una piccola funzione in `features.js` o `wiztrail-shell.js` (`WizShell.isNativeApp`), usata per nascondere elementi solo-web (banner installazione PWA, `install.html`, link alla landing, cookie notice dove non serve) e mostrare quelli dell'app.
- Navigazione: la tab bar esiste già nell'HTML di ogni pagina; verificare che i link puntino alla home dell'app.

### 6. Funzioni native utili (per evitare il rifiuto "sito impacchettato")
- Apertura file GPX da altre app e dal file manager.
- Salvataggio locale delle analisi (cronologia sul telefono).
- Condivisione dei risultati con la share sheet di Android (`@capacitor/share`).
- Opzionali, più avanti: notifiche, esportazione file.

### 7. Aspetto e comportamento
- Icone adattive Android, splash screen, colore barra di stato (`#002b2b`), area sicura, tasto indietro.
- Rinominare file in `img/`, `icons/`, `fonts/` se modificati (regola `immutable`; nell'app non conta ma vale per il sito).

### 8. Pubblicazione su Google Play
- Account sviluppatore (25 $ una tantum).
- Per un account personale nuovo: **test chiuso con 12 tester per 14 giorni** prima della produzione.
- Scheda store, screenshot, icona, descrizione in italiano.
- Privacy policy (esiste `privacy.html`) e modulo "Sicurezza dei dati".
- Firma dell'app (keystore): conservare chiave e password fuori dal repo.
- Valutare l'App Bundle (`.aab`) e gli aggiornamenti: ogni modifica al frontend richiede una nuova release, oppure live update (decisione rimandata).

### 9. Test e CI
- `npm test` resta invariato (nessuna rete, nessun Redis).
- Aggiungere test sulla build nativa: file copiati, assenza di file riservati, URL base API corretto, CORS con origine app.
- Prova su dispositivi reali: almeno 2-3 telefoni Android; build e prova richiedono Android Studio in locale (non eseguibili in questo ambiente cloud).

## Alternativa leggera: TWA
Impacchettare la PWA esistente come Trusted Web Activity: nessuna modifica al codice, aggiornamenti automatici con Vercel, ma nessuna home dedicata nativa né funzioni native (la home dedicata resterebbe comunque possibile come pagina web). Da valutare se l'app deve restare un semplice contenitore.

## Ordine di lavoro proposto
1. Chiudere il prototipo Surfer (repo separata).
2. Decidere `appId`, nome store e se tenere il live update.
3. Prototipo Capacitor di WizTrail con home attuale (2-4 giorni).
4. CORS, URL base API, disattivazione service worker.
5. Home dedicata `app-home.html` (da progettare insieme).
6. Intent filter per i GPX e share sheet.
7. Test su dispositivi, test chiuso su Play, poi produzione.

## Decisioni aperte
- `appId` e nome pubblico.
- Contenuti e grafica della home dell'app.
- Capacitor o TWA.
- Live update sì/no.
- Se e quando fare la versione iOS (richiede Mac, Xcode e account Apple a pagamento).
- Dominio e contatto per le policy (oggi contatto personale).

## Vincoli da rispettare (da CLAUDE.md)
- Plain JS IIFE, nessun framework né bundler; CSS solo in `wiztrail.css`; interfaccia in italiano.
- Non aggiungere file in `api/` (7 su 12, guardia a 10): eventuali nuove azioni vanno in `api/hub.js`.
- Branch di lavoro da `backend`, PR verso `backend`; `CACHE_VERSION` del service worker solo nel commit di release.
- `docs/` non viene pubblicata sul sito (`.vercelignore`).
