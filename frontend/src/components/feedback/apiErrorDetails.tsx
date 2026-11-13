import type { ReactNode } from "react";
import { Space, Typography } from "antd";

import { ApiError } from "@/api/client";

const { Text } = Typography;

/**
 * The description under an alert about a failed request: the permissions the
 * refusal named, and the correlation id a support ticket needs.
 *
 * A function rather than a component so an alert about a non-API failure gets
 * no description at all (`undefined`), exactly as the hand-written copies did.
 * `FailureAlert` is the whole alert; this is for the views that keep their own
 * headline and buttons.
 */
export function apiErrorDetails(error: unknown, gap: 2 | 4 = 4): ReactNode {
  if (!(error instanceof ApiError)) return undefined;
  return (
    <Space direction="vertical" size={gap}>
      {error.missingPermissions.length > 0 && (
        <Text type="secondary">Missing: {error.missingPermissions.join(", ")}</Text>
      )}
      <Text code copyable={{ text: error.correlationId }}>
        {error.correlationId}
      </Text>
    </Space>
  );
}
