# Piano: WizTrail su Google Play come app Android (TWA)

Stato: **solo piano, nessun codice scritto** (aggiornato 25/11/2026).

## Decisioni prese
- **Tecnologia: TWA** (Trusted Web Activity) per ora. Si impacchetta la PWA esistente: nessun guscio nativo e nessuna modifica al codice dell'app, a parte quelle elencate sotto. **Capacitor resta una valutazione futura** (vedi "Passaggio futuro a Capacitor").
- **`appId` (package Android): `run.wiztrail.app`.** Non si cambia più dopo la pubblicazione.
- **Home dedicata all'app**, diversa dalla landing del sito (possibile anche con la TWA, vedi sezione 3).
- **Surfer è indipendente**: usa Kotlin nativo (Android) e Swift (iOS), scartando Capacitor perché serve il GPS a schermo spento (decisione del 25/11 sul suo branch di lavoro). WizTrail non ha quel vincolo. Nessun codice condiviso tra le due app; restano condivisi design system e account sviluppatore. Dettagli solo letti, la repo di Surfer non è stata toccata.

## Perché la TWA va bene per WizTrail
- WizTrail è già una PWA completa (manifest, service worker, offline, installabile, Web Share Target).
- Gli aggiornamenti arrivano da Vercel, senza nuove release dello store per ogni modifica al frontend.
- Stessa origine del sito: nessun problema di CORS, nessun URL base da cambiare, il service worker continua a servire l'offline.
- Meno manutenzione: nessuna build Capacitor, nessun plugin da aggiornare.

Limiti da accettare:
- Serve **Chrome** (o un browser compatibile con le TWA) sul telefono; senza, l'app ripiega su una scheda del browser.
- Nessun accesso a funzioni native oltre a quelle del web (notifiche, GPS, file picker sì; intent di sistema personalizzati no).
- Rischio di rifiuto "sito impacchettato" dallo store: va compensato con una home dedicata e con funzioni utili in app (condivisione, apertura GPX, offline).

## Lavori necessari

### 1. Requisiti PWA per la TWA
- Manifest valido con `name`, `short_name`, `start_url`, `display: standalone`, `theme_color`, icone.
- **Icona maskable in PNG** (oggi `icons/icon-maskable.svg`): Play e Bubblewrap vogliono PNG. Aggiungere `icon-maskable-512.png` con nuovo nome (regola `immutable` di `img/`, `icons/`, `fonts/`: file nuovi, non sovrascritti) e aggiornare `manifest.webmanifest`.
- Service worker funzionante offline. **Nel commit di release** aggiungere al precache `wiztrail-shell.js`, `features.js` e i file nuovi (la `CACHE_VERSION` si cambia solo lì).
- Controllo Lighthouse (PWA) su `https://wiz-trail.vercel.app`.

### 2. Digital Asset Links (obbligatorio per nascondere la barra del browser)
- Servire `https://<dominio>/.well-known/assetlinks.json` con il package `run.wiztrail.app` e l'impronta SHA-256 della chiave di firma (quella di **Play App Signing**, più eventuale chiave di upload per i test).
- Aggiungere il file al repo (cartella `.well-known/`), verificare che Vercel lo serva con `Content-Type: application/json` e senza redirect (controllare `vercel.json`), che non sia escluso da `.vercelignore` e non venga catturato dai rewrite.
- Aggiungere un test in `tests/` (esistenza del file, JSON valido, package corretto). Se il file va in una nuova pagina statica, nessun file in `api/` (restano 7 su 12).
- **Dominio**: oggi `wiz-trail.vercel.app`. Le Asset Links vincolano l'app al dominio: cambiarlo dopo la pubblicazione obbliga a una nuova release. Conviene decidere prima se acquistare un dominio proprio (stessa questione già aperta in `CLAUDE.md` e in Surfer).

### 3. Home specifica per l'app
- Nuova pagina `app-home.html`, usata come avvio dell'app.
- Nella TWA l'avvio è configurabile in Bubblewrap (`startUrl` in `twa-manifest.json`) **senza cambiare lo `start_url` del manifest web**: il sito resta com'è, la landing resta `landing.html`.
- Rilevamento dell'app: parametro `?source=twa` sull'avvio e/o `document.referrer` che inizia con `android-app://run.wiztrail.app`. Funzione unica in `wiztrail-shell.js` (`WizShell.isNativeApp`), usata per nascondere elementi solo-web (banner/pagina installazione PWA `install.html`, link alla landing) e mostrare quelli dell'app.
- Contenuti da definire (bozza): "Nuova analisi" (GPX / manuale), ultime analisi sul telefono, Training Analyzer, Ranking (beta), Stato delle funzioni.
- CSS solo in `wiztrail.css` (file unico); aggiornare il `?v=` dei file toccati. Interfaccia in italiano.
- Aggiungere `app-home.html` a `noindex` e **fuori dalla sitemap** (è una pagina operativa, `tests/seo.test.mjs` da aggiornare di conseguenza); precache nel service worker al commit di release.

