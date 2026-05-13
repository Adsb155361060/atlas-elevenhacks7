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
    return <p className="text-sm text-slate-500">No steps in tutorial.</p>;
  }
  return (
    <div className="space-y-4">
      {d.title ? <h3 className="text-base font-medium text-slate-100">{d.title}</h3> : null}
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-medium flex items-center justify-center">
              {i + 1}
            </span>
            <div className="flex-1">
              {step.heading ? (
                <h4 className="text-sm font-medium text-slate-100">{step.heading}</h4>
              ) : null}
              {step.body ? (
                <div className="prose prose-invert prose-sm max-w-none mt-1 text-slate-300">
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
