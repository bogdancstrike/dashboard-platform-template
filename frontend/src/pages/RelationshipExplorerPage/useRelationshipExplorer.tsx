import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClearOutlined, DeploymentUnitOutlined, FileSearchOutlined } from "@ant-design/icons";
import { usePageCommands } from "@/commands/CommandContext";
import { relationshipsApi, type RelatedNode } from "@/api/relationships";
import { queryKeys } from "@/lib/queryKeys";
import { parseTrail } from "./trail";

/**
 * The explorer's walk: the record in the address and the trail that led to it, its neighbours, and stepping forward and back.
 */
export function useRelationshipExplorer() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [view, setView] = useState<"list" | "graph">("list");

  const resource = params.get("resource") ?? "";
  const id = params.get("id") ?? "";
  const trail = useMemo(() => parseTrail(params.get("trail")), [params]);

  const graph = useQuery({
    queryKey: queryKeys.relationships(resource, id),
    queryFn: ({ signal }) => relationshipsApi.of(resource, id, signal),
    enabled: Boolean(resource && id),
  });

  /**
   * What this page can do, for the palette (§31).
   *
   * Two readings of one answer and a way back out of a trail twelve records
   * deep — which is exactly the point at which somebody stops wanting to find
   * the small control that does it.
   */
  usePageCommands("relationships", [
    {
      id: "relationships.view",
      label: view === "graph" ? "Read the connections as a list" : "Draw the connections",
      icon: <DeploymentUnitOutlined />,
      keywords: "graph list picture force directed nodes",
      run: () => setView(view === "graph" ? "list" : "graph"),
    },
    ...(resource && id
      ? [
          {
            id: "relationships.record",
            label: "Open this record",
            icon: <FileSearchOutlined />,
            keywords: "explore detail row open",
            run: () => navigate(`/explore?resource=${resource}&f.id=${id}`),
          },
        ]
      : []),
    ...(trail.length > 0
      ? [
          {
            id: "relationships.restart",
            label: `Start again (${trail.length} followed)`,
            icon: <ClearOutlined />,
            keywords: "reset trail back clear breadcrumb",
            run: () => setParams({}, { replace: true }),
          },
        ]
      : []),
  ]);

  /** Follow a connection, remembering where it was followed from. */
  const open = (node: RelatedNode, entity: string) => {
    const root = graph.data?.root;
    const next = root
      ? [...trail, { resource: root.resource_type, id: root.id, label: root.label }]
      : trail;
    setParams({ resource: entity, id: node.id, trail: JSON.stringify(next.slice(-12)) });
  };

  /** Jump back to any earlier step, discarding everything after it. */
  const goBack = (index: number) => {
    const step = trail[index];
    if (!step) return;
    setParams({
      resource: step.resource,
      id: step.id,
      trail: JSON.stringify(trail.slice(0, index)),
    });
  };

  return { params, setParams, navigate, view, setView, resource, id, trail, graph, open, goBack };
}

export type RelationshipExplorerModel = ReturnType<typeof useRelationshipExplorer>;
