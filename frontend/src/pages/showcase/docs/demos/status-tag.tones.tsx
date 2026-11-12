import { StatusTag, type StatusTone } from "@/components/StatusTag";

const TONES: { tone: StatusTone; say: string }[] = [
  { tone: "ok", say: "Healthy" },
  { tone: "warn", say: "Needs a look" },
  { tone: "bad", say: "Broken" },
  { tone: "acc", say: "In motion" },
  { tone: "neutral", say: "Nothing to say" },
];

export default function StatusTagTones() {
  return (
    <div className="nx-doc-row">
      {TONES.map(({ tone, say }) => (
        <StatusTag key={tone} status={tone.toUpperCase()} tone={tone} label={`${say} · ${tone}`} />
      ))}
    </div>
  );
}