### 4. Apertura di file GPX e condivisione
- Il **Web Share Target** esistente funziona in TWA se dichiarato nel manifest (Bubblewrap lo supporta): "Condividi → WizTrail" con un GPX. Da verificare in prova su telefono reale.
- "Apri con WizTrail" dal file manager (intent per `.gpx`) **non è garantito con la TWA**: da verificare; se serve, è un motivo per passare a Capacitor.
- Condivisione dei risultati: Web Share API (`navigator.share`) dove già non c'è.

### 5. Strumenti e build
- **Bubblewrap CLI** (o PWABuilder) genera il progetto Android. Cartella `android-twa/` nel repo solo con `twa-manifest.json` e documentazione; le chiavi non vanno nel repo.
- Servono JDK e Android SDK in locale. Qui nel cloud non si può compilare né provare su dispositivo: la build la fai tu (guida passo-passo da scrivere in `android-twa/README.md`).
- Firma: keystore di upload fuori dal repo; attivare **Play App Signing**.

### 6. Pubblicazione su Google Play
- Account sviluppatore (25 $ una tantum), lo stesso per Surfer.
- Account personale nuovo: **test chiuso con 12 tester per 14 giorni** prima della produzione (vale per ogni app; i tester possono essere gli stessi di Surfer).
- Scheda store (nome, descrizione e screenshot in italiano), icona 512 px, immagine di presentazione 1024×500.
- Privacy: usare `privacy.html` e compilare il modulo "Sicurezza dei dati" (WizTrail non richiede account; descrivere feedback anonimo e cookie notice).
- Classificazione contenuti, paesi, contatto (oggi contatto personale: valutare una casella dedicata).

### 7. Test
- `npm test` resta verde (nessuna rete, nessun Redis).
- Nuovi test: `assetlinks.json` valido; manifest con icona maskable PNG esistente; `app-home.html` fuori dalla sitemap e `noindex`.
- Prova su 2-3 telefoni Android reali: barra del browser assente (verifica Asset Links), offline, share target, apertura da icona, tasto indietro.

## Passaggio futuro a Capacitor
Si valuta se servono: apertura file `.gpx` da intent, salvataggio file nativo, notifiche, funzioni offline più spinte, o se lo store rifiuta la TWA.
- Il package `run.wiztrail.app` e la chiave di firma restano gli stessi: si pubblica come **aggiornamento** della stessa app, senza perdere installazioni e recensioni.
- Cambierebbero: URL base API assoluto e CORS per l'origine dell'app, disattivazione del service worker, plugin `@capacitor/app` e `@capacitor/filesystem`, intent filter. Da progettare allora.
- Per Surfer è già indicato che un guscio Capacitor resta possibile in futuro, quindi la scelta resta coerente.

## Ordine di lavoro proposto
1. Decidere il **dominio** (resta `wiz-trail.vercel.app` o dominio proprio) prima di pubblicare.
2. Icona maskable PNG e controllo Lighthouse/manifest.
3. `assetlinks.json` (con placeholder per l'impronta, da compilare dopo la prima firma) e test.
4. Home `app-home.html` e rilevamento app (da progettare insieme: contenuti e grafica).
5. Generare il progetto con Bubblewrap (in locale) e prova su telefono.
6. Test chiuso su Play (14 giorni), poi produzione.
7. Commit di release: `CACHE_VERSION` e precache dei file nuovi.

## Decisioni aperte
- Dominio definitivo.
- Contenuti e grafica della home dell'app.
- Nome pubblico nello store e contatto.
- Versione iOS (non prevista: richiede Mac, Xcode e account Apple a pagamento; la TWA è solo Android).

## Vincoli da rispettare (da CLAUDE.md)
- Plain JS IIFE, nessun framework né bundler; CSS solo in `wiztrail.css`; interfaccia in italiano.
- Non aggiungere file in `api/` (7 su 12, guardia a 10).
- Branch da `backend`, PR verso `backend`; `CACHE_VERSION` solo nel commit di release.
- `docs/` non è pubblicata sul sito (`.vercelignore`).
