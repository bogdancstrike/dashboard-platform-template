import { useQuery } from "@tanstack/react-query";
import { List, Space, Typography } from "antd";
import { StarFilled } from "@ant-design/icons";
import { Link } from "react-router-dom";

import { favoritesApi } from "@/api/favorites";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { Loading, MoreLink, Nothing, ROWS, type ModuleBodyProps } from "./shared";

const { Text } = Typography;

/**
 * The places this reader keeps coming back to.
 *
 * Two views, and they are genuinely different things: bookmarks are a decision
 * somebody made and kept in an order they chose; recents are a by-product with
 * a visit count. A widget that mixed them would make the deliberate list
 * indistinguishable from the automatic one.
 */
export function FavoritesBody({ widget, fallback }: ModuleBodyProps) {
  const recents = widget.config.view === "recents";

  const bookmarks = useQuery({
    queryKey: queryKeys.favorites(),
    queryFn: ({ signal }) => favoritesApi.list(signal),
    enabled: !recents,
    staleTime: STALE.minute,
  });
  const visits = useQuery({
    queryKey: queryKeys.recents(),
    queryFn: ({ signal }) => favoritesApi.recents(signal),
    enabled: recents,
    staleTime: STALE.minute,
  });

  const active = recents ? visits : bookmarks;
  if (active.isLoading) return <Loading />;
  if (active.isError) return fallback(active.error, "favourites");

  // Narrowed to one row shape before rendering. A union of the two would
  // render *neither* faithfully: a bookmark has an arrangement and a recent
  // has a visit count, and the whole reason the two lists are separate is that
  // those are different facts.
  const rows = recents
    ? (visits.data?.items ?? []).slice(0, ROWS).map((item) => ({
        key: item.id,
        url: item.url,
        label: item.label,
        note: item.visit_count > 1 ? `${item.visit_count} visits` : item.resource_type,
      }))
    : (bookmarks.data?.items ?? []).slice(0, ROWS).map((item) => ({
        key: item.id,
        url: item.url,
        label: item.label,
        note: item.resource_type,
      }));

  if (rows.length === 0) {
    return (
      <Nothing
        what={recents ? "Nowhere visited yet" : "Nothing starred yet — the star is on every record"}
      />
    );
  }

  return (
    <>
      <List
        size="small"
        dataSource={rows}
        renderItem={(item) => (
          <List.Item>
            <Link to={item.url} className="nu-widget-row">
              <Space size={6}>
                {!recents && <StarFilled className="nu-widget-star" aria-hidden />}
                <Text ellipsis>{item.label}</Text>
              </Space>
              <Text type="secondary" className="nu-widget-dim">
                {item.note}
              </Text>
            </Link>
          </List.Item>
        )}
      />
      <MoreLink to="/favorites">{recents ? "All recents" : "All favourites"}</MoreLink>
    </>
  );
}
