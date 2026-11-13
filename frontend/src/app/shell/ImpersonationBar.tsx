import { Button } from "antd";

import { useImpersonation } from "@/auth/ImpersonationProvider";
import { NxIcon } from "@/components/NxIcon";

/** Says, on every page, whose account an administrator is acting as. */
export function ImpersonationBar() {
  const impersonation = useImpersonation();
  if (!impersonation.target) return null;
  return (
    <div className="nu-impersonation" role="status">
      <NxIcon name="switchUser" />
      <span>
        You are viewing the platform as <strong>{impersonation.target.full_name}</strong>.
        Everything you do is recorded under both names.
      </span>
      <Button onClick={impersonation.stop}>Return to your own account</Button>
    </div>
  );
}
