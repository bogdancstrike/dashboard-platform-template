import { Button, Popover, Tooltip } from "antd";
import { SmileOutlined } from "@ant-design/icons";

import type { Reaction } from "@/api/comments";

export function ReactionBar({
  reactions,
  offered,
  onReact,
  disabled,
}: {
  reactions: Reaction[];
  offered: string[];
  onReact: (emoji: string) => void;
  disabled?: boolean;
}) {
  if (reactions.length === 0) return null;
  return (
    <div className="nx-co-reactions" aria-label="Reactions">
      {reactions.map((reaction) => (
        <Tooltip key={reaction.emoji} title={reaction.people.join(", ")}>
          <button
            type="button"
            className={`nx-co-reaction${reaction.mine ? " is-mine" : ""}`}
            aria-pressed={reaction.mine}
            aria-label={`${reaction.emoji} ${reaction.count}`}
            disabled={disabled || !offered.includes(reaction.emoji)}
            onClick={() => onReact(reaction.emoji)}
          >
            <span>{reaction.emoji}</span>
            <b>{reaction.count}</b>
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

export function ReactionPicker({
  offered,
  onReact,
  disabled,
}: {
  offered: string[];
  onReact: (emoji: string) => void;
  disabled?: boolean;
}) {
  return (
    <Popover
      trigger="click"
      placement="top"
      content={
        <div className="nx-co-emoji" role="group" aria-label="Pick a reaction">
          {offered.map((emoji) => (
            <button key={emoji} type="button" aria-label={`React ${emoji}`} onClick={() => onReact(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      }
    >
      <Button size="small" type="text" icon={<SmileOutlined />} aria-label="Add a reaction" disabled={disabled} />
    </Popover>
  );
}
