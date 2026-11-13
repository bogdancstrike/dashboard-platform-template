/**
 * `/admin/api` — the machines that call this platform (§25).
 *
 * Five decisions worth stating.
 *
 * **The secret is shown once, and the page is built around that being true.**
 * It arrives on exactly one response, so it is put somewhere it cannot be
 * dismissed by accident: a modal that says plainly this is the only time, with
 * a copy button, and a confirmation before it closes. Not a toast — a toast
 * that scrolls away takes the key with it, and the only recovery is minting
 * another and redeploying whatever holds the old one.
 *
 * **Only the scopes this caller may grant are offered.** The server sends its
 * own list; a form offering the whole catalogue and refusing half of it on save
 * would be a form that produces an error on purpose. What is withheld is
 * *counted* rather than hidden silently, so somebody who cannot find a
 * permission knows why.
 *
 * **Rotation is presented as what it is: two live keys and a deadline.** The
 * old key's expiry is on the screen next to the new one, because the whole
 * point of the grace period is that somebody has to redeploy before it passes.
 *
 * **A revoked key stays on the list.** Greyed, dated, and named — the question
 * after a leak is always when and by whom, and a row that vanished answers
 * neither (§34).
 *
 * **The lifetime counter and the recent window are labelled apart.** Three
 * point seven million requests beside twelve logged rows is two different
 * questions, and putting them together unlabelled would read as one answer
 * that happens to be wrong (§71).
 */

import { Alert, Button, Skeleton, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import type { ApiClientRow } from "@/api/apiClients";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { ListBar, ListPanel } from "@/components/listing/ListBar";
import { ResponsiveTable } from "@/components/listing/ResponsiveTable";
import { apiMessage } from "@/lib/errors";

import { ClientDrawer } from "./ClientDrawer";
import { NewClientModal } from "./NewClientModal";
import { SecretModal } from "./SecretModal";
import { clientCard, clientColumns } from "./clientColumns";
import { useApiClientsPage } from "./useApiClientsPage";

export { credentialStory, stateTone } from "./credentialCopy";

export default function ApiClientsPage() {
  const page = useApiClientsPage();
  const { search, overlay, catalogue, listing } = page;

  if (catalogue.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (catalogue.isError) {
    return (
      <>
        <PageHeader title="API clients" />
        <Alert type="error" showIcon message={apiMessage(catalogue.error, "The API clients could not be read.")} />
      </>
    );
  }

  const { scopes, withheld_scopes: withheld, rotation_grace_days: grace } = catalogue.data!;

  return (
    <div className="nu-fill nx-ad nx-ad--api">
      <PageHeader
        title={<>API <em>clients</em></>}
        subtitle="Machines that call this platform, the keys they call with, and what those keys may do."
        tag={<Tag>{catalogue.data!.total} clients</Tag>}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => page.setCreating(true)} data-testid="new-client">
            Register a client
          </Button>
        }
      />

      <ListBar
        search={{
          placeholder: "Search clients by name or client id",
          "aria-label": "Search clients",
          value: search.box,
          onChange: (event) => search.setBox(event.target.value),
        }}
      />

      <ListPanel>
        <ResponsiveTable<ApiClientRow>
          card={clientCard}
          size="small"
          rowKey="id"
          data-testid="clients-table"
          columns={clientColumns}
          dataSource={listing.data?.items ?? []}
          loading={listing.isLoading}
          onRow={(row) => ({ onClick: () => overlay.open(row.id), style: { cursor: "pointer" } })}
          locale={{
            emptyText: <EmptyState compact title={search.term ? "No client matches that." : "No API clients yet."} />,
          }}
          pagination={false}
        />
      </ListPanel>

      <ClientDrawer page={page} grace={grace} />

      <NewClientModal
        open={page.creating}
        scopes={scopes}
        withheld={withheld}
        onClose={() => page.setCreating(false)}
        onCreated={async (made) => {
          // Straight into the modal, before anything else can take the focus.
          page.setMinted({ ...made, about: made.name });
          // And open the client *before* awaiting the refetch. After the await
          // the navigation was being lost, so the page stayed on the list —
          // which meant somebody who had just minted a key landed nowhere useful.
          overlay.open(made.id);
          await page.refresh();
        }}
        onError={page.failed}
      />

      <SecretModal minted={page.minted} onClose={() => page.setMinted(null)} grace={grace} />
    </div>
  );
}
