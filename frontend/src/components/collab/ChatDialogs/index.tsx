/**
 * Starting a conversation (§47): a new channel, or a message to one person —
 * and the channel's own settings and members.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Form, Input, Modal, Switch, Typography } from "antd";
import { useState } from "react";

import { apiMessageToast } from "@/lib/errors";
import { chatApi, type ChannelDetail } from "@/api/chat";
import { PeoplePicker } from "@/components/PeoplePicker";

import { queryKeys } from "@/lib/queryKeys";

export { MembersPanel } from "./MembersPanel";

const { Text } = Typography;

export function NewChannelModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (channel: ChannelDetail) => void;
}) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ name: string; topic: string; private: boolean }>();
  const [members, setMembers] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: (values: { name: string; topic: string; private: boolean }) =>
      chatApi.create({
        name: values.name,
        topic: values.topic || undefined,
        visibility: values.private ? "PRIVATE" : "PUBLIC",
        member_ids: members,
      }),
    onSuccess: (channel) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatChannels() });
      form.resetFields();
      setMembers([]);
      onCreated(channel);
    },
    onError: apiMessageToast(message, "The channel was not created."),
  });

  return (
    <Modal
      open={open}
      title="New channel"
      okText="Create channel"
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={create.isPending}
      okButtonProps={{ "data-testid": "create-channel" }}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={(values) => create.mutate(values)} initialValues={{ private: false }}>
        <Form.Item
          name="name"
          label="Name"
          rules={[{ required: true, message: "A channel needs a name." }]}
          extra="Lower case, with hyphens — like #release-planning."
        >
          <Input prefix="#" placeholder="release-planning" maxLength={80} aria-label="Channel name" />
        </Form.Item>
        <Form.Item name="topic" label="Topic">
          <Input placeholder="What this channel is for" maxLength={240} aria-label="Channel topic" />
        </Form.Item>
        <Form.Item name="private" label="Private" valuePropName="checked" extra="Only the people in it can find it.">
          <Switch aria-label="Private channel" />
        </Form.Item>
        <Form.Item label="People">
          <PeoplePicker value={members} onChange={(ids) => setMembers(ids)} aria-label="Channel members" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function NewDirectModal({
  open,
  onClose,
  onOpened,
}: {
  open: boolean;
  onClose: () => void;
  onOpened: (channel: ChannelDetail) => void;
}) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [person, setPerson] = useState<string[]>([]);
  const start = useMutation({
    mutationFn: (id: string) => chatApi.direct(id),
    onSuccess: (channel) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatChannels() });
      setPerson([]);
      onOpened(channel);
    },
    onError: apiMessageToast(message, "That conversation could not be opened."),
  });
  return (
    <Modal
      open={open}
      title="New message"
      okText="Open conversation"
      onCancel={onClose}
      onOk={() => person[0] && start.mutate(person[0])}
      okButtonProps={{ disabled: !person[0], "data-testid": "open-direct" }}
      confirmLoading={start.isPending}
      destroyOnHidden
    >
      <Text type="secondary">Who do you want to talk to?</Text>
      <div className="nu-block">
        <PeoplePicker
          multiple={false}
          value={person}
          onChange={(ids) => setPerson(ids.slice(-1))}
          aria-label="Person to message"
        />
      </div>
    </Modal>
  );
}

export function ChannelSettingsModal({
  channel,
  open,
  onClose,
  onSaved,
  onArchived,
}: {
  channel: ChannelDetail;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onArchived: () => void;
}) {
  const { message, modal } = AntApp.useApp();
  const [form] = Form.useForm<{ name: string; topic: string }>();
  const save = useMutation({
    mutationFn: (values: { name: string; topic: string }) => chatApi.update(channel.id, values),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: apiMessageToast(message, "The channel was not saved."),
  });
  const archive = useMutation({
    mutationFn: () => chatApi.archive(channel.id),
    onSuccess: onArchived,
    onError: apiMessageToast(message, "The channel was not archived."),
  });
  return (
    <Modal
      open={open}
      title={`#${channel.name} settings`}
      okText="Save"
      onOk={() => form.submit()}
      onCancel={onClose}
      confirmLoading={save.isPending}
      destroyOnHidden
      footer={(_, { OkBtn, CancelBtn }) => (
        <div className="nx-co-modal-foot">
          <Button
            danger
            onClick={() =>
              modal.confirm({
                title: `Archive #${channel.name}?`,
                content: "Nobody can post in it any more. What was said stays readable in search.",
                okText: "Archive",
                okButtonProps: { danger: true },
                onOk: () => archive.mutateAsync(),
              })
            }
          >
            Archive channel
          </Button>
          <span>
            <CancelBtn />
            <OkBtn />
          </span>
        </div>
      )}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ name: channel.name, topic: channel.topic ?? "" }}
        onFinish={(values) => save.mutate(values)}
      >
        <Form.Item name="name" label="Name" rules={[{ required: true, message: "A channel needs a name." }]}>
          <Input prefix="#" maxLength={80} aria-label="Channel name" />
        </Form.Item>
        <Form.Item name="topic" label="Topic">
          <Input maxLength={240} aria-label="Channel topic" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
