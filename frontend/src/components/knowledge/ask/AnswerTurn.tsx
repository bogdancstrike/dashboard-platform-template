import type { Answer, Citation } from "@/api/knowledge";
import { MiniMarkdown } from "@/components/knowledge/MiniMarkdown";

export function AnswerTurn({
  turn,
  onCite,
}: {
  turn: Answer;
  onCite: (citation: Citation) => void;
}) {
  const byN = new Map(turn.citations.map((citation) => [citation.n, citation]));
  return (
    <div className="nx-kn-turn" data-testid="answer">
      <div className="nx-kn-q">{turn.question}</div>
      <div className={`nx-kn-a${turn.status === "NO_ANSWER" ? " nx-kn-a--none" : ""}`}>
        <MiniMarkdown
          text={turn.answer}
          cite={(n) => {
            const citation = byN.get(n);
            if (!citation) return null;
            return (
              <button
                type="button"
                className="nx-kn-cite"
                onClick={() => onCite(citation)}
                aria-label={`Source ${n}: ${citation.file_name}${citation.page ? `, page ${citation.page}` : ""}`}
                data-testid="answer-cite"
              >
                {n}
              </button>
            );
          }}
        />
        {turn.citations.length > 0 && (
          <div className="nx-kn-sources">
            {turn.citations.map((citation) => (
              <button
                key={citation.n}
                type="button"
                className="nx-kn-source"
                onClick={() => onCite(citation)}
                data-testid="answer-source"
              >
                <span className="nx-kn-source-n">{citation.n}</span>
                <span className="nx-kn-source-body">
                  <span className="nx-kn-source-file">
                    {citation.file_name}
                    {citation.page ? (
                      <span className="nx-kn-source-page"> · p. {citation.page}</span>
                    ) : null}
                  </span>
                  <span className="nx-kn-source-quote">{citation.quote}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
