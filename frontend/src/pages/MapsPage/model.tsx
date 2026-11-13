/** The maps page's vocabulary and helpers. */

/** What a dataset's records are called in the country question. */
export const DRILL_NOUN: Record<string, string> = {
  customer: "customers",
  order: "customers",
  device: "devices",
  project: "projects",
  ticket: "tickets",
  task: "tasks",
};

/**
 * Where clicking a place leads, per dataset.
 *
 * Read off what each list can actually be filtered by, which is not the same
 * question as what the map can draw: a device is placed by `location`, a
 * customer by `country` and `city`, and an order by neither — it borrowed its
 * customer's. Rather than invent a filter the API would reject, a dataset
 * placed through its customer drills into the customers.
 */
export const DRILL: Record<
  string,
  { path: string; country?: string; city: string; via?: boolean }
> = {
  customer: { path: "/customers", country: "country", city: "city" },
  device: { path: "/devices", city: "location" },
  order: { path: "/customers", country: "country", city: "city", via: true },
  ticket: { path: "/customers", country: "country", city: "city", via: true },
  project: { path: "/customers", country: "country", city: "city", via: true },
};
