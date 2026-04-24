const { useState } = React;

/* ═══════════════════════════════════════════════════════════════
   Primitives
   ═══════════════════════════════════════════════════════════════ */

const Eyebrow = ({ children, style }) => (
  <div style={{
    fontSize: 11, fontWeight: 700, letterSpacing: '0.18em',
    textTransform: 'uppercase', color: 'var(--wt-teal)', opacity: 0.9,
    ...style
  }}>{children}</div>
);

const SectionTitle = ({ children, size = 'h2', style }) => {
  const sizeMap = {
    hero: { fontSize: 'clamp(2.4rem, 5.4vw, 3.8rem)', lineHeight: 1.1, fontWeight: 400, letterSpacing: '-0.5px' },
    h2:   { fontSize: 'clamp(1.6rem, 3.6vw, 2.4rem)', lineHeight: 1.2, fontWeight: 300, letterSpacing: '-0.3px' },
  };
  return <h2 style={{ fontFamily: 'var(--wt-font-sans)', color: '#e8f5f4', margin: 0, ...sizeMap[size], ...style }}>{children}</h2>;
};

const Button = ({ variant = 'primary', children, onClick, style }) => {
  const base = {
    fontFamily: 'var(--wt-font-sans)', border: 'none', borderRadius: 10,
    padding: '12px 24px', fontWeight: 700, fontSize: '0.95rem',
    letterSpacing: '0.3px', cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 8,
    transition: 'background 200ms, transform 80ms, opacity 150ms, border-color 150ms, color 150ms',
    textDecoration: 'none',
  };
  const variants = {
    primary: { background: 'var(--wt-teal)', color: '#002b2b' },
    secondary: { background: '#263243', color: '#fff' },
    ghost: {
      background: 'transparent', color: 'rgba(232,245,244,0.78)',
      border: '1px solid rgba(79,209,197,0.35)', padding: '11px 23px',
    },
    link: {
      background: 'none', color: 'var(--wt-muted)', padding: 0,
      textDecoration: 'underline', textUnderlineOffset: 3, fontWeight: 400, fontSize: '0.82rem',
    },
  };
  return (
    <button onClick={onClick} style={{ ...base, ...variants[variant], ...style }}
      onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.97)'}
      onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
      onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
    >{children}</button>
  );
};

/* ═══════════════════════════════════════════════════════════════
   Header
   ═══════════════════════════════════════════════════════════════ */

const Header = ({ active, onNav }) => (
  <header style={{
    position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    height: 56, padding: '8px 20px',
    background: 'linear-gradient(to bottom, rgba(10,15,20,0.82) 0%, rgba(10,15,20,0.0) 100%)',
    backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
  }}>
    <a href="#" onClick={(e) => { e.preventDefault(); onNav('landing'); }}
       style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
      <img src="../../assets/logo.svg" alt="WizTrail" style={{ width: 26, height: 26, display: 'block' }} />
      <span style={{ fontFamily: 'var(--wt-font-sans)', fontWeight: 700, letterSpacing: '0.3px', color: 'var(--wt-ink)', opacity: 0.95 }}>WizTrail</span>
    </a>
    <nav style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
      {[
        ['app', 'Calcolatore'],
        ['about', 'Il Metodo'],
        ['ranking', 'Ranking'],
      ].map(([id, label]) => (
        <a key={id} href="#" onClick={(e) => { e.preventDefault(); onNav(id); }}
           style={{
             fontFamily: 'var(--wt-font-sans)', fontSize: '0.82rem',
             color: active === id ? 'var(--wt-teal)' : 'var(--wt-muted)',
             textDecoration: 'none', letterSpacing: '0.3px', transition: 'color 150ms',
           }}>{label}</a>
      ))}
      <a href="#" onClick={(e) => { e.preventDefault(); onNav('app'); }}
         style={{
           fontFamily: 'var(--wt-font-sans)', fontSize: '0.78rem', fontWeight: 600,
           color: 'var(--wt-bg)', background: 'var(--wt-teal)',
           padding: '7px 14px', borderRadius: 4, textDecoration: 'none',
         }}>Apri l'app →</a>
    </nav>
  </header>
);

