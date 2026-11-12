import { useState } from "react";

import { PeoplePicker } from "@/components/PeoplePicker";

export default function PeoplePickerBasic() {
  const [people, setPeople] = useState<string[]>([]);
  return (
    <div style={{ maxWidth: 360 }}>
      <PeoplePicker value={people} onChange={setPeople} />
    </div>
  );
}
