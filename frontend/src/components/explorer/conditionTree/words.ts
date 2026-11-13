/**
 * The words an operator is read as in the builder.
 *
 * Words rather than symbols, because the builder is read as a sentence —
 * "Status is Offline", "Battery less than 20" — and datetime orderings read
 * as before / after.
 */
export function operatorWords(operator: string, kind?: string): string {
  const dated = kind === "datetime";
  switch (operator) {
    case "equal":
    case "select_equals":
      return "is";
    case "not_equal":
    case "select_not_equals":
      return "is not";
    case "like":
      return "contains";
    case "not_like":
      return "does not contain";
    case "starts_with":
      return "starts with";
    case "ends_with":
      return "ends with";
    case "less":
      return dated ? "before" : "less than";
    case "less_or_equal":
      return dated ? "on or before" : "at most";
    case "greater":
      return dated ? "after" : "more than";
    case "greater_or_equal":
      return dated ? "on or after" : "at least";
    case "between":
      return "between";
    case "select_any_in":
      return "is any of";
    case "select_not_any_in":
      return "is none of";
    case "is_empty":
    case "is_null":
      return "is empty";
    case "is_not_empty":
    case "is_not_null":
      return "is not empty";
    default:
      return operator.replaceAll("_", " ");
  }
}
