import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownData {
  text?: string;
  content?: string;
  body?: string;
}

export function MarkdownArtifact({ data }: { data: unknown }) {
  const d = (data as MarkdownData) ?? {};
  const body = d.text ?? d.content ?? d.body ?? '';
  if (!body) {
    return (
      <p
        className="mono"
        style={{
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--cream-faint)',
        }}
      >
        Empty markdown artifact
      </p>
    );
  }
  return (
    <div
      className="serif-body atlas-markdown"
      style={{ color: 'var(--cream)', fontSize: 15, lineHeight: 1.65 }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  );
}
