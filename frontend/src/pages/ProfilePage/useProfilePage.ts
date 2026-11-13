import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { activityApi } from "@/api/activity";
import { profileApi } from "@/api/profile";
import { useAuth } from "@/auth/AuthProvider";
import { usePageCommands } from "@/commands/CommandContext";
import { queryKeys } from "@/lib/queryKeys";

import { tabFrom } from "./profilePanels";

/** Whose profile, the tab and edit drawer in the address, the profile, and their activity trail. */
export function useProfilePage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // The edit drawer lives in the address (`?edit=1`), pushed, so back closes
  // it and a link can open it; × steps back when it was opened from here.
  const location = useLocation();
  const editing = params.get("edit") === "1";
  const setEditing = (open: boolean) => {
    if (open) {
      const next = new URLSearchParams(params);
      next.set("edit", "1");
      setParams(next, { state: { overlay: true } });
    } else if ((location.state as { overlay?: boolean } | null)?.overlay) {
      navigate(-1);
    } else {
      const next = new URLSearchParams(params);
      next.delete("edit");
      setParams(next, { replace: true });
    }
  };
  const auth = useAuth();
  const tab = tabFrom(params.get("tab"));

  const query = useQuery({
    queryKey: queryKeys.profile(userId ?? "me"),
    queryFn: ({ signal }) =>
      userId ? profileApi.person(userId, signal) : profileApi.mine(signal),
  });
  const profile = query.data;

  usePageCommands("profile", [
    {
      id: "profile.preferences",
      label: "Change how the platform looks and behaves",
      keywords: "preferences settings theme density",
      run: () => navigate("/settings/preferences"),
    },
    {
      id: "profile.security",
      label: "Review your sessions and sign-ins",
      keywords: "security sessions devices sign in",
      run: () => navigate("/settings/security"),
    },
    {
      id: "profile.activity",
      label: "See what I have been doing",
      keywords: "activity history feed actions mine recent",
      run: () => navigate("/activity"),
    },
    {
      id: "profile.favorites",
      label: "See what I starred",
      keywords: "favorites bookmarks starred kept recents",
      run: () => navigate("/favorites"),
    },
  ]);

  const activityKind = params.get("kind") ?? "";
  const activity = useQuery({
    queryKey: queryKeys.profileActivity(profile?.user.id, activityKind),
    queryFn: ({ signal }) =>
      activityApi.feed({ actor_id: profile!.user.id, page_size: 100, ...(activityKind ? { kind: activityKind } : {}) }, signal),
    placeholderData: (previous) => previous,
    // Only when the tab is open *and* the reader may see the trail: a request
    // that comes back 403 to fill a tab nobody opened is a 403 in the log for
    // no reason.
    enabled: tab === "activity" && Boolean(profile?.visibility.activity),
  });

  return { userId, params, setParams, editing, setEditing, auth, tab, query, profile, activityKind, activity };
}
