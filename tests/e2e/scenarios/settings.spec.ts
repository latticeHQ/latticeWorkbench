import { electronTest as test, electronExpect as expect } from "../electronTest";

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "Electron scenario runs on chromium only"
);

test.describe("Settings Modal", () => {
  test("opens settings modal via gear button", async ({ ui, page }) => {
    await ui.projects.openFirstWorkspace();

    // Open settings
    await ui.settings.open();

    // Verify modal is open with correct structure
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible();

    // Verify sidebar sections are present
    await expect(page.getByRole("button", { name: "General", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Providers", exact: true })).toBeVisible();

    // Verify default section is General (theme toggle visible)
    await expect(page.getByText("Theme", { exact: true })).toBeVisible();
  });

  test("navigates between settings sections", async ({ ui, page }) => {
    await ui.projects.openFirstWorkspace();
    await ui.settings.open();

    // Navigate to Providers section
    await ui.settings.selectSection("Providers");
    await expect(page.getByText(/Providers detected on your system/i)).toBeVisible();

    // Navigate back to General
    await ui.settings.selectSection("General");
    await expect(page.getByText("Theme", { exact: true })).toBeVisible();
  });

  test("closes settings with Escape key", async ({ ui }) => {
    await ui.projects.openFirstWorkspace();
    await ui.settings.open();

    // Close via Escape
    await ui.settings.close();

    // Verify closed
    await ui.settings.expectClosed();
  });

  test("closes settings with X button", async ({ ui, page }) => {
    await ui.projects.openFirstWorkspace();
    await ui.settings.open();

    // Click close button
    const closeButton = page.getByRole("button", { name: /close settings/i });
    await closeButton.click();

    // Verify closed
    await ui.settings.expectClosed();
  });

  test("closes settings by clicking overlay", async ({ ui, page }) => {
    await ui.projects.openFirstWorkspace();
    await ui.settings.open();

    // Click overlay (outside modal content) - Radix Dialog uses data-state attribute
    const overlay = page.locator('[data-state="open"].fixed.inset-0');
    await overlay.click({ position: { x: 10, y: 10 }, force: true });

    // Verify closed
    await ui.settings.expectClosed();
  });

  test("Providers section shows agent table with status", async ({ ui, page }) => {
    await ui.projects.openFirstWorkspace();
    await ui.settings.open();
    await ui.settings.selectSection("Providers");

    // Verify agent table structure
    await expect(page.getByText("Agent", { exact: true })).toBeVisible();
    await expect(page.getByText("Status", { exact: true })).toBeVisible();
    await expect(page.getByText("Version", { exact: true })).toBeVisible();

    // Verify rescan button is present
    await expect(page.getByRole("button", { name: /Rescan/i })).toBeVisible();
  });
});
