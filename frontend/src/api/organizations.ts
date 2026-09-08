import { api } from "./client";

/**
 * Organizations, departments and teams (§42).
 *
 * Two things to keep in mind reading these types.
 *
 * **`people` is counted; `employee_count` is claimed.** The first is how many
 * accounts the platform holds for this tenant, computed from where people
 * actually sit. The second is what the organisation record says about itself —
 * a tenant of 4,000 staff with 30 user accounts is entirely normal, and
 * conflating the two would make one of them a lie. `departments.headcount`
 * exists in the database and is deliberately *not* in these types: it was
 * drawn at random before the users existed and said 116 for a department with
 * nobody in it.
 *
 * **A department's `people` is its own; `people_in_subtree` is the rollup.**
 * Two numbers because adding children into their parent makes the figures on a
 * tree sum to more than the organisation employs.
 *
 * The whole structure arrives nested from one call, so the page never has to
 * assemble a hierarchy the server already knows — or draw a level before its
 * parent.
 *
 * See `services/organizations.py`.
 */

export type OrgTier = "TRIAL" | "STARTER" | "STANDARD" | "ENTERPRISE";
export type OrgStatus = "ACTIVE" | "SUSPENDED" | "ARCHIVED";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  legal_name: string | null;
  industry: string | null;
  tier: OrgTier;
  status: OrgStatus;
  logo_url: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  address_line: string | null;
  city: string | null;
  country: string | null;
  /** What the record claims about the company. */
  employee_count: number;
  /**
   * Absent unless the reader holds `orgs.manage`. Withheld rather than zeroed,
   * so the page can tell "not shown to you" from "nothing" — reading where
   * people sit is directory information, what a tenant turns over is not.
   */
  annual_revenue?: number;
  /** How many accounts the platform holds. Counted, not claimed. */
  people: number;
  department_count: number;
  team_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface OrgPerson {
  id: string;
  full_name: string;
  initials: string;
  avatar_url: string | null;
  job_title: string | null;
}

export interface OrgTeam {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  lead: OrgPerson | null;
}

export interface DepartmentNode {
  id: string;
  name: string;
  code: string;
  description: string | null;
  cost_center: string | null;
  parent_id: string | null;
  manager: OrgPerson | null;
  depth: number;
  /** Its own people. */
  people: number;
  /** Its people plus everybody below it. */
  people_in_subtree: number;
  teams: OrgTeam[];
  children: DepartmentNode[];
}

export interface OrgTree {
  organization: Organization;
  departments: DepartmentNode[];
  /** Teams in the organisation that sit in no department — named, not hidden. */
  unplaced_teams: OrgTeam[];
  depth: number;
  max_depth: number;
  can_manage: boolean;
  /** The number that explains a tree summing to less than the tenant's total. */
  unassigned_people: number;
}

export interface OrgsPage {
  items: Organization[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  facets: Record<string, Array<{ value: string; count: number }>>;
  columns: string[];
  can_manage: boolean;
}

export interface OrgCatalogue {
  fields: Array<{ name: string; label: string; kind: string }>;
  default_columns: string[];
  tiers: OrgTier[];
  statuses: OrgStatus[];
  regions: Array<{
    id: string;
    name: string;
    code: string;
    timezone: string;
    currency: string;
  }>;
  max_depth: number;
  total: number;
  can_manage: boolean;
  /** So the page opens on the tenant the reader belongs to. */
  own_organization_id: string | null;
  industries: string[];
}

export interface OrgQuery {
  [key: string]: unknown;
  q?: string;
  tier?: string;
  status?: string;
  country?: string;
  page?: number;
  page_size?: number;
}

export const organizationsApi = {
  catalogue: (signal?: AbortSignal) =>
    api.get<OrgCatalogue>("/admin/organizations/catalogue", { signal }),
  list: (params: OrgQuery = {}, signal?: AbortSignal) =>
    api.get<OrgsPage>("/admin/organizations", { params, signal }),
  /** The whole structure, nested, in one read. */
  tree: (id: string, signal?: AbortSignal) =>
    api.get<OrgTree>(`/admin/organizations/${id}`, { signal }),
  update: (
    id: string,
    body: Partial<{
      name: string;
      tier: OrgTier;
      status: OrgStatus;
      legal_name: string;
      industry: string;
      website: string;
      email: string;
      phone: string;
      address_line: string;
      city: string;
      country: string;
      employee_count: number;
    }>,
  ) => api.put<Organization>(`/admin/organizations/${id}`, body),
  addDepartment: (
    organizationId: string,
    body: { name: string; code: string; parent_id?: string | null; description?: string },
  ) =>
    api.post<{ id: string; name: string; code: string; parent_id: string | null; people: number }>(
      `/admin/organizations/${organizationId}/departments`,
      body,
    ),
  /**
   * Rename or re-parent. A move that would make a department its own ancestor
   * is refused with the path named — the tree would otherwise be infinite.
   */
  editDepartment: (
    id: string,
    body: Partial<{
      name: string;
      code: string;
      description: string;
      cost_center: string;
      parent_id: string | null;
    }>,
  ) => api.put<{ id: string; name: string; code: string; parent_id: string | null }>(
    `/admin/departments/${id}`,
    body,
  ),
  /** Refused while people, teams or sub-departments are still inside. */
  removeDepartment: (id: string) =>
    api.delete<{ deleted: boolean; name: string }>(`/admin/departments/${id}`),
};
