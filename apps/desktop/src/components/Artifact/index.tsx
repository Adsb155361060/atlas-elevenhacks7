import { useArtifact } from '../../state/artifact';
import { MarkdownArtifact } from './Markdown';
import { CodeArtifact } from './Code';
import { ImageArtifact } from './Image';
import { AudioArtifact } from './Audio';
import { TableArtifact } from './Table';
import { SearchResultsArtifact } from './SearchResults';
import { ChartArtifact } from './Chart';
import { MapArtifact } from './Map';
import { TutorialArtifact } from './Tutorial';

/**
 * Renders the currently-active artifact (if any). Renders nothing when
 * `current` is null. Type-keyed switch over the eight supported artifact
 * kinds. Unknown kinds fall through to a clean JSON dump rather than crash.
 */
export function ArtifactSurface() {
  const current = useArtifact((s) => s.current);
  if (!current) return null;

  return (
    <section
      key={`${current.id}-v${current.version}`}
      aria-label="atlas artifact"
      style={{
        width: '100%',
        maxWidth: 760,
        margin: '0 auto',
        border: '1px solid var(--hair-strong)',
        background: 'rgba(20, 17, 14, 0.55)',
        padding: '24px 28px',
        animation: 'atlas-fade-in 280ms ease',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 24,
          marginBottom: 18,
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--brass)',
          }}
        >
          {current.kind.replace(/_/g, ' ')}
          {current.version > 1 ? (
            <span style={{ marginLeft: 8, color: 'var(--cream-mute)' }}>
              · v{current.version}
            </span>
          ) : null}
        </div>
        {current.narration ? (
          <p
            className="serif-body"
            style={{
              margin: 0,
              fontSize: 13,
              fontStyle: 'italic',
              color: 'var(--cream-mute)',
              maxWidth: 420,
              textAlign: 'right',
            }}
          >
            {current.narration}
          </p>
        ) : null}
      </header>
      <Body kind={current.kind} data={current.data} />
    </section>
  );
}

function Body({ kind, data }: { kind: string; data: unknown }) {
  switch (kind) {
    case 'markdown':
      return <MarkdownArtifact data={data} />;
    case 'code':
      return <CodeArtifact data={data} />;
    case 'image':
      return <ImageArtifact data={data} />;
    case 'audio':
      return <AudioArtifact data={data} />;
    case 'table':
      return <TableArtifact data={data} />;
    case 'search_results':
      return <SearchResultsArtifact data={data} />;
    case 'chart':
      return <ChartArtifact data={data} />;
    case 'map':
      return <MapArtifact data={data} />;
    case 'tutorial':
      return <TutorialArtifact data={data} />;
    default:
      return (
        <pre
          className="mono"
          style={{
            fontSize: 11,
            color: 'var(--cream-mute)',
            overflowX: 'auto',
            background: 'rgba(20, 17, 14, 0.85)',
            border: '1px solid var(--hair)',
            padding: 12,
            margin: 0,
          }}
        >
          {JSON.stringify(data, null, 2)}
        </pre>
      );
  }
}
