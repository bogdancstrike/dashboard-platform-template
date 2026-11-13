/** The fields the account grid asks for, and the row they come back as. */

export const COLUMNS = [
  "code", "name", "email", "status", "segment", "industry", "lifecycle_stage",
  "country", "city", "lifetime_value", "satisfaction", "last_contact_at",
  // Customer health (§12), carried on every row.
  "health_score", "health_band",
];

export interface CustomerRow {
  id: string;
  code?: string;
  name?: string;
  email?: string;
  status?: string;
  segment?: string;
  industry?: string;
  lifecycle_stage?: string;
  country?: string;
  city?: string;
  lifetime_value?: number;
  satisfaction?: number;
  last_contact_at?: string | null;
}
