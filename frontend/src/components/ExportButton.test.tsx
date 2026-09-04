import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { ApiError, download, filenameFrom } from "@/api/client";
import { ExportButton } from "@/components/ExportButton";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

describe("filenameFrom", () => {
  it("reads the name the server chose", () => {
    // The server knows the format and the moment; a client that names the file
    // itself will eventually disagree with what is inside it.
    expect(filenameFrom('attachment; filename="audit-log-2026-09-03-1200.csv"')).toBe(
      "audit-log-2026-09-03-1200.csv",
    );
    expect(filenameFrom("attachment; filename=tasks.json")).toBe("tasks.json");
    expect(filenameFrom(null)).toBeUndefined();
    expect(filenameFrom("attachment")).toBeUndefined();
  });
});

describe("download", () => {
  it("saves the file under the name the response carried", async () => {
    // The click is what actually saves the file, so it is what the test
    // observes; jsdom would otherwise try to navigate to the blob URL.
    const clicks: { href: string; name: string }[] = [];
    const spy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push({ href: this.href, name: this.download });
      });

    try {
      await download("/admin/audit/export", { params: { format: "csv" } });
    } finally {
      spy.mockRestore();
    }

    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.name).toBe("audit-log-2026-09-03-1200.csv");
    expect(clicks[0]!.href).toMatch(/^blob:/);
  });

  it("raises the ordinary ApiError rather than saving the error body", async () => {
    // Otherwise a refused export lands in the downloads folder as a file
    // containing the word "forbidden", which nobody opens and everybody
    // reports as "the export is broken".
    server.use(
      http.get("/platform/admin/audit/export", () =>
        HttpResponse.json(
          {
            error: "forbidden",
            message: "You do not have permission to perform this action.",
            details: { missing: ["records.export"] },
          },
          { status: 403, headers: { "X-Correlation-ID": "c0ffee" } },
        ),
      ),
    );

    await expect(download("/admin/audit/export")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("the export control", () => {
  it("offers the three formats and reports which one started", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<ExportButton onExport={onExport} />);

    await user.click(screen.getByRole("button", { name: /Export/ }));
    expect(await screen.findByText("CSV — for a spreadsheet")).toBeInTheDocument();
    expect(screen.getByText("Excel workbook")).toBeInTheDocument();
    expect(screen.getByText("JSON — for another system")).toBeInTheDocument();

    await user.click(screen.getByText("Excel workbook"));

    await waitFor(() => expect(onExport).toHaveBeenCalledWith("xlsx"));
    expect(await screen.findByText("Your XLSX download has started.")).toBeInTheDocument();
  });

  it("says which permission was missing when the export is refused", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn().mockRejectedValue(
      new ApiError(
        403,
        {
          error: "forbidden",
          message: "refused",
          details: { missing: ["records.export"], missing_labels: ["Export records"] },
        },
        "c0ffee",
      ),
    );
    renderWithProviders(<ExportButton onExport={onExport} />);

    await user.click(screen.getByRole("button", { name: /Export/ }));
    await user.click(await screen.findByText("CSV — for a spreadsheet"));

    // A download has no visible result inside the app, so a refusal that says
    // nothing is indistinguishable from one that is merely slow.
    expect(
      await screen.findByText(/You do not have permission to export/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Export records/)).toBeInTheDocument();
  });
});