/* ═══════════════════════════════════════════════════════════════
   Landing — Hero
   ═══════════════════════════════════════════════════════════════ */

const LandingHero = ({ onCta }) => (
  <section style={{
    position: 'relative', minHeight: '94vh', display: 'flex', alignItems: 'flex-end', overflow: 'hidden',
    background: 'linear-gradient(135deg, #0a1f1f 0%, #021010 40%, #01181a 100%)',
  }}>
    {/* topo texture ambient layer */}
    <div style={{
      position: 'absolute', inset: 0,
      backgroundImage: "url('../../assets/topo_texture.png')",
      backgroundSize: '720px', opacity: 0.06, filter: 'invert(1)',
    }} />
    {/* radial teal ambient */}
    <div style={{
      position: 'absolute', inset: 0,
      background: 'radial-gradient(1200px 600px at 75% 20%, rgba(79,209,197,0.22), transparent 55%), radial-gradient(900px 600px at 10% 90%, rgba(14,140,120,0.18), transparent 55%)',
    }} />
    {/* bottom vignette */}
    <div style={{
      position: 'absolute', inset: 0,
      background: 'linear-gradient(to bottom, rgba(2,26,26,0.05) 0%, rgba(2,26,26,0.35) 55%, rgba(2,26,26,0.92) 100%)',
    }} />
    <div style={{ position: 'relative', zIndex: 2, padding: '0 40px 80px', maxWidth: 720 }}>
      <Eyebrow style={{ marginBottom: 18 }}>WIZTRAIL — DIFFICULTY INDEX V5.1</Eyebrow>
      <SectionTitle size="hero" style={{ color: '#fff', marginBottom: 22 }}>
        Ogni salita ha<br />un <em style={{ fontStyle: 'italic', color: 'var(--wt-teal)' }}>peso preciso</em>.
      </SectionTitle>
      <p style={{
        fontFamily: 'var(--wt-font-sans)', fontSize: '0.95rem', color: 'rgba(232,245,244,0.72)',
        lineHeight: 1.65, margin: '0 0 36px', maxWidth: 500,
      }}>
        Carica il GPX, calcola il WDI del tuo percorso e ottieni la stima di tempo calibrata sul tuo livello. Tutto in locale, nessun account richiesto.
      </p>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Button variant="primary" onClick={onCta}>Analizza il tuo trail →</Button>
        <Button variant="ghost">Come funziona</Button>
      </div>
    </div>
    {/* scroll hint */}
    <div style={{
      position: 'absolute', bottom: 24, right: 40, zIndex: 2,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      color: 'rgba(232,245,244,0.4)', fontFamily: 'var(--wt-font-sans)',
      fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
    }}>
      <svg width="16" height="24" viewBox="0 0 16 24" fill="none">
        <rect x="1" y="1" width="14" height="22" rx="7" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="7" y="5" width="2" height="5" rx="1" fill="currentColor"/>
      </svg>
      scroll
    </div>
  </section>
);

/* ═══════════════════════════════════════════════════════════════
   Landing — Stat bar
   ═══════════════════════════════════════════════════════════════ */

