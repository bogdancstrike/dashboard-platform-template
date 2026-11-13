import type { Group } from "@/api/groups";

/** How many grants a row names before it starts counting them. */
const NAMED_GRANTS = 3;

/**
 * What a group's grants come to, in words.
 *
 * Exported and asserted directly because "3 permissions" is the version that
 * tells nobody anything: the question this column answers is *whether being in
 * this group lets somebody export the customer list*, and only the names
 * answer it. The count is the overflow, not the headline.
 */
export function grantSummary(permissions: string[]): string {
  if (permissions.length === 0) return "Adds nothing";
  const named = permissions.slice(0, NAMED_GRANTS).join(", ");
  const rest = permissions.length - NAMED_GRANTS;
  return rest > 0 ? `${named} +${rest} more` : named;
}

/**
 * What removing a group will cost, said before it happens.
 *
 * The whole hazard of this screen is quietly reducing somebody's access, so
 * the confirmation names both halves — and says plainly when there is nothing
 * to lose, rather than leaving a blank where the warning would be.
 */
export function removalCost(group: Group): string {
  const people =
    group.member_count === 0
      ? "Nobody is in it"
      : `${group.member_count} ${group.member_count === 1 ? "person is" : "people are"} in it`;
  if (group.permissions.length === 0) {
    return `${people}, and it grants nothing — no access changes.`;
  }
  return `${people}, and they lose ${group.permissions.join(", ")}.`;
}
