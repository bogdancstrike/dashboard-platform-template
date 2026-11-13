/**
 * `/onboarding` — Getting started (§38).
 *
 * The checklist for this person's role, each step linking to where it is done;
 * most tick themselves off when the thing is actually done, and any can be
 * marked done or skipped. Administrators also get sample data per area: a tagged
 * dataset loaded through the records API and removed exactly — nothing real is
 * touched.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App as AntApp, Button, Card, Progress, Skeleton, Space, Tag, Typography } from "antd";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { onboardingApi, type Checklist, type OnboardingStep, type SampleArea } from "@/api/onboarding";
import { usePageCommands } from "@/commands/CommandContext";
import { NxIcon } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import { relativeTime } from "@/lib/time";
import "@/styles/onboarding.css";
import { queryKeys } from "@/lib/queryKeys";
import { apiMessageToast } from "@/lib/errors";

const { Text } = Typography;

const ROLE = { ADMINISTRATOR: "administrator", MANAGER: "manager", OPERATOR: "operator", ANALYST: "analyst", VIEWER: "viewer" } as Record<string, string>;

export default function OnboardingPage() {
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const checklist = useQuery({ queryKey: queryKeys.onboarding(), queryFn: ({ signal }) => onboardingApi.checklist(signal) });
  const canSamples = checklist.data?.can_load_samples ?? false;
  const samples = useQuery({ queryKey: queryKeys.onboardingSamples(), queryFn: ({ signal }) => onboardingApi.samples(signal), enabled: canSamples });

  const accept = (next: Checklist) => queryClient.setQueryData<Checklist>(queryKeys.onboarding(), next);
  const answer = useMutation({
    mutationFn: ({ key, state }: { key: string; state: "done" | "skipped" | "todo" }) => onboardingApi.answer(key, state),
    onSuccess: accept,
    onError: apiMessageToast(message, "That could not be saved."),
  });
  const card = useMutation({ mutationFn: (dismissed: boolean) => onboardingApi.dismiss(dismissed), onSuccess: accept });
  const sampleChange = useMutation({
    mutationFn: async ({ area, load }: { area: string; load: boolean }): Promise<{ areas: SampleArea[]; created?: number }> =>
      load ? onboardingApi.load(area) : onboardingApi.remove(area),
    onSuccess: (answer, { load }) => {
      queryClient.setQueryData(queryKeys.onboardingSamples(), { areas: answer.areas });
      void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.onboardingSamples()[0] });
      message.success(load ? `Loaded ${answer.created ?? 0} sample records` : "Sample data removed");
    },
    onError: apiMessageToast(message, "That could not be done."),
  });

  usePageCommands("onboarding", [
    { id: "onboarding.open", label: "Show my getting-started checklist", keywords: "onboarding checklist setup first steps", run: () => window.scrollTo({ top: 0 }) },
  ]);

  if (checklist.isError) {
    return <Alert type="error" showIcon message={checklist.error instanceof ApiError ? checklist.error.message : "The checklist could not be loaded."} />;
  }
  const data = checklist.data;
  if (!data) return <Skeleton active paragraph={{ rows: 8 }} />;

  return (
    <>
      <PageHeader
        title={<>Getting <em>started</em></>}
        subtitle={`The first steps for an ${ROLE[data.role] ?? data.role.toLowerCase()} — most tick themselves off when you do them.`}
        actions={data.dismissed ? (
          <Button onClick={() => card.mutate(false)} data-testid="restore-card">Show on Home again</Button>
        ) : (
          <Button onClick={() => card.mutate(true)} data-testid="hide-card">Hide from Home</Button>
        )}
      />
      <div className="nx-ob-grid">
        <Card size="small" className="nx-ob-steps" data-testid="onboarding-steps"
          title={<span className="nx-ob-progress-title">
            <Progress percent={data.progress.percent} size="small" strokeColor="var(--nu-accent)" className="nx-ob-bar"
              aria-label={`${data.progress.percent}% done`} />
            <Text type="secondary">{data.progress.done} of {data.progress.total}</Text>
          </span>}>
          <ol className="nx-ob-list">
            {data.steps.map((step, index) => (
              <StepRow key={step.key} step={step} index={index}
                onAnswer={(state) => answer.mutate({ key: step.key, state })} />
            ))}
          </ol>
        </Card>

        {canSamples && (
          <Card size="small" title="Sample data" className="nx-ob-samples" data-testid="sample-data">
            <Text type="secondary" className="nx-ob-hint">
              Explore an empty module with a small realistic dataset. Everything loaded is tagged; removing it deletes exactly those records.
            </Text>
            {!samples.data ? <Skeleton active paragraph={{ rows: 4 }} /> : (
              <ul className="nx-ob-areas">
                {samples.data.areas.map((area) => (
                  <li key={area.key} data-testid={`sample-${area.key}`}>
                    <span className="nx-ob-area-name"><Link to={area.route}>{area.label}</Link>
                      {area.loaded > 0 && <Tag bordered={false} color="blue">{area.loaded} sample</Tag>}</span>
                    {area.loaded > 0 ? (
                      <Button danger loading={sampleChange.isPending && sampleChange.variables.area === area.key}
                        data-testid={`remove-sample-${area.key}`}
                        onClick={() => modal.confirm({
                          title: `Remove the sample ${area.label.toLowerCase()}?`,
                          content: `The ${area.loaded} records the sample created are deleted. Nothing else is touched.`,
                          okText: "Remove", okButtonProps: { danger: true },
                          onOk: () => sampleChange.mutateAsync({ area: area.key, load: false }),
                        })}>
                        Remove
                      </Button>
                    ) : (
                      <Button loading={sampleChange.isPending && sampleChange.variables.area === area.key}
                        data-testid={`load-sample-${area.key}`} onClick={() => sampleChange.mutate({ area: area.key, load: true })}>
                        Load
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}

function StepRow({ step, index, onAnswer }: { step: OnboardingStep; index: number; onAnswer: (state: "done" | "skipped" | "todo") => void }) {
  return (
    <li className={`nx-ob-step nx-ob-step--${step.state}`} data-testid={`step-${step.key}`}>
      <span className="nx-ob-step-mark" aria-hidden="true">{step.state === "done" ? <NxIcon name="check" size={14} /> : index + 1}</span>
      <span className="nx-ob-step-text">
        <strong>{step.title}</strong>
        <span>{step.description}</span>
        <small>
          {step.state === "done" && step.auto ? "Done — we noticed" : step.state === "done" ? `Marked done${step.completed_at ? ` ${relativeTime(step.completed_at)}` : ""}`
            : step.state === "skipped" ? "Skipped" : step.automatic ? "Ticks itself off when you do it" : ""}
        </small>
      </span>
      <Space size={6} wrap className="nx-ob-step-actions">
        <Link to={step.to}><Button type={step.state === "todo" ? "primary" : "default"}>{step.action}</Button></Link>
        {step.state === "todo" ? (
          <>
            <Button onClick={() => onAnswer("done")} data-testid={`done-${step.key}`}>Mark done</Button>
            <Button type="text" onClick={() => onAnswer("skipped")} data-testid={`skip-${step.key}`}>Skip</Button>
          </>
        ) : !step.auto && (
          <Button type="text" onClick={() => onAnswer("todo")} data-testid={`undo-${step.key}`}>Undo</Button>
        )}
      </Space>
    </li>
  );
}