const StatBar = () => {
  const stats = [
    ['96+', 'Gare calibrate'],
    ['47', 'GPX reali'],
    ['−59%', 'RMSE TechScore'],
    ['0', 'Dati inviati a server'],
  ];
  return (
    <div style={{
      background: 'rgba(10,36,36,0.95)',
      borderTop: '1px solid rgba(79,209,197,0.12)',
      borderBottom: '1px solid rgba(79,209,197,0.12)',
      display: 'flex', justifyContent: 'center',
    }}>
      {stats.map(([v, l], i) => (
        <div key={l} style={{
          flex: 1, maxWidth: 220, padding: '28px 24px', textAlign: 'center',
          borderRight: i < stats.length - 1 ? '1px solid rgba(79,209,197,0.1)' : 'none',
        }}>
          <div style={{ fontFamily: 'var(--wt-font-sans)', fontWeight: 700, fontSize: '1.9rem', color: 'var(--wt-teal)', lineHeight: 1, marginBottom: 6, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
          <div style={{ fontSize: 11, color: 'rgba(232,245,244,0.55)', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'var(--wt-font-sans)' }}>{l}</div>
        </div>
      ))}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   Landing — Feature grid
   ═══════════════════════════════════════════════════════════════ */

const FeatureCard = ({ icon, title, desc, tag }) => (
  <div style={{
    background: 'rgba(2,26,26,0.95)', padding: '40px 32px',
    transition: 'background 200ms', cursor: 'default',
  }}
    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(10,40,40,0.98)'}
    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(2,26,26,0.95)'}
  >
    <span style={{ fontSize: '2rem', marginBottom: 20, display: 'block' }}>{icon}</span>
    <h3 style={{ fontFamily: 'var(--wt-font-sans)', fontSize: '1.1rem', color: '#e8f5f4', margin: '0 0 12px', fontWeight: 400 }}>{title}</h3>
    <p style={{ fontFamily: 'var(--wt-font-sans)', fontSize: '0.82rem', color: 'rgba(232,245,244,0.6)', lineHeight: 1.7, margin: 0 }}>{desc}</p>
    {tag && <span style={{
      display: 'inline-block', marginTop: 16, padding: '4px 10px',
      background: 'rgba(79,209,197,0.1)', border: '1px solid rgba(79,209,197,0.2)',
      borderRadius: 3, fontFamily: 'var(--wt-font-sans)', fontSize: '0.68rem',
      color: 'var(--wt-teal)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600,
    }}>{tag}</span>}
  </div>
);

const FeaturesSection = () => (
  <section style={{ padding: '100px 40px', maxWidth: 1140, margin: '0 auto' }}>
    <Eyebrow style={{ marginBottom: 16 }}>LE FUNZIONALITÀ</Eyebrow>
    <SectionTitle style={{ marginBottom: 48, maxWidth: 640 }}>
      Tre strumenti, <em style={{ fontStyle: 'italic', color: 'var(--wt-teal)' }}>un solo file GPX</em>.
    </SectionTitle>
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: 2, background: 'rgba(79,209,197,0.08)', border: '1px solid rgba(79,209,197,0.1)',
      borderRadius: 8, overflow: 'hidden',
    }}>
      <FeatureCard icon="⛰️" title="WDI — Difficulty Index" desc="Calcola la difficoltà oggettiva del percorso analizzando distanza, dislivello, pendenza massima e variabilità del terreno. Calibrato su 96 gare reali." tag="WizTrail Engine v5.1" />
      <FeatureCard icon="⏱️" title="Stima tempo personalizzata" desc="Inserisci il tuo passo su 10km e ottieni una stima calibrata sul tuo livello. Il modello power-law v2.1 scala da skyrace a ultra." tag="Power-law v2.1" />
      <FeatureCard icon="📊" title="Pacing Planner" desc="Genera una tabella di pacing adattivo segmento per segmento. Ogni tratto tiene conto di pendenza, tecnicità e fatica progressiva." tag="GPX required" />
      <FeatureCard icon="🗺️" title="Mappa 2D + altimetria" desc="Visualizza la traccia su mappa con profilo altimetrico interattivo. Esporta in KML per Google Earth." tag="Leaflet · CartoDB" />
      <FeatureCard icon="🏃" title="Training Analyzer" desc="Analizza le tue sessioni di allenamento importate da Strava. Il TrainingScore adatta i giudizi al contesto di allenamento." tag="Strava OAuth" />
      <FeatureCard icon="📋" title="Report Post-gara" desc="Confronta la stima pre-gara con il risultato reale. Genera un report completo con analisi di pacing e scarto." tag="JSON export" />
    </div>
  </section>
);

/* ═══════════════════════════════════════════════════════════════
   Landing — WDI ladder
   ═══════════════════════════════════════════════════════════════ */

const WDI_CLASSES = [
  ['Sport', '#2BB7DA', 'WDI < 18', 'Trail locale 15km'],
  ['Pro', '#34A853', 'WDI 18–40', 'Valtellina Wine Trail 42K'],
  ['Advanced', '#F4C20D', 'WDI 40–80', 'Sierre-Zinal · Zegama'],
  ['Extreme', '#F79617', 'WDI 80–140', 'Speedgoat 50K'],
  ['Elite', '#E91E63', 'WDI 140–230', 'CCC 99K'],
  ['Legend', '#8E24AA', 'WDI ≥ 230', 'UTMB · Hardrock · TdG'],
];

const WDILadder = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    {WDI_CLASSES.map(([name, color, rng, ex]) => (
      <div key={name} style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '12px 16px', borderRadius: 4,
        background: 'rgba(10,36,36,0.6)', borderLeft: `3px solid ${color}`,
        transition: 'background 200ms',
      }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(10,36,36,0.9)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(10,36,36,0.6)'}
      >
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--wt-font-sans)', fontSize: '0.8rem', fontWeight: 600, color, minWidth: 80 }}>{name}</span>
        <span style={{ fontFamily: 'var(--wt-font-sans)', fontSize: '0.72rem', color: 'rgba(232,245,244,0.4)' }}>{rng}</span>
        <span style={{ fontFamily: 'var(--wt-font-sans)', fontSize: '0.7rem', color: 'rgba(232,245,244,0.4)', marginLeft: 'auto', textAlign: 'right' }}>{ex}</span>
      </div>
    ))}
  </div>
);

