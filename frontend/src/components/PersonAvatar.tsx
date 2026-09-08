/**
 * A person's face, or their initials (§64).
 *
 * A component rather than four `<Avatar src={…}>` call sites, for one reason
 * that axe found on `/home`: AntD renders an `<img>` when `src` is set, and an
 * image with no alternative text is a *serious* accessibility violation. Every
 * avatar in the platform had one, because the seed gives every user an avatar
 * data URI — so the bug was on the shell, the people picker and every comment
 * thread as well, and fixing it in four places is fixing it in three plus
 * whichever one is written next.
 *
 * **The alt text is empty on purpose.** An avatar in this platform always sits
 * beside the person's name: in the header, in a picker option, at the top of a
 * comment. Giving it the name as alt makes a screen reader read the name
 * twice, which is worse than reading it once — so the image is marked as
 * decoration and the name beside it does the work. The one case that would
 * need real alt text — an avatar with no name near it — does not exist here,
 * and `label` is the way to say so if it ever does.
 */

import { Avatar } from "antd";
import type { AvatarProps } from "antd";

export function PersonAvatar({
  name,
  initials,
  src,
  label,
  ...rest
}: Omit<AvatarProps, "src" | "alt"> & {
  /** Only used when `label` is asked for; the name is normally beside it. */
  name?: string | null;
  initials?: string | null;
  src?: string | null;
  /**
   * Set when the avatar is the *only* thing identifying the person. Then it
   * gets the name as its accessible name instead of being decoration.
   */
  label?: boolean;
}) {
  const described = label && name;
  return (
    <Avatar
      {...rest}
      src={src ?? undefined}
      alt={described ? name : ""}
      aria-label={described ? name : undefined}
      aria-hidden={described ? undefined : true}
    >
      {initials}
    </Avatar>
  );
}
