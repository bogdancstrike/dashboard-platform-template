/** The fields the ledger asks for, and the row they come back as. */

export const COLUMNS = [
  "reference", "status", "payment_status", "fulfilment_status", "channel",
  "total", "currency", "item_count", "placed_at",
];

export interface OrderRow {
  id: string;
  reference?: string;
  status?: string;
  payment_status?: string;
  fulfilment_status?: string;
  channel?: string;
  total?: number;
  currency?: string;
  item_count?: number;
  placed_at?: string | null;
}