const WDIShowcase = () => (
  <div style={{
    padding: '80px 40px', background: 'rgba(5,20,20,0.6)',
    borderTop: '1px solid rgba(79,209,197,0.08)',
    borderBottom: '1px solid rgba(79,209,197,0.08)',
  }}>
    <div style={{
      maxWidth: 1100, margin: '0 auto',
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'center',
    }}>
      <div>
        <Eyebrow style={{ marginBottom: 16 }}>IL WDI</Eyebrow>
        <SectionTitle style={{ marginBottom: 24 }}>
          Sei classi di difficoltà,<br /><em style={{ fontStyle: 'italic', color: 'var(--wt-teal)' }}>calibrate su dati reali</em>.
        </SectionTitle>
        <p style={{ fontFamily: 'var(--wt-font-sans)', fontSize: '0.82rem', color: 'rgba(232,245,244,0.55)', lineHeight: 1.7, maxWidth: 420, margin: 0 }}>
          Il WizTrail Difficulty Index combina volume (D+, distanza) e tecnicità del terreno (FRIP, SlopeVar, Roughness) in un indice unico. Più GPX reali vengono caricati, più il modello si affina.
        </p>
      </div>
      <WDILadder />
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Landing — Privacy + CTA + Footer
   ═══════════════════════════════════════════════════════════════ */

const PrivacyBlock = () => (
  <div style={{
    maxWidth: 1100, margin: '0 auto',
    padding: '80px 40px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'center',
  }}>
    <div>
      <Eyebrow style={{ marginBottom: 16 }}>PRIVACY BY DESIGN</Eyebrow>
      <SectionTitle style={{ margin: 0 }}>
        Il tuo GPX rimane<br /><em style={{ fontStyle: 'italic', color: 'var(--wt-teal)' }}>sul tuo dispositivo</em>.
      </SectionTitle>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {[
        ['🔒', 'Tutto in locale', 'Parsing GPX, calcolo WDI e stima tempi avvengono nel browser. Nessun file inviato a server.'],
        ['📵', 'Nessun account', 'Non serve registrarsi. Nessun dato personale. Strava è opzionale e richiede consenso.'],
        ['📱', 'Funziona offline (PWA)', 'Installabile come app sul telefono. Una volta caricato, funziona senza connessione.'],
      ].map(([ic, t, d]) => (
        <div key={t} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <span style={{ fontSize: '1.2rem', flexShrink: 0, marginTop: 2 }}>{ic}</span>
          <div style={{ fontFamily: 'var(--wt-font-sans)', fontSize: '0.84rem', color: 'rgba(232,245,244,0.65)', lineHeight: 1.6 }}>
            <strong style={{ color: 'rgba(232,245,244,0.92)', display: 'block', marginBottom: 2 }}>{t}</strong>
            {d}
          </div>
        </div>
      ))}
    </div>
  </div>
);

const LandingCTA = ({ onCta }) => (
  <div style={{
    padding: '100px 40px', textAlign: 'center',
    background: 'linear-gradient(to bottom, transparent, rgba(5,30,30,0.8))',
  }}>
    <SectionTitle style={{ marginBottom: 16 }}>
      Pronto a calcolare il tuo <em style={{ fontStyle: 'italic', color: 'var(--wt-teal)' }}>prossimo trail</em>?
    </SectionTitle>
    <p style={{ fontFamily: 'var(--wt-font-sans)', fontSize: '0.88rem', color: 'rgba(232,245,244,0.5)', marginBottom: 32 }}>Carica il GPX. Tutto il resto è automatico.</p>
    <Button variant="primary" onClick={onCta} style={{ fontSize: '1rem', padding: '16px 36px' }}>Apri WizTrail →</Button>
  </div>
);

const Footer = () => (
  <footer style={{
    background: 'rgba(2,15,15,0.98)', borderTop: '1px solid rgba(79,209,197,0.1)',
    padding: '32px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    flexWrap: 'wrap', gap: 16,
  }}>
    <div style={{ fontFamily: 'var(--wt-font-sans)', fontSize: '0.72rem', color: 'rgba(232,245,244,0.4)', lineHeight: 1.6 }}>
      WizTrail © 2026 &nbsp;·&nbsp; Il Metodo &nbsp;·&nbsp; Licenze<br />
      Foto hero: Brian Erickson su Unsplash (Unsplash License)
    </div>
    <div style={{ display: 'flex', gap: 20 }}>
      {['YouTube', 'Ranking', 'Training', 'Installa PWA'].map(l => (
        <a key={l} href="#" style={{ fontFamily: 'var(--wt-font-sans)', fontSize: '0.72rem', color: 'rgba(232,245,244,0.45)', textDecoration: 'none' }}>{l}</a>
      ))}
    </div>
  </footer>
);

/* ═══════════════════════════════════════════════════════════════
   App — Calculator
   ═══════════════════════════════════════════════════════════════ */

const GPXDropzone = ({ loaded, onClick }) => (
  <label onClick={onClick} style={{
    display: 'flex', alignItems: 'center', gap: 14,
    padding: 16, borderRadius: 10,
    border: loaded ? '1.5px solid var(--wt-teal)' : '1.5px dashed rgba(79,209,197,0.4)',
    cursor: 'pointer', marginBottom: 10,
    background: loaded ? 'rgba(79,209,197,0.07)' : 'rgba(79,209,197,0.04)',
    transition: 'all 200ms',
  }}>
    <div style={{ color: 'var(--wt-teal)', opacity: loaded ? 1 : 0.75, flexShrink: 0 }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontFamily: 'var(--wt-font-sans)', fontSize: '0.88rem', color: 'var(--wt-ink)', fontWeight: 500 }}>
        {loaded ? '✓ Sierre-Zinal-2023.gpx · 31.2 km · 2215 D+' : 'Trascina il GPX qui o clicca per selezionare'}
      </span>
      <span style={{ fontFamily: 'var(--wt-font-sans)', fontSize: '0.72rem', color: 'var(--wt-muted)', opacity: 0.75 }}>
        GPX · TCX · XML — Garmin, Suunto, Wikiloc, Komoot
      </span>
    </div>
  </label>
);

