import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { recordsApi, type RecordDetail } from "@/api/records";
import { useRecordPage, type RecordPage } from "@/components/records/useRecordPage";
import { renderWithProviders } from "@/test/render";

/**
 * Two fields changed on a record page before the first save returns.
 *
 * Each write must carry the moment the previous one came back: sending the
 * same stale `updated_at` twice made the server refuse the second as a lost
 * race — "somebody else changed this task" — when nobody had but the reader.
 */
afterEach(() => vi.restoreAllMocks());

function detail(updatedAt: string): RecordDetail {
  return { id: "t1", updated_at: updatedAt, fields: [] } as unknown as RecordDetail;
}

describe("useRecordPage writes", () => {
  it("go one after another, each with the version the last one returned", async () => {
    const sent: (string | null | undefined)[] = [];
    let version = 0;
    // The server's current row, which a refetch after each save reads back.
    vi.spyOn(recordsApi, "get").mockImplementation(() => Promise.resolve(detail(`v${version}`)));
    vi.spyOn(recordsApi, "update").mockImplementation(async (_type, _id, body) => {
      sent.push(body.expected_updated_at);
      await new Promise((resolve) => setTimeout(resolve, 20));
      version += 1;
      return detail(`v${version}`);
    });

    let page: RecordPage | undefined;
    function Probe() {
      page = useRecordPage("task", "t1", { listPath: "/tasks", noun: "task" });
      return null;
    }
    renderWithProviders(<Probe />);
    await waitFor(() => expect(page?.record?.updated_at).toBe("v0"));

    act(() => {
      page!.write({ status: "DONE" });
      page!.write({ priority: "HIGH" });
    });

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent).toEqual(["v0", "v1"]);
    await waitFor(() => expect(page?.record?.updated_at).toBe("v2"));
  });
});
