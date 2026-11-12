import type { Tag } from "@/api/tags";
import { TagChip } from "@/components/records/TagPicker";
import { SEMANTIC } from "@/theme/tokens";

const TAGS: Tag[] = [
  { id: "1", name: "urgent", slug: "urgent", category: "PRIORITY", color: SEMANTIC.danger, description: "Needs attention today", usage_count: 12, is_system: true },
  { id: "2", name: "documentation", slug: "documentation", category: "ENGINEERING", color: SEMANTIC.info, description: "", usage_count: 8, is_system: false },
  { id: "3", name: "emea", slug: "emea", category: "REGION", color: SEMANTIC.warning, description: "", usage_count: 30, is_system: false },
];

export default function TagChipBasic() {
  return (
    <div className="nx-doc-row">
      {TAGS.map((tag) => (
        <TagChip key={tag.id} tag={tag} listPath="/tasks" />
      ))}
    </div>
  );
}
