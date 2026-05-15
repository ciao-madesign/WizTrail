# WizTrail Public API — Reference

**Base URL:** `https://wiz-trail.vercel.app`  
**Version:** v1  
**Auth:** API key via header `x-api-key`  
**Rate limit:** 30 richieste/minuto per IP  

> **Note sulla disponibilità:** l'API è ospitata sul piano Vercel Hobby.
> Non è previsto un SLA formale. Per integrazioni commerciali ad alto volume
> contattare il team WizTrail.

---

## Autenticazione

Ogni richiesta deve includere una chiave API nell'header HTTP:

```
x-api-key: <la-tua-chiave>
```

Le chiavi API sono distribuite manualmente. Per richiederne una, contattare il team WizTrail.

---

## Errori

Tutti gli errori restituiscono un oggetto JSON con campo `error`:

```json
{ "error": "Messaggio descrittivo." }
```

| Status | Significato |
|--------|-------------|
| `400`  | Input non valido o mancante |
| `401`  | API key assente o non valida |
| `405`  | Metodo HTTP non supportato |
| `413`  | File GPX troppo grande |
| `429`  | Rate limit superato — riprova tra 1 minuto |
| `500`  | Errore interno |

---

## `POST /api/v1/analyze`

Analizza un tracciato GPX completo. Restituisce WDI, stima del tempo di gara
e piano pacing segmentato. **Output identico al calcolatore sul sito WizTrail.**

### Request

```http
POST /api/v1/analyze
Content-Type: application/json
x-api-key: <chiave>
```

```json
{
  "gpx_base64": "<file GPX/TCX/SML codificato in base64>",
  "target_time": "05:30:00",
  "specificity": 0.6,
  "terrain_class": "EE",
  "meteo": 1.0,
  "altitude": 1.0,
  "surface_level": 3,
  "granularity_km": 5
}
```

#### Campi

| Campo | Tipo | Obbligatorio | Descrizione |
|-------|------|:------------:|-------------|
| `gpx_base64` | string | ✅ | File GPX, TCX o SML codificato in Base64 |
| `target_time` | string | — | Tempo obiettivo in formato `hh:mm:ss`. Se omesso, usa la stima calcolata automaticamente |
| `specificity` | number | — | Livello dell'atleta: `0` = principiante, `1` = élite (default `0.5`) |
| `terrain_class` | string | — | Tecnicità del terreno: `Strada` `E` `EE` `EA` (default `EE`) |
| `meteo` | number | — | Fattore condizioni meteo: `1.0` = normale, `1.1` = pioggia/vento (default `1.0`) |
| `altitude` | number | — | Fattore altitudine: `1.0` = pianura, `1.05` = alta quota (default `1.0`) |
| `surface_level` | number | — | Qualità del fondo: `1`=asfalto `3`=sentiero standard `5`=roccia/neve (default `3`) |
| `granularity_km` | number | — | Dimensione dei chunk nel piano pacing. Valori: `1`, `2`, `5`, `10` (default `5`) |
| `vel_base` | number | — | Velocità di riferimento su piano (km/h). Se omesso viene derivata da `specificity` |

#### Codifica il GPX

```bash
# Linux/macOS
base64 -w 0 mia_gara.gpx

# Python
import base64
b64 = base64.b64encode(open("mia_gara.gpx", "rb").read()).decode()
```

### Response `200`

```json
{
  "wdi": 68.4,
  "wdi_norm": 6.8,
  "wdi_category": "Medium",
  "class": "Advanced",
  "color": "#F4C20D",
  "tech_score": 71.2,
  "tech_class": "Tecnico",
  "discipline": "sky",
  "max_altitude": 2487,
  "distance_km": 24.3,
  "dplus": 2041,
  "time_estimate": {
    "seconds": 14820,
    "formatted": "4:07:00"
  },
  "avg_pace": {
    "sec_km": 610,
    "formatted": "10:10/km"
  },
  "pacing_plan": [
    {
      "km_end": 5,
      "dist_km": 4.98,
      "pace_sec_km": 538,
      "pace_str": "8:58/km",
      "time_str": "0:44:30",
      "cumulative_sec": 2670,
      "dplus": 312,
      "dminus": 48,
      "faster_than_avg": true
    }
  ]
}
```

