import { useFirstRun } from '../state/firstRun';

interface Capability {
  index: string;
  title: string;
  example: string;
}

const CAPABILITIES: Capability[] = [
  { index: '01', title: 'Speak naturally', example: 'Hold ⌘ + ⇧ + A and just talk.' },
  { index: '02', title: 'Live web search', example: '"What\'s the weather in Lagos tomorrow?"' },
  { index: '03', title: 'Generate images', example: '"Draw a watercolour fox in moonlight."' },
  { index: '04', title: 'Generate music', example: '"Make me a 30-second lo-fi loop."' },
  { index: '05', title: 'See your screen + camera', example: '"What\'s on my screen?"' },
  { index: '06', title: 'Read your calendar', example: '"What\'s on my schedule today?"' },
  { index: '07', title: 'Take notes', example: '"Make a note that the API spec changed."' },
  { index: '08', title: 'Set timers', example: '"Set a 10-minute timer for the pasta."' },
];

export function FirstRunTutorial() {
  const dismissed = useFirstRun((s) => s.dismissed);
  const setDismissed = useFirstRun((s) => s.setDismissed);

  if (dismissed !== false) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem('atlas:first_run_dismissed', 'true');
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(20, 17, 14, 0.92)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        className="cockpit-stage"
        style={{
          maxWidth: 720,
          width: 'calc(100% - 48px)',
          margin: '0 24px',
          border: '1px solid var(--hair-strong)',
          background: 'var(--ink)',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.6)',
        }}
      >
        <header
          style={{
            padding: '28px 32px 24px',
            borderBottom: '1px solid var(--hair-strong)',
          }}
        >
          <p
            className="mono"
            style={{
              margin: 0,
              fontSize: 10,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: 'var(--brass)',
            }}
          >
            Atlas, in eight things
          </p>
          <h2
            className="serif"
            style={{
              margin: '10px 0 0',
              fontSize: 32,
              fontWeight: 300,
              fontStyle: 'italic',
              fontVariationSettings: '"opsz" 60, "SOFT" 30',
              letterSpacing: '-0.015em',
              color: 'var(--cream)',
            }}
          >
            Talk to your computer.
            <br />
            It can actually do these.
          </h2>
        </header>
        <ul
          style={{
            margin: 0,
            padding: '24px 32px',
            listStyle: 'none',
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            columnGap: 24,
            rowGap: 18,
          }}
        >
          {CAPABILITIES.map((c) => (
            <li key={c.title} style={{ display: 'flex', gap: 14, minWidth: 0 }}>
              <span
                className="mono"
                aria-hidden
                style={{
                  flexShrink: 0,
                  fontSize: 11,
                  letterSpacing: '0.18em',
                  color: 'var(--brass)',
                  paddingTop: 3,
                }}
              >
                {c.index}
              </span>
              <div style={{ minWidth: 0 }}>
                <p
                  className="serif"
                  style={{
                    margin: 0,
                    fontSize: 15,
                    fontStyle: 'italic',
                    color: 'var(--cream)',
                    fontVariationSettings: '"opsz" 36, "SOFT" 30',
                  }}
                >
                  {c.title}
                </p>
                <p
                  className="serif-body"
                  style={{
                    margin: '4px 0 0',
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: 'var(--cream-mute)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {c.example}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <footer
          style={{
            padding: '20px 32px',
            borderTop: '1px solid var(--hair-strong)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <p
            className="mono"
            style={{
              margin: 0,
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--cream-faint)',
            }}
          >
            Re-open from Settings → About
          </p>
          <button
            type="button"
            onClick={dismiss}
            className="mono"
            style={{
              background: 'var(--brass)',
              color: 'var(--ink)',
              border: 'none',
              padding: '12px 24px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Got it
          </button>
        </footer>
      </div>
    </div>
  );
}
