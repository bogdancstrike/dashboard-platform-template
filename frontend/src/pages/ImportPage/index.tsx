/**
 * `/import` — loading a spreadsheet somebody exported from something else (§29).
 *
 * A wizard rather than a form, for the reason `CreateDashboardWizard` states:
 * **a drawer edits an object that exists, a wizard makes a decision that has
 * parts.** Which dataset, which column is which field, what is wrong with
 * which rows, and only then do it — four separate thoughts, and one form
 * asking all four at once gets a worse answer to each.
 *
 * Seven decisions worth the reader's attention.
 *
 * **The step comes from the server.** A draft holds its file and its `step`,
 * so reopening one lands where it was left rather than wherever the data
 * implies — a run whose mapping happens to be complete but which nobody has
 * looked at should land on the preview, not skip past it. That is what makes
 * the drafts on this page resumable rather than decorative.
 *
 * **The file is read in the browser and sent as text.** Not because it is
 * simpler: the API has to parse the CSV, so a presigned upload would move the
 * same bytes through the same worker twice. The size is checked here *and*
 * there, because a check only in the browser is not a check.
 *
 * **The detected separator is shown, not assumed.** Half the spreadsheets in
 * Europe are semicolon-separated because Excel follows the locale, and a
 * reader whose file came back as one column needs to see *why* and be able to
 * say otherwise. So the dialect note is on the page with the separator beside
 * it.
 *
 * **Mapping is one control per column, with samples.** Per column rather than
 * per field, because the file is the thing you are looking at and its columns
 * are what need explaining — and two columns called `name` are told apart by
 * what is in them, which is why the samples are there.
 *
 * **The preview shows the rows, with the problems on the rows.** Not a list of
 * errors beside a list of rows: the question a reader has is "what is wrong
 * with *this* line", and the line number is the file's own so it can be found
 * in the spreadsheet.
 *
 * **Every refusal is a disabled control with the reason.** Executing with a
 * required field unmapped is something somebody will reasonably try; the
 * answer is "these fields still need a column", said before they press it
 * (§76).
 *
 * **The error report is a download.** Two hundred bad rows get fixed in Excel,
 * and a screen cannot be sorted, filtered or pasted.
 */

import { Button, Card, Skeleton, Space, Steps } from "antd";
import { ReloadOutlined } from "@ant-design/icons";

import { PageHeader } from "@/components/PageHeader";

import { History } from "./History";
import { Start } from "./Start";
import { Wizard } from "./Wizard";
import { STEPS, stepIndex, summary } from "./importCopy";
import { useImportPage } from "./useImportPage";

export { outcome, stepIndex, tone, whyNotExecute } from "./importCopy";

export default function ImportPage() {
  const page = useImportPage();
  const { opened, current, catalogue, listing, targets, chosen, mapping, refresh, open, close, begun, mapped, executed, discarded } = page;

  if (catalogue.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  return (
    <div className="nu-imp nx-ad nx-ad--import">
      <PageHeader
        title="Import"
        subtitle={summary(catalogue.data)}
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
              Refresh
            </Button>
            {opened ? (
              <Button data-testid="start-over" onClick={close}>
                Start another
              </Button>
            ) : null}
          </Space>
        }
      />

      <Steps
        className="nu-imp-steps"
        size="small"
        responsive={false}
        current={stepIndex(current)}
        items={STEPS.map((entry) => ({ title: entry.title }))}
      />

      {opened && current ? (
        <Wizard
          run={current}
          catalogue={catalogue.data}
          mapping={mapping}
          onMap={page.setMapping}
          onCheck={() => mapped.mutate()}
          checking={mapped.isPending}
          onExecute={() => executed.mutate()}
          executing={executed.isPending}
          onDiscard={() => discarded.mutate(current.id)}
        />
      ) : (
        <Start
          targets={targets}
          catalogue={catalogue.data}
          chosen={chosen}
          onChoose={page.setTarget}
          onFile={(filename, content) => begun.mutate({ filename, content })}
          busy={begun.isPending}
        />
      )}

      <Card
        className="nu-imp-history"
        title="Earlier imports"
        size="small"
        data-testid="import-history"
      >
        {listing.isLoading ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : (
          <History
            rows={listing.data?.items ?? []}
            onOpen={open}
            onDiscard={(id) => discarded.mutate(id)}
          />
        )}
      </Card>
    </div>
  );
}