#### Campi della risposta

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `wdi` | number | WDI grezzo (scala assoluta, usato per tutti i calcoli interni) |
| `wdi_norm` | number | WDI normalizzato 0–10 per categoria di distanza |
| `wdi_category` | string | Categoria distanza: `Short` `Medium` `Long` `Ultra` |
| `class` | string | Classe difficoltà: `Sport` `Pro` `Advanced` `Extreme` `Elite` `Legend` |
| `color` | string | Colore esadecimale della classe |
| `tech_score` | number | TechScore 0–100 (tecnicità del terreno) |
| `tech_class` | string | Livello tecnicità: `Facile` `Scorrevole` `Moderato` `Tecnico` `Molto tecnico` `Alpinistico` `Estremo` |
| `discipline` | string | Disciplina classificata: `trail` `sky` `mountain` `ultra` `xc` |
| `max_altitude` | number | Quota massima in metri |
| `distance_km` | number | Distanza totale in km |
| `dplus` | number | Dislivello positivo in metri |
| `time_estimate.seconds` | number | Stima tempo totale in secondi |
| `time_estimate.formatted` | string | Stima tempo in formato `h:mm:ss` |
| `avg_pace.sec_km` | number | Passo medio in secondi/km |
| `avg_pace.formatted` | string | Passo medio in formato `mm:ss/km` |
| `pacing_plan` | array | Piano pacing segmentato (un oggetto per chunk) |
| `pacing_plan[].km_end` | number | Km di fine del chunk |
| `pacing_plan[].dist_km` | number | Distanza del chunk in km |
| `pacing_plan[].pace_sec_km` | number | Passo previsto per il chunk in secondi/km |
| `pacing_plan[].pace_str` | string | Passo previsto in formato `mm:ss/km` |
| `pacing_plan[].time_str` | string | Orario cumulativo (dall'inizio) in formato `h:mm:ss` |
| `pacing_plan[].cumulative_sec` | number | Orario cumulativo in secondi |
| `pacing_plan[].dplus` | number | Dislivello positivo del chunk in metri |
| `pacing_plan[].dminus` | number | Dislivello negativo del chunk in metri |
| `pacing_plan[].faster_than_avg` | boolean | `true` se il chunk è più veloce del passo medio |

---

## `POST /api/v1/wdi`

Calcola una **stima** WDI da input manuali, senza tracciato GPX.
Utile per valutazioni rapide di gare non ancora disponibili come file GPX.

> ⚠️ **Precisione ridotta.** Senza GPX, il motore usa valori di default per
> le caratteristiche del terreno (pendenza media, rugosità, varianza pendenza).
> Per valori accurati usa `/api/v1/analyze` con il tracciato reale.
> La risposta include sempre `"estimate": true`.

### Request

```http
POST /api/v1/wdi
Content-Type: application/json
x-api-key: <chiave>
```

```json
{
  "distance_km": 42.0,
  "dplus": 2800,
  "dminus": 2800,
  "terrain_cat": "EE",
  "surface_level": 3,
  "avg_altitude": 1400,
  "max_altitude": 2400
}
```

#### Campi

| Campo | Tipo | Obbligatorio | Descrizione |
|-------|------|:------------:|-------------|
| `distance_km` | number | ✅ | Distanza totale in km |
| `dplus` | number | ✅ | Dislivello positivo in metri |
| `dminus` | number | — | Dislivello negativo in metri (default: uguale a `dplus`) |
| `terrain_cat` | string | — | Categoria terreno: `E` `EE` `EA` (default `EE`) |
| `surface_level` | number | — | Qualità fondo 1–5 (default `3`) |
| `avg_altitude` | number | — | Quota media in metri (default `800`) |
| `max_altitude` | number | — | Quota massima in metri — usata per la classificazione disciplina (default `0`) |

### Response `200`

```json
{
  "estimate": true,
  "wdi": 65.8,
  "wdi_norm": 6.4,
  "wdi_category": "Medium",
  "class": "Advanced",
  "color": "#F4C20D",
  "tech_score": 63.2,
  "tech_class": "Tecnico",
  "discipline": "mountain",
  "distance_km": 42.0,
  "dplus": 2800
}
```

---

## Esempi pratici

### cURL — analyze

```bash
# 1. Codifica il GPX
GPX_B64=$(base64 -w 0 mia_gara.gpx)

# 2. Chiama l'endpoint
curl -X POST https://wiz-trail.vercel.app/api/v1/analyze \
  -H "Content-Type: application/json" \
  -H "x-api-key: la-tua-chiave" \
  -d "{
    \"gpx_base64\": \"$GPX_B64\",
    \"target_time\": \"05:00:00\",
    \"specificity\": 0.6,
    \"terrain_class\": \"EE\",
    \"granularity_km\": 5
  }"
```

### Python

```python
import base64, requests

with open("mia_gara.gpx", "rb") as f:
    gpx_b64 = base64.b64encode(f.read()).decode()

resp = requests.post(
    "https://wiz-trail.vercel.app/api/v1/analyze",
    headers={"x-api-key": "la-tua-chiave"},
    json={
        "gpx_base64": gpx_b64,
        "target_time": "05:00:00",
        "specificity": 0.65,
        "terrain_class": "EE",
    },
    timeout=30,
)

data = resp.json()
print(f"WDI: {data['wdi']}  Classe: {data['class']}")
print(f"Tempo stimato: {data['time_estimate']['formatted']}")
for chunk in data["pacing_plan"]:
    print(f"  KM {chunk['km_end']:>4} — {chunk['pace_str']}  ({'+' if not chunk['faster_than_avg'] else '-'})")
```

### JavaScript / Node.js

```js
const fs = require('fs');

const gpxB64 = fs.readFileSync('mia_gara.gpx').toString('base64');

const res = await fetch('https://wiz-trail.vercel.app/api/v1/analyze', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'la-tua-chiave',
  },
  body: JSON.stringify({
    gpx_base64: gpxB64,
    target_time: '05:00:00',
    specificity: 0.6,
    terrain_class: 'EE',
    granularity_km: 5,
  }),
});

const data = await res.json();
console.log(`WDI: ${data.wdi} — ${data.class}`);
```

---

## Valori di riferimento

### Classi WDI

| Classe | WDI grezzo | Descrizione |
|--------|-----------|-------------|
| Sport | < 22 | Gare accessibili, terreno facile |
| Pro | 22–40 | Impegno moderato, per corridori allenati |
| Advanced | 40–70 | Gare tecniche, dislivello significativo |
| Extreme | 70–120 | Gare impegnative, alta montagna |
| Elite | 120–200 | Gare d'alta difficoltà, élite |
| Legend | > 200 | Le gare più dure al mondo |

### Categorie WDI normalizzato (0–10)

Il WDI viene normalizzato in base alla distanza per confrontare gare di lunghezza diversa:

| Categoria | Distanza | WDI grezzo (0→10) |
|-----------|----------|-------------------|
| Short | ≤ 25 km | 15 → 65 |
| Medium | 26–50 km | 20 → 120 |
| Long | 51–95 km | 50 → 175 |
| Ultra | > 95 km | 80 → 300 |

### Discipline

| Disciplina | Criteri di classificazione |
|------------|---------------------------|
| `ultra` | Distanza ≥ 95 km |
| `sky` | (quota > 2900 m e D+/km > 70) O (quota > 2200 m e D+/km > 84) O (quota > 2000 m e D+/km > 100) |
| `mountain` | D+/km > 80 e quota > 1200 m |
| `xc` | Distanza ≤ 12 km e D+ < 200 m |
| `trail` | Tutti gli altri casi |

### Terrain class

| Valore | Tipo terreno |
|--------|-------------|
| `Strada` | Asfalto, sterrato compatto |
| `E` | Sentiero segnato, tratti tecnici limitati |
| `EE` | Sentiero tecnico, pietraie, radici, pendenze sostenute |
| `EA` | Terreno alpinistico, roccia, creste, esposizione |

---

## Rate limits e quote

| Piano | Limite | Note |
|-------|--------|------|
| Standard | 30 req/min per IP | Header `X-RateLimit-Remaining` nella risposta |

Il limite è condiviso tra tutti gli endpoint (`/api/v1/analyze` e `/api/v1/wdi`).
Superato il limite, ricevi `HTTP 429` — riprova dopo 60 secondi.

---

## Changelog

| Data | Versione | Note |
|------|----------|------|
| 2026-05-15 | v1.0 | Prima release pubblica: `/api/v1/analyze`, `/api/v1/wdi` |
