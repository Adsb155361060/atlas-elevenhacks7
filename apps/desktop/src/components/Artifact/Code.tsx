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
    <div style={{ overflow: 'hidden', border: '1px solid var(--hair-strong)' }}>
      {d.filename ? (
        <div
          className="mono"
          style={{
            padding: '8px 14px',
            background: 'rgba(20, 17, 14, 0.85)',
            fontSize: 11,
            color: 'var(--cream-mute)',
            borderBottom: '1px solid var(--hair-strong)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{d.filename}</span>
          <span
            style={{
              fontSize: 9,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: 'var(--brass)',
            }}
          >
            {language}
          </span>
        </div>
      ) : null}
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: '14px 16px',
          background: 'rgba(20, 17, 14, 0.85)',
          fontSize: 13,
        }}
        wrapLongLines
      >
        {source}
      </SyntaxHighlighter>
    </div>
  );
}
