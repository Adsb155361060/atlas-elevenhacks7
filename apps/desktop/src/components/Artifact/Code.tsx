import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodeData {
  code?: string;
  source?: string;
  language?: string;
  lang?: string;
  filename?: string;
}

export function CodeArtifact({ data }: { data: unknown }) {
  const d = (data as CodeData) ?? {};
  const source = d.code ?? d.source ?? '';
  const language = (d.language ?? d.lang ?? 'plaintext').toLowerCase();
  return (
    <div className="rounded-md overflow-hidden border border-slate-800">
      {d.filename ? (
        <div className="px-3 py-1.5 bg-slate-900/60 text-[11px] font-mono text-slate-400 border-b border-slate-800 flex items-center justify-between">
          <span>{d.filename}</span>
          <span className="uppercase tracking-widest text-[9px]">{language}</span>
        </div>
      ) : null}
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{ margin: 0, padding: '1rem', background: 'rgb(15 23 42 / 0.6)' }}
        wrapLongLines
      >
        {source}
      </SyntaxHighlighter>
    </div>
  );
}
