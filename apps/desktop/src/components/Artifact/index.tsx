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
      className="w-full max-w-3xl mx-auto rounded-lg border border-slate-800 bg-slate-900/40 p-5 animate-fade-in"
      aria-label="atlas artifact"
    >
      <header className="flex items-baseline justify-between mb-4">
        <div className="text-[10px] uppercase tracking-widest text-slate-500">
          {current.kind.replace(/_/g, ' ')}
          {current.version > 1 ? (
            <span className="ml-2 text-emerald-400">· v{current.version}</span>
          ) : null}
        </div>
        {current.narration ? (
          <p className="text-xs text-slate-400 italic max-w-md text-right">
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
        <pre className="text-xs text-slate-400 overflow-x-auto bg-slate-950/60 p-3 rounded">
          {JSON.stringify(data, null, 2)}
        </pre>
      );
  }
}
