import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { KnIcon } from "@/components/icons/KnIcon";
import { MiniMarkdown, toBlocks } from "@/components/knowledge/MiniMarkdown";
import { PdfPageHighlight } from "@/components/knowledge/PdfPageHighlight";
import { findPassage, MarkedText } from "@/components/knowledge/passage";

/** pdf.js, as far as the component touches it — a canvas needs no real PDF. */
function fakePdf(pages = 3, fail = false) {
  const render = vi.fn(() => ({ promise: Promise.resolve() }));
  const getPage = vi.fn(() =>
    Promise.resolve({
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
      render,
    }),
  );
  const loader = () =>
    Promise.resolve({
      getDocument: () => ({
        promise: fail ? Promise.reject(new Error("bad pdf")) : Promise.resolve({ numPages: pages, getPage }),
      }),
    } as unknown as typeof import("pdfjs-dist"));
  return { loader, getPage, render };
}

describe("PdfPageHighlight", () => {
  it("draws the cited page and marks the passage's boxes on it", async () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({} as CanvasRenderingContext2D);
    const pdf = fakePdf();
    render(
      <PdfPageHighlight
        url="https://storage.example/a.pdf"
        page={2}
        boxes={[
          { page: 2, x: 0.1, y: 0.2, w: 0.5, h: 0.05 },
          { page: 3, x: 0.1, y: 0.2, w: 0.5, h: 0.05 },
        ]}
        loader={pdf.loader}
      />,
    );
    expect(await screen.findByTestId("citation-mark")).toHaveStyle({ left: "10%", top: "20%", width: "50%" });
    expect(screen.getAllByTestId("citation-mark")).toHaveLength(1);
    expect(screen.getByTestId("citation-pdf-page")).toHaveTextContent("Page 2 of 3");
    expect(pdf.getPage).toHaveBeenCalledWith(2);

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(screen.getByTestId("citation-pdf-page")).toHaveTextContent("Page 3 of 3"));
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Back to the cited page" }));
    await waitFor(() => expect(screen.getByTestId("citation-pdf-page")).toHaveTextContent("Page 2 of 3"));
    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    await waitFor(() => expect(screen.getByTestId("citation-pdf-page")).toHaveTextContent("Page 1 of 3"));
    getContext.mockRestore();
  });

  it("says so when the page cannot be drawn", async () => {
    render(<PdfPageHighlight url="x" page={1} boxes={[]} loader={fakePdf(1, true).loader} />);
    expect(await screen.findByText(/could not be drawn here/)).toBeInTheDocument();
  });
});

describe("MiniMarkdown", () => {
  it("renders the model's Markdown as elements, never as HTML", () => {
    const { container } = render(
      <MiniMarkdown
        text={"# Summary\nHotels **180 EUR** [1], _breakfast_ and `code`.\n\n- one [2]\n- two\n\n1. first\n2. second\n<img src=x onerror=alert(1)>"}
        cite={(n) => <sup data-testid="cite">{n}</sup>}
      />,
    );
    expect(screen.getByText("Summary")).toHaveClass("nx-md-h");
    expect(screen.getByText("180 EUR").tagName).toBe("STRONG");
    expect(screen.getByText("breakfast").tagName).toBe("EM");
    expect(screen.getByText("code").tagName).toBe("CODE");
    expect(screen.getAllByTestId("cite").map((n) => n.textContent)).toEqual(["1", "2"]);
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("leaves markers as text without a citation renderer", () => {
    render(<MiniMarkdown text="See [3]." />);
    expect(screen.getByText(/See/)).toHaveTextContent("See [3].");
    expect(toBlocks("")).toEqual([]);
  });
});

describe("passages in text", () => {
  it("finds a passage whitespace-insensitively and marks it", () => {
    const text = "# Title\n\nClaims must be\nfiled within 30 days.\n\nOther.";
    const found = findPassage(text, "Claims must be filed within 30 days.");
    expect(found && text.slice(...found)).toBe("Claims must be\nfiled within 30 days.");
    expect(findPassage(text, "Nothing like this here at all")).toBeNull();
    render(<pre>{MarkedText({ text, quote: "Claims must be filed within 30 days." })}</pre>);
    expect(screen.getByTestId("citation-text-mark")).toHaveTextContent("Claims must be filed within 30 days.");
  });

  it("falls back to the leading words when the passage was cut", () => {
    const text = "Alpha beta gamma delta epsilon zeta.";
    const found = findPassage(text, "Alpha beta gamma delta and then something else entirely");
    expect(found && text.slice(...found)).toBe("Alpha beta gamma delta");
    const { container } = render(<pre>{MarkedText({ text: "abc", quote: "zzz yyy xxx" })}</pre>);
    expect(container.textContent).toBe("abc");
  });
});

describe("KnIcon", () => {
  it("draws on the shell's grid", () => {
    const { container } = render(<KnIcon name="documents" className="x" />);
    expect(container.querySelector("svg")).toHaveClass("nx-icon", "x");
    render(<KnIcon name="spark" />);
  });
});
