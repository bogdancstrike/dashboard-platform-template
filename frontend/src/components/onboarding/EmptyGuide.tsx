/**
 * The guide an empty page shows (§38): what the page is for, the first thing to
 * do, and — for an administrator — a tagged sample dataset to explore with,
 * removable from Getting started.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button } from "antd";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { onboardingApi } from "@/api/onboarding";
import { useAuth } from "@/auth/AuthProvider";
import "@/styles/onboarding.css";

/** Per area: what the page is for, and where its first record is made. */
export const GUIDES: Record<string, { purpose: string; first: string; to?: string; sample?: string }> = {
  task: { purpose: "Tasks are the work: who does what, by when, and how far along it is.", first: "Create the first task with New task, or start from a template.", sample: "tasks" },
  project: { purpose: "Projects group work for a customer or a goal, with a budget, a phase and a health.", first: "Create a project, then raise its tasks.", sample: "projects" },
  customer: { purpose: "Customers are the accounts you serve — their orders, tickets and health in one place.", first: "Add a customer, or import a spreadsheet of them.", to: "/import", sample: "customers" },
  ticket: { purpose: "Tickets are requests and problems, triaged by priority with an SLA clock.", first: "Log a ticket, or publish an intake form that creates them.", sample: "tickets" },
  order: { purpose: "Orders are what customers bought, with payment and fulfilment status.", first: "Record an order against a customer.", sample: "orders" },
  device: { purpose: "Devices are the fleet: status, battery, signal and errors at a glance.", first: "Register a device.", sample: "devices" },
  workflow: { purpose: "Workflows act on records for you — notify, assign, raise a task, call a webhook.", first: "Draw one on the canvas, or write one step by step.", to: "/workflows" },
};

export function EmptyGuide({ area }: { area: string }) {
  const guide = GUIDES[area];
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const load = useMutation({
    mutationFn: () => onboardingApi.load(guide!.sample!),
    onSuccess: (answer) => {
      message.success(`Loaded ${answer.created} sample records — remove them any time from Getting started.`);
      void queryClient.invalidateQueries();
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : "Sample data could not be loaded."),
  });
  if (!guide) return null;
  return (
    <div className="nx-ob-guide" data-testid={`empty-guide-${area}`}>
      <p className="nx-ob-guide-purpose">{guide.purpose}</p>
      <p className="nx-ob-guide-first">{guide.first}</p>
      <div className="nx-ob-guide-actions">
        {guide.to && <Link to={guide.to}><Button size="small">Go there</Button></Link>}
        {guide.sample && can("admin.access") && (
          <Button size="small" type="dashed" loading={load.isPending} onClick={() => load.mutate()} data-testid="load-sample">
            Load sample data
          </Button>
        )}
        <Link to="/onboarding" className="nx-ob-guide-link">Getting started</Link>
      </div>
    </div>
  );
}
