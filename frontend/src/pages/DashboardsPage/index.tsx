/**
 * `/dashboards` — the reader's own dashboards, and the ones shared with them
 * (§45, §67).
 *
 * `/dashboard` is *the* dashboard: one fixed layout the platform designed,
 * answering the questions a template should demonstrate. This is the other
 * thing entirely — a layout somebody composed for the job they actually do,
 * saved, shared, and openable as their home page.
 *
 * Three decisions worth stating.
 *
 * **A widget names a question; it does not copy one.** The layout is stored
 * here and every number comes from the endpoint that already owns it — see
 * `components/dashboards/WidgetBody.tsx`. Nothing about a dashboard aggregates
 * anything, which is why a dashboard and the page it was built from cannot
 * disagree.
 *
 * **The landing state is a gallery, not a picker.** What a reader is choosing
 * between is not a *name* — it is a layout — so each card says what its
 * dashboard holds. A select in a header made every dashboard look identical
 * and gave the choice one line of the page.
 *
 * **Creating one is a wizard; editing one is a drawer.** The distinction is
 * not decoration: a wizard makes a decision that has parts — what to call it,
 * what it will hold, who sees it — and a drawer edits an object that already
 * exists. A single form asking all three at once gets a worse answer to each.
 *
 * **Editing is a mode, not a separate page.** A builder on its own screen is a
 * builder whose result you cannot see; the reading view *is* the editing view,
 * with the controls turned on. So "add a widget" lands on the grid it will
 * live on, and a resize is judged against the widgets beside it.
 *
 * **One drag saves the whole layout.** Moving a widget reflows the ones around
 * it, and one request per card lets a reader reload mid-flight and find a
 * layout that never existed (§73).
 */

import { Alert, Skeleton } from "antd";

import { ApiError } from "@/api/client";
import { PageHeader } from "@/components/PageHeader";
import { CreateDashboardWizard } from "@/components/dashboards/CreateDashboardWizard";
import { WidgetModal } from "@/components/dashboards/WidgetModal";
import { ShareDrawer } from "@/components/dashboards/ShareDrawer";
import { apiErrorDetails } from "@/components/feedback/apiErrorDetails";

import { SettingsDrawer } from "./parts/SettingsDrawer";
import { DashboardsBody } from "./parts/DashboardsBody";
import { DashboardsHeader } from "./parts/DashboardsHeader";
import { useDashboardsPage } from "./useDashboardsPage";

export default function DashboardsPage() {
  const page = useDashboardsPage();
  const {
    message,
    modal,
    navigate,
    pushes,
    place,
    chosenKind,
    setWidgetForm,
    settingsOpen,
    setSettingsOpen,
    shareOpen,
    setShareOpen,
    wizardOpen,
    setWizardOpen,
    listing,
    resources,
    settled,
    saveBoard,
    removeBoard,
    saveWidget,
    board,
    widgetForm,
    period,
    unavailable,
  } = page;
  if (listing.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (listing.isError) {
    const error = listing.error;
    const api = error instanceof ApiError ? error : null;
    return (
      <>
        <PageHeader title="My dashboards" />
        <Alert
          type={api?.isForbidden ? "warning" : "error"}
          showIcon
          message={api?.message ?? "Your dashboards could not be loaded"}
          description={apiErrorDetails(api)}
        />
      </>
    );
  }

  return (
    <>
      <DashboardsHeader page={page} />

      <DashboardsBody page={page} />

      <CreateDashboardWizard
        open={wizardOpen}
        canShare={listing.data?.can_share ?? false}
        unavailable={unavailable}
        onClose={() => setWizardOpen(false)}
        onCreated={(saved) => {
          setWizardOpen(false);
          settled(saved);
          place({ dashboard: saved.id, edit: "1", widget: null, wkind: null });
          message.success(`${saved.name} created`);
        }}
      />

      <WidgetModal
        chosenKind={chosenKind}
        onChooseKind={(kind) => {
          pushes.current += 1;
          place({ wkind: kind });
        }}
        onBackToKinds={() => {
          if (pushes.current > 1) {
            pushes.current -= 1;
            navigate(-1);
          } else place({ wkind: null }, true);
        }}
        open={widgetForm !== null}
        widget={widgetForm === "new" ? null : widgetForm}
        datasets={listing.data?.datasets ?? []}
        kinds={listing.data?.widget_kinds ?? []}
        saving={saveWidget.isPending}
        period={period}
        resources={resources.data?.items ?? []}
        onClose={() => setWidgetForm(null)}
        onSave={(input) =>
          saveWidget.mutate({
            id: widgetForm === "new" || widgetForm === null ? null : widgetForm.id,
            input,
          })
        }
      />

      <ShareDrawer
        open={shareOpen}
        dashboard={board}
        saving={saveBoard.isPending}
        canShare={listing.data?.can_share ?? false}
        onClose={() => setShareOpen(false)}
        onSave={(input) => {
          saveBoard.mutate(input);
          setShareOpen(false);
        }}
      />

      <SettingsDrawer
        open={settingsOpen}
        dashboard={board}
        saving={saveBoard.isPending}
        canShare={listing.data?.can_share ?? false}
        onClose={() => setSettingsOpen(false)}
        onSave={(input) => saveBoard.mutate(input)}
        onDelete={() =>
          modal.confirm({
            title: `Delete ${board?.name}?`,
            content: "The layout goes. Nothing it pointed at is affected.",
            okText: "Delete",
            okButtonProps: { danger: true },
            onOk: async () => {
              await removeBoard.mutateAsync();
            },
          })
        }
      />
    </>
  );
}
