/* ============================================================
   WIZTRAIL – RACESCORE ENGINE 3.0 (SAFE MODE, FULL COMPATIBILITY)
   (PATCH: miglioramento gare corte <40 km)
   ============================================================ */

window.WizRaceScore = (function () {

    /* ============================================================
       UTILS (identici alla tua versione)
    ============================================================ */

    function percentile(arr, p) {
        if (!arr.length) return 0;
        const s = [...arr].sort((a, b) => a - b);
        const i = Math.floor((p / 100) * (s.length - 1));
        return s[i];
    }

    function variance(arr) {
        if (!arr.length) return 0;
        const m = arr.reduce((a, b) => a + b, 0) / arr.length;
        return arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
    }

    function correlation(a, b) {
        const n = a.length;
        if (!n || b.length !== n) return 0;
        const am = a.reduce((x, y) => x + y, 0) / n;
        const bm = b.reduce((x, y) => x + y, 0) / n;

        let num = 0, da = 0, db = 0;
        for (let i = 0; i < n; i++) {
            const dx = a[i] - am;
            const dy = b[i] - bm;
            num += dx * dy;
            da += dx * dx;
            db += dy * dy;
        }
        const den = Math.sqrt(da * db);
        return den ? num / den : 0;
    }

    /* ============================================================
       SLOPES + CORE FACTORS
    ============================================================ */

    function computeSlopes(gpxPts, metrics) {
        const slopes = [];
        for (let i = 0; i < gpxPts.length - 1; i++) {
            const d1 = metrics.d[i];
            const d2 = metrics.d[i + 1];
            const dist = d2 - d1;
            if (dist <= 0) continue;

            const elev1 = metrics.e[i];
            const elev2 = metrics.e[i + 1];
            slopes.push((elev2 - elev1) / dist);
        }
        return slopes;
    }

    function computeSteepMaxPerKm(slopes, metrics) {
        const dist = metrics.d;
        const step = 1000;
        let maxSteep = 0;

        for (let i = 0; i < dist.length - 1; i++) {
            const d0 = dist[i];
            const d1 = d0 + step;

            let j = i;
            while (j < dist.length && dist[j] < d1) j++;
            if (j >= dist.length) break;

            const elevDiff = metrics.e[j] - metrics.e[i];
            const slope = elevDiff / step;
            if (slope > maxSteep) maxSteep = slope;
        }

        return maxSteep;
    }

    function computeCoreFactors(gpxPts, metrics) {

        const D = metrics.km;
        const Dplus = metrics.gain;

        const slopes = computeSlopes(gpxPts, metrics);
        const slopesPos = slopes.filter(s => s > 0);
        const slopesNeg = slopes.filter(s => s < 0);

        // Verticalità
        const Smean = Dplus / D;
        const Smax95 = percentile(slopesPos, 95);
        const Svar = variance(slopesPos);
        const FVERT = 1 + 0.015 * Smean + 0.025 * Smax95 + 0.04 * Svar;

        // Tecnicità
        const steepDown = slopesNeg.filter(s => s < -0.20).length / slopes.length;
        const roughness = variance(slopes);
        let FTECH = 1 + 0.6 * steepDown + 0.4 * roughness;

        // Profilo
        const n = slopes.length;
        const x = Array.from({ length: n }, (_, i) => i / (n - 1));
        const FPROFILE = 1 + 0.25 * correlation(slopes, x);

        // FRIP
        const smax = computeSteepMaxPerKm(slopes, metrics);
        const FRIP = 1 + 0.4 * smax;

        return { slopes, smax, FVERT, FTECH, FPROFILE, FRIP };
    }

    /* ============================================================
       MODEL SELECTOR (A–E)
    ============================================================ */

    function selectModel(D) {
        if (D < 25) return "A";
        if (D <= 50) return "B";
        if (D <= 90) return "C";
        if (D <= 120) return "D";
        return "E";
    }

    /* ============================================================
       FD PER MODELLO
    ============================================================ */

    function FD_A(D) { return 0.80 + 0.30 * Math.sqrt(D / 20); }
    function FD_B(D) { return 0.80 + 0.45 * Math.log(1 + D / 25); }
    function FD_C(D) { return 1.0 + 0.02 * (D - 50); }
    function FD_D(D) { return 2.0 + 0.015 * (D - 90); }
    function FD_E(D) { return Math.sqrt(D / 50) * 1.4; }

    /* ============================================================
       PESI PER MODELLO (A+B AGGIORNATI)
    ============================================================ */

    // 👇 nuovo modello A
    const W_A = { 
        FD: 0.05, 
        FVERT: 0.25, 
        FTECH: 0.50, 
        FPROFILE: 0.05, 
        FRIP: 0.15 
    };

    // 👇 nuovo modello B
    const W_B = { 
        FD: 0.18, 
        FVERT: 0.30, 
        FTECH: 0.35, 
        FPROFILE: 0.10, 
        FRIP: 0.07 
    };

    // invariati
    const W_C = { FD: 0.40, FVERT: 0.30, FTECH: 0.20, FPROFILE: 0.07, FRIP: 0.03 };
    const W_D = { FD: 0.50, FVERT: 0.30, FTECH: 0.10, FPROFILE: 0.08, FRIP: 0.02 };
    const W_E = { FD: 0.60, FVERT: 0.25, FTECH: 0.05, FPROFILE: 0.08, FRIP: 0.02 };

    function getWeights(model) {
        return model === "A" ? W_A :
               model === "B" ? W_B :
               model === "C" ? W_C :
               model === "D" ? W_D : W_E;
    }

    /* ============================================================
       BOOST PER GARE CORTE (<40 km)
    ============================================================ */

    function applyShortDistanceBoost(D, f) {
        if (D >= 40) return f;

        // 1) FD pesa meno (short distance)
        f.FD *= 0.88;    

        // 2) verticalità più importante
        f.FVERT *= 1.18;

        // 3) tecnicità molto più importante
        f.FTECH *= 1.35;

        // 4) ripidità massima decisiva
        f.FRIP *= 1.45;

        // 5) profilo altimetrico, lieve boost
        f.FPROFILE *= 1.08;

        return f;
    }

    /* ============================================================
       CLASSIFICAZIONE (A–E)
    ============================================================ */

    function classifyByModel(model, score) {

        if (model === "A") {
            if (score < 1.20) return "base";
            if (score < 1.40) return "intermedio";
            if (score < 1.60) return "avanzato";
            return "elite";
        }

        if (model === "B") {
            if (score < 1.25) return "base";
            if (score < 1.45) return "intermedio";
            if (score < 1.70) return "avanzato";
            return "elite";
        }

        if (model === "C") {
            if (score < 1.40) return "base";
            if (score < 1.60) return "intermedio";
            if (score < 1.80) return "avanzato";
            return "elite";
        }

        if (model === "D") {
            if (score < 1.50) return "base";
            if (score < 1.75) return "intermedio";
            if (score < 1.95) return "avanzato";
            return "elite";
        }

        if (score < 1.60) return "base";
        if (score < 1.85) return "intermedio";
        if (score < 2.10) return "avanzato";
        return "elite";
    }

    /* ============================================================
       COMPUTE RACESCORE MULTI‑MODELLO
    ============================================================ */

    function computeModelScore(model, f) {
        const W = getWeights(model);
        return (
            W.FD       * f.FD +
            W.FVERT    * f.FVERT +
            W.FTECH    * f.FTECH +
            W.FPROFILE * f.FPROFILE +
            W.FRIP     * f.FRIP
        );
    }

    /* ============================================================
       API PUBBLICA
    ============================================================ */

    return {

        computeFromGpx: function (gpxPts, metrics) {

            const D = metrics.km;

            // 1) scegli modello
            const model = selectModel(D);

            // 2) fattori locali
            const core = computeCoreFactors(gpxPts, metrics);

            // 3) FD per modello
            const FD =
                model === "A" ? FD_A(D) :
                model === "B" ? FD_B(D) :
                model === "C" ? FD_C(D) :
                model === "D" ? FD_D(D) : FD_E(D);

            // 4) assemblaggio fattori
            let f = {
                FD,
                FVERT: core.FVERT,
                FTECH: core.FTECH,
                FPROFILE: core.FPROFILE,
                FRIP: core.FRIP
            };

            // 5) BOOST per gare corte (<40 km)
            f = applyShortDistanceBoost(D, f);

            // 6) score finale
            const RaceScore = computeModelScore(model, f);

            // 7) classe finale
            const cls = classifyByModel(model, RaceScore);

            return {
                RaceScore,
                cls,
                range: model,
                FD: f.FD,
                FVERT: f.FVERT,
                FTECH: f.FTECH,
                FPROFILE: f.FPROFILE,
                FRIP: f.FRIP,
                debug: core
            };
        }
    };

})();