const Field = ({ label, hint, children }) => (
  <div>
    <label style={{ display: 'block', fontWeight: 600, margin: '6px 0 4px', fontSize: '0.85rem' }}>
      {label} {hint && <span style={{ fontFamily: 'var(--wt-font-sans)', fontSize: '0.74rem', opacity: 0.6, fontWeight: 400 }}>— {hint}</span>}
    </label>
    {children}
  </div>
);

const Input = (props) => (
  <input {...props} style={{
    width: '100%', background: 'color-mix(in oklab, var(--wt-panel) 75%, transparent)',
    color: 'var(--wt-ink)', border: '1px solid color-mix(in oklab, var(--wt-border) 75%, transparent)',
    borderRadius: 10, padding: '8px 10px', fontSize: 14,
    fontFamily: 'var(--wt-font-mono)', outline: 'none',
    ...props.style,
  }}
    onFocus={(e) => { e.target.style.borderColor = 'var(--wt-teal)'; e.target.style.boxShadow = '0 0 0 3px color-mix(in oklab, var(--wt-teal) 20%, transparent)'; }}
    onBlur={(e) => { e.target.style.borderColor = 'color-mix(in oklab, var(--wt-border) 75%, transparent)'; e.target.style.boxShadow = 'none'; }}
  />
);

