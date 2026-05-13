import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface TutorialData {
  title?: string;
  steps?: Array<{ heading?: string; body?: string }>;
}

export function TutorialArtifact({ data }: { data: unknown }) {
  const d = (data as TutorialData) ?? {};
  const steps = d.steps ?? [];
  if (steps.length === 0) {
    return (
      <p
        className="mono"
        style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--cream-faint)' }}
      >
        No steps in tutorial
      </p>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {d.title ? (
        <h3
          className="serif"
          style={{
            margin: 0,
            fontSize: 22,
            fontStyle: 'italic',
            color: 'var(--cream)',
            fontVariationSettings: '"opsz" 36, "SOFT" 30',
          }}
        >
          {d.title}
        </h3>
      ) : null}
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {steps.map((step, i) => (
          <li key={i} style={{ display: 'flex', gap: 14 }}>
            <span
              className="mono"
              style={{
                flexShrink: 0,
                fontSize: 11,
                letterSpacing: '0.18em',
                color: 'var(--brass)',
                paddingTop: 3,
                width: 28,
              }}
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <div style={{ flex: 1 }}>
              {step.heading ? (
                <h4
                  className="serif"
                  style={{
                    margin: 0,
                    fontSize: 15,
                    fontStyle: 'italic',
                    color: 'var(--cream)',
                    fontVariationSettings: '"opsz" 36, "SOFT" 30',
                  }}
                >
                  {step.heading}
                </h4>
              ) : null}
              {step.body ? (
                <div
                  className="serif-body atlas-markdown"
                  style={{
                    marginTop: 6,
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: 'var(--cream-dim)',
                  }}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{step.body}</ReactMarkdown>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
