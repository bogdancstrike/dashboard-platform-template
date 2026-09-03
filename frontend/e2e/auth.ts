import { expect, type Page } from "@playwright/test";

export const PERSONAS = {
  admin: { username: "admin", password: "admin", name: "Ada Administrator" },
  manager: { username: "manager", password: "manager", name: "Mara Manager" },
  operator: { username: "operator", password: "operator", name: "Otto Operator" },
  analyst: { username: "analyst", password: "analyst", name: "Ana Analyst" },
  viewer: { username: "user", password: "user", name: "Uma User" },
} as const;

export async function signIn(
  page: Page,
  persona: keyof typeof PERSONAS = "admin",
  path = "/dashboard",
): Promise<void> {
  const account = PERSONAS[persona];
  await page.goto(path);

  if (new URL(page.url()).port === "8080") {
    await expect(page).toHaveTitle(/Sign in to Nucleus/);
    await page.locator('input[name="username"]').fill(account.username);
    await page.locator('input[name="password"]').fill(account.password);
    await page.getByRole("button", { name: "Sign In" }).click();
  }

  await page.waitForURL((url) => url.port === "5174");
  await expect(page.getByRole("banner").getByText(account.name, { exact: true })).toBeVisible();
}