const Select = (props) => (
  <select {...props} style={{
    width: '100%', background: 'color-mix(in oklab, var(--wt-panel) 75%, transparent)',
    color: 'var(--wt-ink)', border: '1px solid color-mix(in oklab, var(--wt-border) 75%, transparent)',
    borderRadius: 10, padding: '8px 10px', fontSize: 14, fontFamily: 'var(--wt-font-sans)',
    ...props.style,
  }}>{props.children}</select>
);

const Fieldset = ({ legend, children, style }) => (
  <fieldset style={{
    border: '1px solid color-mix(in oklab, var(--wt-border) 70%, transparent)',
    borderRadius: 12, padding: '12px 14px', margin: '8px 0',
    background: 'color-mix(in oklab, var(--wt-card) 65%, transparent)',
    backdropFilter: 'blur(8px) saturate(125%)',
    ...style,
  }}>
    <legend style={{ color: 'var(--wt-muted)', fontSize: '0.92rem', padding: '0 6px' }}>{legend}</legend>
    {children}
  </fieldset>
);

const Tabs = ({ tabs, active, onChange }) => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
    {tabs.map(([id, label]) => (
      <button key={id} onClick={() => onChange(id)} style={{
        appearance: 'none',
        border: '1px solid ' + (active === id ? 'transparent' : 'var(--wt-border)'),
        background: active === id ? 'color-mix(in oklab, var(--wt-teal) 80%, transparent)' : 'color-mix(in oklab, var(--wt-panel) 70%, transparent)',
        color: active === id ? '#062827' : 'var(--wt-ink)',
        borderRadius: 10, padding: '10px 14px',
        fontFamily: 'var(--wt-font-sans)', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer',
        backdropFilter: 'blur(8px) saturate(120%)',
        transition: 'all 150ms',
      }}>{label}</button>
    ))}
  </div>
);

const KPICard = ({ title, value, sub, subColor = 'var(--wt-muted)' }) => (
  <div style={{
    background: 'color-mix(in oklab, var(--wt-teal) 6%, var(--wt-card))',
    border: '1px solid color-mix(in oklab, var(--wt-teal) 20%, var(--wt-border))',
    borderRadius: 12, padding: '14px 14px',
    backdropFilter: 'blur(8px) saturate(125%)',
    animation: 'kpiIn 250ms cubic-bezier(0.34, 1.2, 0.64, 1) both',
  }}>
    <h3 style={{ margin: '0 0 4px', fontSize: '0.95rem', fontWeight: 600 }}>{title}</h3>
    <div style={{
      fontFamily: 'var(--wt-font-sans)', fontWeight: 900, fontSize: '2.6rem',
      marginBottom: 4, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
    }}>{value}</div>
    <div style={{ fontSize: '0.78rem', opacity: 0.88, color: subColor, fontWeight: 600, marginTop: 2 }}>{sub}</div>
  </div>
);

