import { Avatar } from "antd";

import { PersonAvatar } from "@/components/PersonAvatar";

export default function PersonAvatarBasic() {
  return (
    <div className="nx-doc-row">
      <PersonAvatar name="Ada Administrator" initials="AA" size="small" />
      <PersonAvatar name="Mara Manager" initials="MM" />
      <PersonAvatar name="Otto Operator" initials="OO" size="large" label />
      <PersonAvatar name={null} initials={null} />
      <Avatar.Group max={{ count: 3 }}>
        <PersonAvatar name="Ada" initials="AA" />
        <PersonAvatar name="Mara" initials="MM" />
        <PersonAvatar name="Otto" initials="OO" />
        <PersonAvatar name="Lars" initials="LH" />
        <PersonAvatar name="Priya" initials="PS" />
      </Avatar.Group>
    </div>
  );
}
