/**
 * The canvas's pure half: ports, layout, labels and edits on a workflow graph.
 *
 * Kept free of React so every rule the canvas follows — which outputs a node
 * has, where auto-layout puts it, what a connection may join — is asserted
 * directly, the same rules the server's `automation_graph` enforces.
 */

export * from "./edits";
export * from "./geometry";
export * from "./layout";
export * from "./nodeTypes";