const IntervalRow = () => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 14px', background: 'var(--wt-panel)',
    border: '1px solid var(--wt-border)', borderRadius: 8,
    fontSize: '0.88rem', marginTop: 12,
  }}>
    <span style={{ color: 'var(--wt-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, flex: 1 }}>Intervallo ±10%</span>
    <span style={{ fontWeight: 700, fontFamily: 'var(--wt-font-mono)' }}>
      <span style={{ color: 'var(--wt-muted)', fontSize: '0.7rem' }}>min </span>03:20:14
    </span>
    <span style={{ color: 'var(--wt-muted)' }}>–</span>
    <span style={{ fontWeight: 700, fontFamily: 'var(--wt-font-mono)' }}>
      04:04:22 <span style={{ color: 'var(--wt-muted)', fontSize: '0.7rem' }}>max</span>
    </span>
  </div>
);

const PacingTable = () => {
  const rows = [
    ['1–5', '5.0', '+180', '+120', '5:12', 'under', '#4fd1c5'],
    ['5–10', '5.0', '+95', '+220', '5:44', 'over', '#ff00a8'],
    ['10–15', '5.0', '+310', '+80', '6:18', 'over', '#ff00a8'],
    ['15–20', '5.0', '+60', '+180', '5:30', 'under', '#4fd1c5'],
    ['20–25', '5.0', '+140', '+95', '5:58', 'over', '#ff00a8'],
    ['25–31.2', '6.2', '+5', '+260', '5:20', 'under', '#4fd1c5'],
  ];
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--wt-font-mono)', fontSize: '0.82rem', marginTop: 14 }}>
      <thead>
        <tr>
          {['Segmento', 'Km', 'D+', 'D−', 'Pace', ''].map(h => (
            <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--wt-muted)', fontSize: '0.66rem', letterSpacing: '0.14em', textTransform: 'uppercase', borderBottom: '1px solid var(--wt-border)', fontWeight: 500 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([seg, km, dp, dm, pace, , dotColor], i) => (
          <tr key={i}>
            <td style={{ padding: '9px 10px', borderBottom: '1px solid rgba(42,57,77,0.4)' }}>{seg}</td>
            <td style={{ padding: '9px 10px', borderBottom: '1px solid rgba(42,57,77,0.4)' }}>{km}</td>
            <td style={{ padding: '9px 10px', borderBottom: '1px solid rgba(42,57,77,0.4)' }}>{dp}</td>
            <td style={{ padding: '9px 10px', borderBottom: '1px solid rgba(42,57,77,0.4)', color: 'var(--wt-muted)' }}>{dm}</td>
            <td style={{ padding: '9px 10px', borderBottom: '1px solid rgba(42,57,77,0.4)' }}>
              <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 4, fontWeight: 600, background: `color-mix(in oklab, ${dotColor} 20%, transparent)`, color: dotColor }}>{pace}</span>
            </td>
            <td style={{ padding: '9px 10px', borderBottom: '1px solid rgba(42,57,77,0.4)' }}>
              <span style={{ display: 'inline-block', height: 3, width: 32 + (i * 6), borderRadius: 2, background: 'var(--wt-teal)', opacity: 0.4, verticalAlign: 'middle' }} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

Object.assign(window, {
  Eyebrow, SectionTitle, Button, Header,
  LandingHero, StatBar, FeatureCard, FeaturesSection,
  WDILadder, WDIShowcase, PrivacyBlock, LandingCTA, Footer,
  GPXDropzone, Field, Input, Select, Fieldset, Tabs,
  KPICard, IntervalRow, PacingTable,
});
