/**
 * trail-insights.js — Insights automatici da parametri del percorso
 *
 * Espone: window.TrailInsights
 * API:    TrailInsights.generate(stats, engineResult) → { race: [], training: [] }
 *
 * Come funziona la variabilità:
 *   Ogni "concetto" (es. gestione salite) ha 3 tier di intensità.
 *   Ogni tier ha 2-3 varianti testuali equivalenti.
 *   pick() sceglie casualmente tra le varianti del tier selezionato.
 *   Parametri continui + randomizzazione → centinaia di combinazioni possibili.
 *   Ogni apertura della trail-card genera una composizione diversa.
 *
 * Struttura output:
 *   race     — 5 insight: pacing · discese · tecnicità · nutrizione · mentale
 *   training — 5 insight: volume · lavoro salite · discese · terreno tecnico · forza
 */
window.TrailInsights = (function () {
  'use strict';

  /* ------------------------------------------------------------------
     UTILITIES
     ------------------------------------------------------------------ */

  // Restituisce un elemento casuale dall'array — cuore della variabilità
  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Restituisce l'indice del tier: 0 se valore < thresholds[0],
  // 1 se < thresholds[1], ecc. Usato per scegliere il pool di varianti.
  function tier(val, thresholds) {
    for (let i = 0; i < thresholds.length; i++) {
      if (val < thresholds[i]) return i;
    }
    return thresholds.length;
  }

  /* ------------------------------------------------------------------
     TEMPLATES STRATEGIA DI GARA
     Ogni voce: array di tier, ogni tier: array di varianti testuali.
     Tier 0 = bassa intensità, tier 1 = media, tier 2 = alta.
     ------------------------------------------------------------------ */
  const RACE = {

    // Pacing — guidato da D+/km (intensità altimetrica)
    pacing: [
      [ // tier 0: basso (< 40 D+/km)
        'Il percorso non è verticalmente esigente: la gara si decide sulla velocità di crociera e sulla gestione mentale nelle fasi centrali. Evita lo sprint iniziale — costruisci gradualmente.',
        'Con dislivello contenuto, il principale rischio è partire troppo veloce nei primi km lisci. Corri a sensazione, non a orologio: il ritmo ideale emerge dopo i primi 20 minuti.',
        'Un profilo altimetrico non impegnativo favorisce ritmi più costanti. Sfrutta questa prevedibilità per gestire al meglio l\'alimentazione e l\'idratazione.',
      ],
      [ // tier 1: medio (40-80 D+/km)
        'Il dislivello distribuito richiede una gestione stabile dell\'effort. Evita le accelerate nelle salite medie: la chiave è mantenere un percepito costante anche quando il terreno varia.',
        'Con questo profilo altimetrico, sali con metodo e recupera velocemente nelle discese. Le picchi di frequenza cardiaca sulle salite medie si pagano nella seconda metà.',
        'Il bilanciamento salite-discese è favorevole a un\'andatura ragionevolmente regolare. Sfrutta i tratti meno impegnativi per idratare e alimentarti con anticipo rispetto al fabbisogno.',
      ],
      [ // tier 2: alto (> 80 D+/km)
        'L\'intensità altimetrica è elevata: ogni salita consuma riserve glicogeniche rapidamente. Parti più lento di quanto pensi di poter sostenere — il ritmo reale emerge nell\'ultimo terzo di gara.',
        'Con un profilo così verticale, la tentazione di seguire il gruppo in salita è il rischio principale. Corri la tua gara: proteggi le gambe sulle prime ascese e attacca solo quando gli altri cedono.',
        'Il dislivello concentrato impone una strategia a risparmio energetico nelle fasi iniziali. Chi mantiene i nervi sulle prime salite è chi finisce forte.',
      ],
    ],

    // Gestione discese — guidata da pendenza media discesa + roughness
    descents: [
      [ // tier 0: discese facili
        'Le discese sono gestibili tecnicamente. Puoi sfruttarle per recuperare ossigeno e guadagnare tempo senza rischi eccessivi.',
        'Il profilo in discesa non presenta criticità particolari. Mantieni un passo fluido, lascia scivolare il piede e usa la pendenza a tuo favore.',
      ],
      [ // tier 1: discese medie
        'Le discese richiedono attenzione ma sono affrontabili a ritmo sostenuto. Lavora sulla postura bassa, il ritmo veloce dei piedi e la lettura del terreno qualche metro avanti.',
        'Il terreno in discesa alterna tratti gestibili a sezioni più tecniche. Concentrati sull\'adattabilità del passo: non impostare un ritmo fisso in discesa.',
        'Le discese premiano chi ha gambe forti e mente rilassata. Evita di frenare attivamente con i quadricipiti tesi — lascia che siano i piedi a guidare la decelerazione.',
      ],
      [ // tier 2: discese severe
        'Le discese sono tecnicamente severe. In gara, privilegia sempre il controllo sulla velocità nelle sezioni più ripide: un errore qui può compromettere l\'intera gara.',
        'Il profilo in discesa è impegnativo. La resistenza eccentrica dei quadricipiti è determinante: chi non l\'ha allenata specifically si ferma sul bordo strada nell\'ultimo terzo.',
        'Discese di questa difficoltà possono devastare le gambe nelle gare lunghe. Gestisci il ritmo in discesa come una risorsa da preservare, non da bruciare nelle fasi euforiche.',
      ],
    ],

    // Tecnicità — guidata da FRIP + tech_density
    technical: [
      [ // tier 0: poco tecnico
        'Il terreno è relativamente regolare. L\'attenzione tattica può concentrarsi sul ritmo piuttosto che sulla lettura continua del percorso.',
        'La tecnicità contenuta permette di correre con meno attenzione al piede rispetto a un trail roccioso. Vantaggio per chi proviene da percorsi stradali o sentieri battuti.',
      ],
      [ // tier 1: media tecnicità
        'Le sezioni tecniche si alternano a tratti più veloci. Sfrutta i tratti regolari per recuperare mentalmente, mantieni alta la concentrazione nelle zone difficili.',
        'La variabilità del terreno richiede adattabilità continua. Non fissarti su un ritmo predefinito: lascia che sia il percorso a guidare il passo.',
        'La tecnicità media penalizza chi corre in automatico. Rimani mentalmente attivo per tutta la durata — la stanchezza cognitiva è reale quanto quella fisica.',
      ],
      [ // tier 2: molto tecnico
        'Il percorso è tecnicamente impegnativo: la scelta della scarpa e la preparazione specifica sul terreno irregolare fanno la differenza tra divertimento e sofferenza.',
        'Alta tecnicità significa alto costo energetico nascosto — il sistema nervoso si affatica quanto i muscoli. Riserva energia mentale per le sezioni chiave: non bruciarla nella prima metà.',
        'Su terreni così tecnici, la fluidità di movimento vale più della potenza pura. L\'esperienza su trail rocky o root-fest è un vantaggio determinante rispetto a chi arriva da piste.',
      ],
    ],

    // Nutrizione — guidata dalla distanza
    nutrition: [
      [ // tier 0: gara corta (< 25 km)
        'Per una gara di questa durata, l\'idratazione conta più dell\'alimentazione. Un gel a metà percorso e acqua regolare sono sufficienti per la maggior parte degli atleti.',
        'La durata permette una gestione nutrizionale semplice. Concentrati sull\'idratazione e su uno o due apporti glucidici nei momenti chiave — non sperimentare nulla di nuovo il giorno gara.',
      ],
      [ // tier 1: gara media (25-60 km)
        'Pianifica gli apporti energetici ogni 30-45 minuti. Le riserve di glicogeno non bastano per tutta la gara: inizia ad alimentarti presto, prima di sentirne la necessità.',
        'A questa distanza, una strategia nutrizionale strutturata fa la differenza. Alterna carboidrati rapidi e lenti, e non trascurare il sodio nelle ore calde o con molto sudore.',
        'La gestione nutrizionale richiede pianificazione preventiva. Identifica i ristori sul profilo altimetrico e calcola in anticipo cosa assumere in ciascuno.',
      ],
      [ // tier 2: gara lunga (> 60 km)
        'Su distanze così impegnative, l\'alimentazione è una disciplina a sé. Problemi gastrointestinali sono comuni: testa scrupolosamente la strategia nutrizionale in allenamento prima della gara.',
        'Il fabbisogno calorico è significativo. Pianifica apporti ogni 20-30 minuti, mantieni l\'idratazione costante anche quando non hai sete, e includi solidi nei ristori principali.',
        'A questa distanza, la macchina digestiva si stanca quanto quella muscolare. Prediligi alimenti familiari e solidi nei ristori principali, integra con gel o liquidi nei tratti intermedi.',
      ],
    ],

    // Strategia mentale — guidata dal numero di salite significative
    mental: [
      [ // tier 0: poche salite (< 3)
        'Il profilo non presenta grandi "muri" psicologici. Gestisci il ritmo in modo lineare, senza picchi di motivazione seguiti da crolli. La costanza premia più dell\'intensità.',
        'Con poche salite significative, la gara si legge facilmente da subito. Mantieni un approccio costante e non strafare nelle fasi iniziali quando le gambe sono fresche.',
      ],
      [ // tier 1: salite medie (3-6)
        'La struttura frammentata del percorso richiede una strategia mentale: suddividi la gara in blocchi e affronta ogni salita come un obiettivo a sé, non parte di un tutto infinito.',
        'Con più salite significative, focalizzati sempre sul prossimo punto di riferimento e non sulla distanza totale rimanente. Il conta-salite è il nemico della testa.',
        'Ogni salita è un reset mentale. Usala per abbassare il ritmo intenzionalmente, recuperare l\'equilibrio e ripartire con energia rinnovata in discesa.',
      ],
      [ // tier 2: molte salite (> 6)
        'Il numero elevato di salite è una sfida mentale oltre che fisica. Sviluppa frasi di ancoraggio per i momenti difficili e allenati a gestire il "vuoto mentale" nelle fasi centrali — succede sempre.',
        'Con così tante salite, la seconda metà di gara è il momento critico per la testa. Prevedi mentalmente questo calo prima della partenza e prepara una risposta: ritmo più lento, alimentazione extra, mantenersi nella propria bolla.',
        'Il frazionamento del percorso può essere una risorsa psicologica: ogni salita completata è una vittoria. Cambia il frame mentale da "devo ancora fare X km" a "ho già superato Y salite".',
      ],
    ],
  };

  /* ------------------------------------------------------------------
     TEMPLATES ALLENAMENTO SPECIFICO
     Stessa struttura: tier 0 = bassa preparazione richiesta, tier 2 = alta.
     ------------------------------------------------------------------ */
  const TRAINING = {

    // Volume di preparazione — guidato da WDI_category + km
    volume: [
      [ // tier 0: Short/facile
        'La preparazione specifica richiede un volume settimanale moderato. Inserisci uscite con profilo simile nelle ultime 6 settimane, con attenzione alla progressione del dislivello.',
        'Per questa distanza, la qualità degli allenamenti conta più della quantità. Due o tre sessioni specifiche a settimana nelle ultime 8 settimane sono la base ideale.',
      ],
      [ // tier 1: Medium/Long
        'Costruisci progressivamente il volume nelle ultime 10-12 settimane. Una long run settimanale con profilo simile alla gara è essenziale per adattare i tessuti all\'accumulo.',
        'La preparazione richiede una base solida: 3-4 mesi di costruzione progressiva con uscite specifiche almeno due volte a settimana sul terreno di gara o simile.',
        'Pianifica almeno due uscite lunghe che simulino le condizioni di gara nelle ultime 8 settimane. Il corpo deve apprendere a gestire l\'accumulo di dislivello nel tempo.',
      ],
      [ // tier 2: Ultra
        'La preparazione per questa distanza richiede un ciclo lungo: 16-20 settimane con picchi di volume nelle ultime 8. Non si improvvisa un ultra in poche settimane.',
        'Per distanze ultra, la preparazione mentale conta quanto quella fisica. Inserisci uscite notturne, back-to-back long run e simulazioni di gestione della stanchezza nelle settimane chiave.',
        'Il volume specifico è alto: 600-800 km nei tre mesi precedenti è una base realistica. Includi back-to-back long run e uscite con dislivello cumulato simile a quello di gara.',
      ],
    ],

    // Lavoro in salita — guidato da D+/km
    uphill: [
      [ // tier 0: basso dislivello specifico
        'Il lavoro in salita non è la priorità per questo percorso. Concentrati sulla resistenza aerobica generale e una sessione di hill running moderato a settimana è sufficiente.',
        'Con dislivello contenuto, ottimizza il lavoro in piano e sulle salite moderate. Un interval training in salita ogni 7-10 giorni è un supporto adeguato.',
      ],
      [ // tier 1: medio
        'Inserisci sessioni specifiche di uphill running a ritmo gara nelle ultime 8 settimane. Prioritizza salite con pendenza simile a quella media del percorso — la specificità è tutto.',
        'Il lavoro in salita è centrale nella preparazione. Alterna lunghe salite aerobiche con ripetute brevi e intense per sviluppare sia la resistenza che la potenza muscolare.',
        'Simulare le pendenze specifiche è fondamentale. Se non hai disponibilità di salite locali adeguate, usa il tapis roulant in inclinazione con progressione settimanale.',
      ],
      [ // tier 2: alto
        'Le pendenze elevate richiedono un lavoro specifico di potenza muscolare. Inserisci sessioni di hill sprints e squat jump nelle ultime 10 settimane con progressione controllata.',
        'Salite così ripide sollecitano fortemente la catena posteriore: gluti, polpacci, tendine d\'Achille. Rafforza questi distretti con lavoro dedicato in palestra parallelamente agli allenamenti outdoor.',
        'Per prepararsi a pendenze massime importanti, il lavoro di forza è irrinunciabile. Leg press, stacchi rumeni e affondi con carico fanno parte della preparazione, non sono un optional.',
      ],
    ],

    // Condizionamento discese — guidato da pendenza discesa + roughness
    downhill: [
      [ // tier 0: discese facili
        'Il condizionamento in discesa non è critico per questo percorso. Una discesa lunga a settimana nelle ultime 6 settimane è sufficiente per arrivare preparato.',
        'Le discese non presentano esigenze particolari. Due o tre sessioni specifiche nelle settimane precedenti la gara consolidano la resistenza eccentrica necessaria.',
      ],
      [ // tier 1: medie
        'Il condizionamento eccentrico dei quadricipiti è fondamentale. Inserisci discese veloci e lavoro specifico (eccentrici, step-down unilaterale) nelle ultime 8 settimane con progressione.',
        'Per gestire bene le discese in gara, il lavoro di propriocezione è importante quanto quello di forza. Integra esercizi di equilibrio mono-podalico su superfici instabili nella routine.',
        'Allenare discese simili a quelle di gara è il modo migliore per prepararsi. Non riservarlo solo all\'ultima settimana: costruisci tolleranza eccentrica progressivamente nel tempo.',
      ],
      [ // tier 2: severe
        'Discese tecniche e ripide richiedono preparazione specifica: sessioni dedicate due volte a settimana nelle ultime 10 settimane, con progressione di velocità e complessità del terreno.',
        'Il lavoro eccentrico intensivo può causare DOMS severo se introdotto bruscamente. Aumenta il carico su 8-10 settimane prima di raggiungere l\'intensità e il volume di gara.',
        'Per discese così impegnative, la prevenzione degli infortuni è parte integrante della preparazione. Rinforzo tibiale anteriore, mobilità caviglia e stabilizzatori del ginocchio sono essenziali.',
      ],
    ],

    // Terreno tecnico — guidato da FRIP + roughness
    technical: [
      [ // tier 0: poco tecnico
        'Il terreno non richiede preparazione tecnica specifica. Inserisci qualche uscita su percorsi irregolari per mantenere l\'adattabilità del piede attiva.',
        'La tecnicità contenuta non è un fattore critico nella preparazione. Una o due uscite su sentiero nelle settimane precedenti sono sufficienti per calibrare il passo.',
      ],
      [ // tier 1: medio
        'Allenati regolarmente su terreni tecnici: radici, rocce, fango. La propriocezione si sviluppa con l\'esposizione ripetuta, non con un\'unica uscita specifica prima della gara.',
        'La tecnicità richiede adattabilità del passo. Due uscite su terreno vario a settimana per sviluppare la capacità di cambiare ritmo e appoggio in tempo reale sono un\'ottima base.',
        'La scelta della scarpa è parte della preparazione tecnica: testala sul terreno specifico con largo anticipo. Non cambiare scarpa nelle 3 settimane precedenti la gara.',
      ],
      [ // tier 2: molto tecnico
        'Per un percorso tecnicamente impegnativo, il volume su terreno specifico è la variabile più importante della preparazione. Simula le condizioni di gara il più possibile ogni settimana.',
        'Alta tecnicità significa alto costo energetico nascosto: il sistema nervoso si affatica quanto i muscoli. Inserisci uscite tecniche anche nelle sessioni di volume basso — non riservarle solo alle uscite lunghe.',
        'La preparazione tecnica richiede tempo: non si acquisisce in poche settimane. Se sei meno abituato a terreni irregolari, anticipa la preparazione specifica di 4-6 settimane rispetto al piano standard.',
      ],
    ],

    // Forza e condizionamento — guidato da SlopeVar + roughness
    strength: [
      [ // tier 0: bassa variabilità
        'Il lavoro di forza non è prioritario per questo percorso. Una routine di mantenimento base (squat, affondi, core) è sufficiente per supportare la preparazione.',
        'Mantieni una routine di forza funzionale minima nelle settimane di preparazione per prevenire infortuni da sovraccarico. Due sessioni brevi a settimana sono sufficienti.',
      ],
      [ // tier 1: media
        'Il lavoro di forza funzionale è un supporto importante: stacchi, squat, affondi e core stability. Due sessioni a settimana fino a tre settimane prima della gara, poi scalare.',
        'Il profilo variabile del percorso richiede stabilità muscolare su tutto l\'arco del movimento. Lavora su gluti, stabilizzatori della caviglia e core nelle ultime 12 settimane.',
        'Integra esercizi pliometrici nella preparazione: box jump, salti mono-podalici, balzi laterali. Migliorano la reattività e il recupero dell\'appoggio sul terreno irregolare.',
      ],
      [ // tier 2: alta variabilità/tecnicità
        'Il profilo impegnativo richiede un programma di forza strutturato e periodizzato: picco 8-10 settimane prima della gara, poi riduzione progressiva per arrivare freschi.',
        'Forza e tecnica sono inscindibili su questo percorso. Un programma specifico trail (squat eccentrico, single-leg deadlift, step-up con carico) è parte integrante della preparazione.',
        'La variabilità del terreno mette sotto stress ogni catena muscolare in modo imprevedibile. Lavora su mobilità e forza in egual misura: un muscolo rigido si infortuna prima di uno forte ma accorciato.',
      ],
    ],
  };

  /* ------------------------------------------------------------------
     GENERAZIONE INSIGHTS
     ------------------------------------------------------------------ */
  function generate(stats, engineResult) {
    if (!stats || !engineResult) return { race: [], training: [] };

    const km         = engineResult.factors.km || 0;
    const gainPerKm  = km > 0 ? (stats.gain || 0) / km : 0;
    const slopeDown  = stats.slope_down_avg || 0;
    const roughness  = stats.roughness || 0;
    const frip       = stats.frip || 0;
    const techDens   = stats.tech_density || 0;
    const climbsN    = stats.climbs_count || 0;
    const slopeVar   = stats.slope_var || 0;
    const wdiCat     = engineResult.WDI_category || 'Medium';

    // --- Tier selezione insights GARA ---
    const pacingTier  = tier(gainPerKm, [40, 80]);
    // Combina pendenza discesa e roughness in un indice composito 0-100
    const descentIdx  = slopeDown + roughness * 30;
    const descentTier = tier(descentIdx, [22, 48]);
    // Combina FRIP (0-1 → ×100) e tech density per indice tecnicità
    const techIdx     = frip * 100 + techDens;
    const techTier    = tier(techIdx, [28, 58]);
    const nutTier     = km < 25 ? 0 : km < 60 ? 1 : 2;
    const mentalTier  = tier(climbsN, [3, 7]);

    // --- Tier selezione insights ALLENAMENTO ---
    // Volume: Short → 0, Medium/Long → 1, Ultra → 2
    const volTier     = (wdiCat === 'Ultra') ? 2 : (wdiCat === 'Short') ? 0 : 1;
    const uphillTier  = tier(gainPerKm, [40, 80]);
    const downTrIdx   = slopeDown + roughness * 20;
    const downTrTier  = tier(downTrIdx, [17, 38]);
    const techTrIdx   = frip * 100 + roughness * 50;
    const techTrTier  = tier(techTrIdx, [22, 52]);
    // Forza: combina variabilità pendenza e rugosità
    const strIdx      = slopeVar * 100 + roughness * 50;
    const strTier     = tier(strIdx, [15, 40]);

    return {
      race: [
        pick(RACE.pacing[pacingTier]),
        pick(RACE.descents[descentTier]),
        pick(RACE.technical[techTier]),
        pick(RACE.nutrition[nutTier]),
        pick(RACE.mental[mentalTier]),
      ],
      training: [
        pick(TRAINING.volume[volTier]),
        pick(TRAINING.uphill[uphillTier]),
        pick(TRAINING.downhill[downTrTier]),
        pick(TRAINING.technical[techTrTier]),
        pick(TRAINING.strength[strTier]),
      ],
    };
  }

  return { generate };

})();
