import { useQuery } from "@tanstack/react-query";

import { explorerApi } from "@/api/explorer";
import { recordsApi } from "@/api/records";
import { queryKeys } from "@/lib/queryKeys";

/** The fields the account panel reads of a sibling ticket. */
export const SIBLING_COLUMNS = ["reference", "subject", "status", "severity", "created_at"];

export interface SiblingTicket {
  id: string;
  reference?: string;
  subject?: string;
  status?: string;
  severity?: string;
  created_at?: string | null;
}

/** The account the ticket is filed against, and the newest few tickets it has raised. */
export function useTicketAccount(customerId: string) {
  const account = useQuery({
    queryKey: queryKeys.record("customer", customerId),
    queryFn: ({ signal }) => recordsApi.get("customer", customerId, signal),
    enabled: Boolean(customerId),
  });

  const siblings = useQuery({
    queryKey: queryKeys.recordAnalysis("customer-tickets", customerId),
    queryFn: ({ signal }) =>
      explorerApi.query(
        {
          resource_type: "ticket",
          filters: { customer_id: customerId },
          columns: SIBLING_COLUMNS,
          sort: "created_at",
          order: "desc",
          page_size: 6,
        },
        signal,
      ),
    enabled: Boolean(customerId),
  });

  return { account, siblings };
}
