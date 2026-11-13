import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { formsApi, type FormDetail, type FormInput, type FormSettings } from "@/api/forms";
import { usePageCommands } from "@/commands/CommandContext";
import { errorToast } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

import { BLANK } from "./fieldTypes";

export type DesignerTab = "design" | "settings" | "submissions";

/** The form being designed: loaded or blank, its unsaved draft, and saving or removing it. */
export function useFormDesigner() {
  const { id = "new" } = useParams();
  const creating = id === "new";
  const navigate = useNavigate();
  const { message } = App.useApp();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (["design", "settings", "submissions"].includes(params.get("tab") ?? "") ? params.get("tab") : "design") as DesignerTab;

  const loaded = useQuery({
    queryKey: queryKeys.forms("item", id),
    queryFn: ({ signal }) => formsApi.get(id, signal),
    enabled: !creating,
  });
  const list = useQuery({ queryKey: queryKeys.forms("list"), queryFn: ({ signal }) => formsApi.list(signal), enabled: creating });
  const [draft, setDraft] = useState<FormDetail | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (creating && list.data && !draft) setDraft({ ...BLANK, targets: list.data.targets, can_manage: list.data.can_manage });
    if (!creating && loaded.data) { setDraft(loaded.data); setDirty(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating, loaded.data, list.data]);

  const change = (patch: Partial<FormDetail>) => { setDraft((current) => (current ? { ...current, ...patch } : current)); setDirty(true); };
  const changeSettings = (patch: Partial<FormSettings>) =>
    setDraft((current) => { setDirty(true); return current ? { ...current, settings: { ...current.settings, ...patch } } : current; });

  const save = useMutation({
    mutationFn: (status?: FormDetail["status"]) => {
      const body: FormInput = {
        name: draft!.name, slug: draft!.slug || undefined, description: draft!.description, target: draft!.target,
        fields: draft!.fields, settings: draft!.settings, ...(status ? { status } : {}),
      };
      return creating ? formsApi.create(body) : formsApi.update(id, body);
    },
    onSuccess: (saved) => {
      client.setQueryData(queryKeys.forms("item", saved.id), saved);
      void client.invalidateQueries({ queryKey: queryKeys.forms("list") });
      setDraft(saved);
      setDirty(false);
      message.success(saved.status === "PUBLISHED" ? "Saved — the form is live" : "Saved");
      if (creating) navigate(`/admin/forms/${saved.id}`, { replace: true });
    },
    onError: errorToast(message, { action: "save this form" }),
  });
  const remove = useMutation({
    mutationFn: () => formsApi.remove(id),
    onSuccess: () => { void client.invalidateQueries({ queryKey: queryKeys.forms() }); message.success("Form removed"); navigate("/admin/forms", { replace: true }); },
    onError: errorToast(message, { action: "remove this form" }),
  });

  usePageCommands("form-designer", [
    { id: "form.design", label: "Design the form's fields", keywords: "fields questions", run: () => setParams({}) },
    { id: "form.settings", label: "Form settings", keywords: "slug captcha thank you", run: () => setParams({ tab: "settings" }) },
    ...(creating ? [] : [{ id: "form.submissions", label: "See this form's submissions", keywords: "entries responses", run: () => setParams({ tab: "submissions" }) }]),
  ]);

  return { id, creating, tab, setParams, loaded, list, draft, dirty, change, changeSettings, save, remove };
}
