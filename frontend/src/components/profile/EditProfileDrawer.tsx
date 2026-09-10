/**
 * Correcting your own details (§40).
 *
 * There was nowhere in this platform to do it. The profile page *displayed* a
 * job title and a timezone, and the only writer was an administrator on
 * `/admin/users/:id` — which is precisely the page the person concerned cannot
 * open. So the commonest correction anybody ever makes to a directory ("my
 * title changed", "I moved") had to go through a support request.
 *
 * Three decisions worth stating.
 *
 * **Only what a person is the authority on.** Not the email or the username,
 * which prove who they are to Keycloak; not the role, team or department,
 * which are decisions somebody else makes about them; not the status or the
 * sign-in record, which the platform writes. The server holds the same list
 * and refuses anything outside it by name — this form is the shape of that
 * list, not a second opinion about it.
 *
 * **The timezone is offered from the browser's own list.** `Intl` knows every
 * zone the runtime supports, and a hand-typed vocabulary here would go stale
 * the next time a country changed its offset. It matters more than it looks:
 * the profile's activity heatmap is drawn in the person's own hours, so "busy
 * at 09:00" means nothing until this field is right.
 *
 * **Saving answers with the whole profile.** The header, the avatar and every
 * mention of this person redraw from it, and a partial answer would leave the
 * old name in the chrome until a reload.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Drawer, Form, Input, Select, Space, Typography } from "antd";
import { useMemo } from "react";

import { ApiError } from "@/api/client";
import { meApi, type CurrentUser, type ProfilePatch } from "@/api/me";
import { PersonAvatar } from "@/components/PersonAvatar";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";

const { Text } = Typography;

/**
 * Every timezone this browser knows, or a short list if it will not say.
 *
 * `supportedValuesOf` is unavailable in older runtimes and in some test
 * environments, so the fallback is the handful a demo actually uses — a select
 * with nothing in it would make the field unfillable rather than merely
 * inconvenient.
 */
function zones(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    if (supported && supported.length > 0) return supported;
  } catch {
    // Fall through to the short list.
  }
  return [
    "UTC",
    "Europe/London",
    "Europe/Bucharest",
    "Europe/Berlin",
    "America/New_York",
    "America/Los_Angeles",
    "Asia/Singapore",
  ];
}

export function EditProfileDrawer({
  open,
  profile,
  onClose,
}: {
  open: boolean;
  profile: CurrentUser | undefined;
  onClose: () => void;
}) {
  const [form] = Form.useForm<ProfilePatch>();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const { touch, requestClose } = useDiscardGuard({ close: onClose, what: "profile" });
  const timezones = useMemo(zones, []);

  const save = useMutation({
    mutationFn: (patch: ProfilePatch) => meApi.updateProfile(patch),
    onSuccess: (saved) => {
      // Written from the answer rather than invalidated: the server has just
      // returned the whole merged profile, and refetching would show the
      // reader their own change arriving a second time.
      queryClient.setQueryData<CurrentUser>(["me"], saved);
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      void queryClient.invalidateQueries({ queryKey: ["directory"] });
      message.success("Saved");
      onClose();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That change was not saved."),
  });

  const user = profile?.user;

  return (
    <Drawer
      open={open}
      onClose={requestClose}
      width={430}
      destroyOnHidden
      title="Your details"
      extra={
        <Button
          type="primary"
          loading={save.isPending}
          onClick={() => void form.submit()}
          data-testid="save-profile"
        >
          Save
        </Button>
      }
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Space size={12} align="center">
          <PersonAvatar
            size={48}
            name={user?.full_name}
            initials={user?.initials}
            src={user?.avatar_url ?? undefined}
          />
          <span>
            <Text strong style={{ display: "block" }}>
              {user?.email}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Your address and your role are not yours to change here — the first proves who you
              are, the second is somebody else&apos;s decision about you.
            </Text>
          </span>
        </Space>

        <Form
          form={form}
          layout="vertical"
          onValuesChange={touch}
          initialValues={{
            full_name: user?.full_name ?? "",
            first_name: user?.first_name ?? "",
            last_name: user?.last_name ?? "",
            job_title: user?.job_title ?? "",
            phone: user?.phone ?? "",
            avatar_url: user?.avatar_url ?? "",
            locale: user?.locale ?? "en-US",
            timezone: user?.timezone ?? "UTC",
          }}
          onFinish={(values) => save.mutate(values)}
        >
          <Form.Item
            name="full_name"
            label="Name"
            extra="How every list, avatar and mention of you reads."
            rules={[{ required: true, message: "A name is how everybody else finds you" }]}
          >
            <Input />
          </Form.Item>
          <Space size={8} style={{ width: "100%" }}>
            <Form.Item name="first_name" label="First name">
              <Input />
            </Form.Item>
            <Form.Item name="last_name" label="Last name">
              <Input />
            </Form.Item>
          </Space>
          <Form.Item name="job_title" label="Job title">
            <Input placeholder="Support lead" />
          </Form.Item>
          <Form.Item name="phone" label="Phone" extra="Shown to colleagues who may see contact details.">
            <Input placeholder="+40 700 000 000" />
          </Form.Item>
          <Form.Item
            name="avatar_url"
            label="Picture"
            extra="A link to an image. Leave it empty to use your initials."
          >
            <Input placeholder="https://…" />
          </Form.Item>
          <Form.Item
            name="timezone"
            label="Timezone"
            extra="Your activity heatmap is drawn in these hours — “busy at 09:00” means nothing without it."
          >
            <Select showSearch options={timezones.map((zone) => ({ value: zone, label: zone }))} />
          </Form.Item>
          <Form.Item name="locale" label="Language" extra="How dates and numbers are spelled for you.">
            <Select
              showSearch
              options={["en-US", "en-GB", "ro-RO", "de-DE", "fr-FR", "es-ES"].map((code) => ({
                value: code,
                label: code,
              }))}
            />
          </Form.Item>
        </Form>
      </Space>
    </Drawer>
  );
}
