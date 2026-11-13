import { Button, Input } from "antd";

import { KnIcon } from "@/components/icons/KnIcon";

import type { InsightsPageData } from "../useInsightsPage";

/** The question box: ask, pick the data, generate. */
export function AskBox({ page }: { page: InsightsPageData }) {
  const { question, setQuestion, list, generate, suggest, busy, current, ask } = page;
  return (
    <div className="nx-in-ask nx-glass" data-testid="insight-ask">
      <form
        className="nx-in-ask-row"
        onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}
      >
        <span className="nx-in-ask-mark">
          <KnIcon name="insights" size={18} />
        </span>
        <Input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="e.g. Which channels bring the most revenue, and is it growing?"
          maxLength={500}
          variant="borderless"
          data-testid="insight-question"
          aria-label="Your question about the data"
        />
        <Button
          type="primary"
          htmlType="submit"
          loading={generate.isPending}
          disabled={!question.trim()}
          data-testid="insight-generate"
        >
          Build insight
        </Button>
      </form>
      <div
        className={`nx-in-chips${list.isLoading ? " is-loading" : ""}`}
        data-testid="insight-suggestions"
        hidden={Boolean(current) || busy}
      >
        {(list.data?.suggestions ?? []).map((item) => (
          <button
            key={item.key}
            type="button"
            className="nx-in-chip"
            disabled={busy}
            onClick={() => suggest.mutate(item.key)}
            title={item.question}
          >
            <span className="nx-in-chip-tag">{item.dataset_label}</span>
            {item.question}
          </button>
        ))}
      </div>
    </div>
  );
}
