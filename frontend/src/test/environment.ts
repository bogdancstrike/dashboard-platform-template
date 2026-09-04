/**
 * jsdom, with Node's own abort primitives left in place.
 *
 * jsdom installs its `AbortController` and `AbortSignal` over Node's when it
 * populates the global object. Node's `fetch` (undici) brand-checks the signal
 * it is handed against *its* `AbortSignal`, so every cancellable request made
 * from a test — which is every request the API client makes, because React
 * Query passes a signal to each query function — fails before it is sent:
 *
 *     TypeError: RequestInit: Expected signal ("AbortSignal {}")
 *                to be an instance of AbortSignal.
 *
 * The symptom is a component test rendering "Could not reach the API" while the
 * mock handlers sit unused, which reads like a broken mock rather than two
 * incompatible copies of one web standard.
 *
 * Restoring Node's copies after jsdom has populated the global keeps both sides
 * on the same class. Nothing in the app constructs an `AbortController` that
 * needs to be a jsdom one: signals are passed to `fetch` and nowhere else.
 */

import { builtinEnvironments, type Environment } from "vitest/environments";

/** The globals jsdom must not be allowed to shadow. */
const NODE_OWNED = ["AbortController", "AbortSignal"] as const;

const environment: Environment = {
  name: "jsdom-node-abort",
  transformMode: "web",
  async setup(global, options) {
    const native = NODE_OWNED.map((key) => [key, Reflect.get(global, key)] as const);
    const { teardown } = await builtinEnvironments["jsdom"].setup(global, options);

    for (const [key, value] of native) {
      if (value !== undefined) Reflect.set(global, key, value);
    }

    return { teardown };
  },
};

export default environment;
