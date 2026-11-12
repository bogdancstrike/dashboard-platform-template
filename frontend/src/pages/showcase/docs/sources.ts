/**
 * The demos and their source, from the same files (§60).
 *
 * Every demo is a file in `./demos`, and the code a reader copies is that
 * file, read as text by the bundler. The sample cannot drift from the demo
 * because they are not two things: change the demo and the code under it
 * changes with it.
 */
import type { ComponentType } from "react";

const MODULES = import.meta.glob<{ default: ComponentType }>("./demos/*.tsx", { eager: true });
const RAW = import.meta.glob<string>("./demos/*.tsx", { eager: true, query: "?raw", import: "default" });
const TEMPLATE_MODULES = import.meta.glob<{ default: ComponentType }>("./templates/*.tsx", { eager: true });
const TEMPLATE_RAW = import.meta.glob<string>("./templates/*.tsx", { eager: true, query: "?raw", import: "default" });

const key = (path: string) => path.split("/").pop()!.replace(/\.tsx$/, "");

function index<T>(files: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(files).map(([path, value]) => [key(path), value]));
}

export const DEMOS = index(MODULES);
export const DEMO_SOURCE = index(RAW);
export const TEMPLATES = index(TEMPLATE_MODULES);
export const TEMPLATE_SOURCE = index(TEMPLATE_RAW);
