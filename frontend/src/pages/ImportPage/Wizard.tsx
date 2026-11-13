import { Alert, Card, Descriptions } from "antd";

import type { ImportCatalogue, ImportDetail } from "@/api/imports";
import { formatNumber } from "@/lib/formats";

import { MappingCard } from "./MappingCard";
import { PreviewCard } from "./PreviewCard";
import { outcome } from "./importCopy";

interface WizardProps {
  run: ImportDetail;
  catalogue: ImportCatalogue | undefined;
  mapping: Record<string, string>;
  onMap: (next: Record<string, string>) => void;
  onCheck: () => void;
  checking: boolean;
  onExecute: () => void;
  executing: boolean;
  onDiscard: () => void;
}

/** Steps two to four: map, check, run. */
export function Wizard({ run, catalogue, mapping, onMap, onCheck, checking, onExecute, executing, onDiscard }: WizardProps) {
  const target = catalogue?.targets.find((entry) => entry.key === run.target_entity);
  return (
    <>
      <RunFile run={run} />
      {run.status === "COMPLETED" || run.status === "FAILED" ? (
        <Alert
          type={run.status === "COMPLETED" ? "success" : "error"}
          showIcon
          className="nu-imp-outcome"
          data-testid="import-outcome"
          message={outcome(run)}
          description={
            run.status === "FAILED"
              ? run.errors.find((problem) => problem.line === 0)?.message ??
                "Nothing was imported. The whole file is applied or none of it is."
              : `Imported into ${run.target_label}.`
          }
        />
      ) : null}
      {run.status !== "COMPLETED" && run.status !== "CANCELLED" ? (
        <MappingCard run={run} target={target} mapping={mapping} onMap={onMap} onCheck={onCheck} checking={checking} onDiscard={onDiscard} />
      ) : null}
      {run.status === "VALIDATED" || run.status === "RUNNING" || run.error_count ? (
        <PreviewCard run={run} executing={executing} onExecute={onExecute} />
      ) : null}
    </>
  );
}

/** The file: its reference, name, dataset and rows, and the separator that was detected. */
function RunFile({ run }: { run: ImportDetail }) {
  return (
    <Card size="small" className="nu-imp-file" data-testid="import-file">
      <Descriptions column={4} size="small">
        <Descriptions.Item label="Reference">{run.reference}</Descriptions.Item>
        <Descriptions.Item label="File">{run.filename}</Descriptions.Item>
        <Descriptions.Item label="Into">{run.target_label}</Descriptions.Item>
        <Descriptions.Item label="Rows">{formatNumber(run.total_rows)}</Descriptions.Item>
      </Descriptions>
      {run.dialect ? (
        <Alert
          type={run.dialect.consistent ? "info" : "warning"}
          showIcon
          className="nu-imp-dialect"
          data-testid="dialect"
          message={run.dialect.note}
          description={
            run.dialect.consistent
              ? undefined
              : "A value containing the separator is the usual cause. The rows that disagree are listed below."
          }
        />
      ) : null}
    </Card>
  );
}
