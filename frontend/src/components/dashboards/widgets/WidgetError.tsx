import { Alert, Typography } from "antd";

import { ApiError } from "@/api/client";

const { Text } = Typography;

/**
 * Why this one card is empty, in place.
 *
 * Named per widget rather than once per page: a dashboard has a dozen panels,
 * and "something went wrong" at the top does not say which of them is the one
 * showing a stale number.
 */
export function WidgetError({ error, entity }: { error: Error; entity: string }) {
  const api = error instanceof ApiError ? error : null;
  return (
    <Alert
      type={api?.isForbidden ? "warning" : "error"}
      showIcon
      message={
        api?.isForbidden
          ? `Your role does not include ${entity || "this data"}`
          : (api?.message ?? "This widget could not be loaded")
      }
      description={
        api ? (
          <Text code copyable={{ text: api.correlationId }} style={{ fontSize: 11 }}>
            {api.correlationId}
          </Text>
        ) : undefined
      }
    />
  );
}
