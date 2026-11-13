import { Skeleton } from "antd";
import { Suspense, lazy, type ComponentProps, type ComponentType } from "react";

/** What a route shows while its page's chunk downloads. */
export function RouteLoading() {
  return <Skeleton active paragraph={{ rows: 8 }} />;
}

/**
 * A page loaded on demand, already wrapped in its loading boundary.
 *
 * ECharts is most of the bundle, and somebody who opens the audit log should
 * not download a charting library to read it. Splitting at the route is the
 * safe way to do this: the boundary follows an `import()` the bundler can see,
 * rather than a hand-drawn partition of somebody else's dependency graph —
 * which is what produced a cross-chunk cycle and a blank page last time.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the props are inferred per page
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  const Page = lazy(load);
  return function LazyPage(props: ComponentProps<T>) {
    return (
      <Suspense fallback={<RouteLoading />}>
        <Page {...props} />
      </Suspense>
    );
  };
}
