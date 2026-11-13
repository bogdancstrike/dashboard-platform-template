import { useMutation, useQuery } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useEffect, useState } from "react";

import { ApiError } from "@/api/client";
import { mailApi, type ComposeInput, type MailMessage, type MailThread } from "@/api/mail";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { type FormValues, replyDefaults } from "./compose";

import type { FormInstance } from "antd";

/**
 * The composer's behaviour: reset on every open (new, reply or draft), fill
 * from a template on the server, and save — as a draft, or sent to the Outbox.
 */
export function useComposerActions({
  form,
  open,
  draft,
  thread,
  meEmail,
  settled,
  onSaved,
}: {
  form: FormInstance<FormValues>;
  open: boolean;
  draft: MailMessage | null;
  thread: MailThread | null;
  meEmail: string | null;
  settled: () => void;
  onSaved: (thread: MailThread) => void;
}) {
  const { message } = AntApp.useApp();
  const [template, setTemplate] = useState<string | undefined>();

  const templates = useQuery({
    queryKey: queryKeys.mailTemplates(),
    queryFn: ({ signal }) => mailApi.templates(signal),
    staleTime: STALE.long,
    enabled: open,
  });

  // Reset on every open: the same component writes a new message, a reply and
  // an edit to a draft, and one that kept the previous subject saves the wrong
  // thing.
  useEffect(() => {
    if (!open) return;
    setTemplate(undefined);
    if (draft) {
      form.setFieldsValue({
        to: draft.to.map((person) => person.email),
        cc: draft.cc.map((person) => person.email),
        subject: draft.subject,
        body: draft.body,
        priority: draft.priority,
      });
      return;
    }
    form.setFieldsValue({
      to: [],
      cc: [],
      subject: "",
      body: "",
      priority: "NORMAL",
      ...(thread ? replyDefaults(thread, meEmail) : {}),
    });
  }, [open, draft, thread, meEmail, form]);

  /** Fill the box from a template, on the server. */
  const apply = useMutation({
    mutationFn: (code: string) => mailApi.render(code, {}),
    onSuccess: (filled) => {
      const current = form.getFieldsValue();
      form.setFieldsValue({
        subject: current.subject || filled.subject,
        body: current.body || filled.body,
      });
      if (filled.unfilled.length > 0) {
        message.info(
          `That template still needs ${filled.unfilled.join(", ")} — fill them in before sending.`,
        );
      }
    },
    onError: (error) =>
      message.error(
        error instanceof ApiError ? error.message : "That template could not be read.",
      ),
  });

  const save = useMutation({
    mutationFn: ({ values, send }: { values: FormValues; send: boolean }) => {
      const input: ComposeInput = {
        subject: values.subject,
        body: values.body,
        to: values.to,
        cc: values.cc ?? [],
        priority: values.priority,
        send,
      };
      if (draft) return mailApi.updateMessage(draft.id, input);
      return mailApi.compose(thread ? { ...input, thread_id: thread.id } : input);
    },
    onSuccess: (saved, variables) => {
      message.success(
        variables.send
          ? "Queued — it is in your Outbox until a transport takes it"
          : "Saved as a draft",
      );
      settled();
      onSaved(saved);
    },
    onError: (error) =>
      message.error(
        error instanceof ApiError ? error.message : "That message could not be saved.",
      ),
  });

  const submit = async (send: boolean) => {
    let values: FormValues;
    if (send) {
      try {
        values = await form.validateFields();
      } catch {
        // `validateFields` *rejects* when a field is empty, which is the
        // normal path here — AntD has already put the messages under the
        // fields. Uncaught, `void submit(true)` turned every empty Send into
        // an unhandled rejection: 445 tests passing and one error in the run.
        return;
      }
    } else {
      values = form.getFieldsValue();
      if (!values.subject.trim() && !values.body.trim()) {
        message.info("There is nothing to save yet.");
        return;
      }
    }
    save.mutate({ values, send });
  };

  return { template, setTemplate, templates, apply, save, submit };
}
