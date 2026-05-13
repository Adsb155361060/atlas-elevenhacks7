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
    return <p className="text-sm text-slate-500">Empty markdown artifact.</p>;
  }
  return (
    <div className="prose prose-invert prose-sm max-w-none prose-headings:text-slate-100 prose-a:text-emerald-400 prose-code:text-amber-300 prose-strong:text-slate-100 prose-pre:bg-slate-900/80">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  );
}
