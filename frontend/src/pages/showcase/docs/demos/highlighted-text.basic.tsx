import { HighlightedText } from "@/components/HighlightedText";

export default function HighlightedTextBasic() {
  return (
    <div className="nx-doc-col">
      <HighlightedText text="Printer on fire in the north wing" term="fire" />
      <HighlightedText text="Printer on fire in the north wing" term="" />
      <HighlightedText text="No match for this one" term="zebra" />
    </div>
  );
}
