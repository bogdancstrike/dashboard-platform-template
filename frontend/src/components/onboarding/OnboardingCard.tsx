/**
 * Getting started, on Home (§38): progress through this person's checklist and
 * the next few steps, dismissible. Gone once dismissed or finished; the full
 * list stays at /onboarding.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Progress } from "antd";
import { Link } from "react-router-dom";

import { onboardingApi, type Checklist } from "@/api/onboarding";
import { NxIcon } from "@/components/NxIcon";
import "@/styles/onboarding.css";

export function OnboardingCard() {
  const queryClient = useQueryClient();
  const checklist = useQuery({ queryKey: ["onboarding"], queryFn: ({ signal }) => onboardingApi.checklist(signal) });
  const dismiss = useMutation({
    mutationFn: () => onboardingApi.dismiss(true),
    onSuccess: (next) => queryClient.setQueryData<Checklist>(["onboarding"], next),
  });
  const data = checklist.data;
  if (!data || data.dismissed || data.progress.percent >= 100) return null;
  const next = data.steps.filter((step) => step.state === "todo").slice(0, 3);

  return (
    <Card
      size="small"
      className="nx-ob-card"
      data-testid="onboarding-card"
      title={<span className="nx-ob-card-title"><NxIcon name="check" size={16} /> Getting started</span>}
      extra={
        <Button type="text" onClick={() => dismiss.mutate()} loading={dismiss.isPending} data-testid="dismiss-onboarding">
          Dismiss
        </Button>
      }
    >
      <div className="nx-ob-card-body">
        <div className="nx-ob-card-progress">
          <Progress type="circle" size={64} percent={data.progress.percent} strokeColor="var(--nu-accent)"
            aria-label={`${data.progress.done} of ${data.progress.total} done`} />
          <span>{data.progress.done} of {data.progress.total} done</span>
        </div>
        <ul className="nx-ob-card-steps">
          {next.map((step) => (
            <li key={step.key}>
              <Link to={step.to} data-testid={`card-step-${step.key}`}>
                <strong>{step.title}</strong>
                <span>{step.description}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link to="/onboarding" className="nx-ob-card-all" data-testid="onboarding-all">See every step</Link>
      </div>
    </Card>
  );
}
