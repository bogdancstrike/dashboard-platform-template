import "@/styles/decisions.css";

import { Alert, Skeleton } from "antd";

import { useSmartBack } from "@/app/history";
import { PageHeader } from "@/components/PageHeader";
import { errorText } from "@/lib/errors";
import { relativeTime } from "@/lib/time";

import { FORM_STATUS_TONE } from "./FormsPage";
import { Designer } from "./formDesigner/Designer";
import { DesignerActions } from "./formDesigner/DesignerActions";
import { FormSettingsTab } from "./formDesigner/FormSettingsTab";
import { Submissions } from "./formDesigner/Submissions";
import { useFormDesigner } from "./formDesigner/useFormDesigner";

export { moved, newField } from "./formDesigner/fieldTypes";

/**
 * The form designer: drag fields in from the palette, drag them into order,
 * map each onto a field of the record it creates, set who can answer and what
 * they are told — and read what came in.
 */
export default function FormDesignerPage() {
  const back = useSmartBack();
  const designer = useFormDesigner();
  const { id, creating, tab, setParams, loaded, list, draft, change, changeSettings } = designer;

  if ((creating ? list.isLoading : loaded.isLoading) || !draft) {
    if (loaded.isError) return <Alert type="error" showIcon message={errorText(loaded.error)} />;
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }
  const canManage = draft.can_manage;
  const target = draft.targets.find((item) => item.key === draft.target);

  return (
    <div className="nx-td" data-testid="form-designer">
      <PageHeader
        title={<>{draft.name} <em className="nx-em">form</em></>}
        onBack={() => back("/admin/forms")}
        tag={<span className={FORM_STATUS_TONE[draft.status]} style={{ marginInlineStart: 10 }}>{draft.status.toLowerCase()}</span>}
        subtitle={creating ? "Not saved yet" : `${draft.submission_count} submissions · ${draft.public_path} · updated ${relativeTime(draft.updated_at)}`}
        actions={canManage ? <DesignerActions designer={designer} /> : undefined}
      />
      <div className="nx-td-chips" role="tablist" aria-label="Form views">
        {(["design", "settings", "submissions"] as const).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} disabled={creating && key === "submissions"}
            className={`nx-td-chip${tab === key ? " is-on" : ""}`}
            onClick={() => setParams(key === "design" ? {} : { tab: key })}>
            {key === "design" ? "Design" : key === "settings" ? "Settings" : "Submissions"}
            {key === "submissions" && !creating ? <b>{draft.submission_count}</b> : null}
          </button>
        ))}
      </div>
      {tab === "design" && <Designer draft={draft} target={target} editable={canManage} onFields={(fields) => change({ fields })} />}
      {tab === "settings" && <FormSettingsTab draft={draft} editable={canManage} change={change} changeSettings={changeSettings} />}
      {tab === "submissions" && !creating && <Submissions formId={id} />}
    </div>
  );
}
