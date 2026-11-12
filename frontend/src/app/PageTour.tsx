/**
 * The Help button, doing something (§77).
 *
 * It rendered a circle that answered no press — which is worse than no button
 * at all, because a control that does nothing teaches somebody that the chrome
 * of this product is decorative and they stop trying the rest of it.
 *
 * Pressing it now explains *the page they are on*, pointing at the real
 * controls with AntD's `Tour`. Three decisions worth stating.
 *
 * **Targets are resolved when the tour opens, not when it is declared.** Half
 * of these pages differ by role, and a step pointing at a button that is not
 * there would anchor to nothing and read as a bug. Missing targets are dropped
 * — and if *every* target is missing, the tour still runs as the untargeted
 * steps it has left, because the prose is worth reading on its own.
 *
 * **A page with nothing declared says so.** The button stays, disabled, with a
 * tooltip naming the page — rather than vanishing, which would leave somebody
 * wondering whether help exists at all.
 *
 * **It never opens itself.** A tour that runs on first visit is a modal
 * somebody dismisses without reading; this one is asked for.
 */

import { Button, Popover, Tooltip, Tour, type TourProps } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { useState } from "react";
import { NxIcon } from "@/components/NxIcon";
import { useLocation } from "react-router-dom";

import { useAuth } from "@/auth/AuthProvider";
import { PageAsk } from "@/components/assistant/PageAsk";

import { tourFor } from "./tours";

export function PageTour({ variant = "circle" }: { variant?: "circle" | "side" | "rail" } = {}) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  // The help panel (§46): the tour, and a question about this page. Without
  // the assistant the button opens the tour directly, as it always did.
  const [panel, setPanel] = useState(false);
  const canAsk = useAuth().can("ai.use");
  const stops = tourFor(location.pathname);

  /**
   * The steps that can actually be shown, resolved now.
   *
   * `getTarget` is a function rather than an element because AntD re-reads it
   * on each step: a control inside a drawer the previous step opened is not in
   * the DOM when the tour starts, and resolving eagerly would anchor it to
   * nothing.
   */
  const steps: TourProps["steps"] = (stops ?? [])
    .filter((stop) => !stop.target || document.querySelector(`[data-testid="${stop.target}"]`))
    .map((stop) => ({
      title: stop.title,
      description: stop.description,
      ...(stop.target
        ? {
            target: () =>
              document.querySelector(`[data-testid="${stop.target}"]`) as HTMLElement,
          }
        : {}),
    }));

  return (
    <>
      <Popover
        open={canAsk && panel}
        onOpenChange={(next) => setPanel(canAsk && next)}
        trigger="click"
        placement="bottomRight"
        overlayClassName="nx-ai-helppanel"
        content={
          <div className="nx-ai-helppanel-body" data-testid="help-panel">
            <Button
              block
              disabled={!stops || steps.length === 0}
              onClick={() => {
                setPanel(false);
                setOpen(true);
              }}
              data-testid="help-take-tour"
            >
              {stops && steps.length > 0 ? `Take the tour · ${steps.length} stops` : "No tour for this page yet"}
            </Button>
            <PageAsk stops={stops} onDone={() => setPanel(false)} />
          </div>
        }
      >
        <Tooltip
          title={
            stops
              ? "A quick tour of this page"
              : canAsk
                ? "Ask about this page"
                : `There is no tour for ${location.pathname} yet`
          }
        >
          {/* Disabled rather than hidden: a button that disappears on some pages
              leaves somebody wondering whether help exists at all (§76). */}
          {variant === "circle" ? (
            <Button
              shape="circle"
              aria-label="Help"
              data-testid="page-tour"
              disabled={!canAsk && (!stops || steps.length === 0)}
              icon={<QuestionCircleOutlined />}
              onClick={canAsk ? undefined : () => setOpen(true)}
            />
          ) : (
            <button
              type="button"
              className={`nx-help nx-help--${variant}`}
              aria-label="Help"
              data-testid="page-tour"
              disabled={!canAsk && (!stops || steps.length === 0)}
              onClick={canAsk ? undefined : () => setOpen(true)}
            >
              <NxIcon name="help" />
              <span className="nx-fold-label">Help &amp; page tour</span>
            </button>
          )}
        </Tooltip>
      </Popover>

      <Tour
        open={open}
        onClose={() => setOpen(false)}
        steps={steps}
        rootClassName="nx-ov-tour"
        // Every step says what it is for rather than counting down, so the
        // last one closes rather than promising more.
        indicatorsRender={(current, total) => (
          <span className="nu-tour-count">
            {current + 1} of {total}
          </span>
        )}
      />
    </>
  );
}
