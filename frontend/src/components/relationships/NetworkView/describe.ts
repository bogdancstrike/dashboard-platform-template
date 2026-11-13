import { type RecordNetwork } from "@/api/relationships";

/** One sentence describing the whole picture, for a reader who cannot see it. */
export function describe(data: RecordNetwork): string {
  const biggest = data.communities[0];
  return [
    `${data.stats.nodes} records in ${data.stats.communities} communities,`,
    `joined by ${data.stats.edges} links, ${data.stats.bridges} of which cross between communities.`,
    biggest ? `The largest is ${biggest.label}, with ${biggest.size} records.` : "",
    `Modularity ${data.stats.modularity.toFixed(2)}.`,
  ]
    .filter(Boolean)
    .join(" ");
}
