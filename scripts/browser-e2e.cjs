const assert = require("node:assert/strict");

const playwrightPath = process.env.PLAYWRIGHT_MODULE_DIR;
if (!playwrightPath) throw new Error("PLAYWRIGHT_MODULE_DIR is required");
const { chromium } = require(playwrightPath);

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();

    await page.goto("http://127.0.0.1:3000/", { waitUntil: "networkidle" });
    const landingHeading = await page.getByRole("heading", { level: 1 }).innerText();
    assert.match(landingHeading, /Your cloud landscape/i);

    const loginResponse = await page.goto("http://127.0.0.1:3000/login", { waitUntil: "networkidle" });
    assert.equal(loginResponse.status(), 200);
    const responseHeaders = await loginResponse.allHeaders();
    assert.equal(responseHeaders["x-content-type-options"], "nosniff");
    assert.equal(responseHeaders["x-frame-options"], "DENY");
    assert.equal(responseHeaders["permissions-policy"], "camera=(), microphone=(), geolocation=()");
    let loginPayload;
    await page.route("**/v1/auth/login", async (route) => {
      loginPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } }),
      });
    });
    await page.getByLabel("Email address").fill("qa@example.test");
    await page.getByLabel("Password").fill("incorrect-password");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.getByRole("alert").waitFor({ state: "visible" });
    assert.deepEqual(loginPayload, { email: "qa@example.test", password: "incorrect-password" });

    await page.goto("http://127.0.0.1:3000/signup", { waitUntil: "networkidle" });
    let signupRequested = false;
    await page.route("**/v1/auth/signup", async (route) => {
      signupRequested = true;
      await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    });
    await page.getByLabel("Full name").fill("CloudRoute QA");
    await page.getByLabel("Email address").fill("new-user@example.test");
    const password = page.getByLabel(/Password/);
    await password.fill("short");
    assert.equal(await password.evaluate((element) => element.validity.tooShort), true);
    await page.getByRole("button", { name: /create account/i }).click();
    assert.equal(signupRequested, false, "browser validation must block a password shorter than 12 characters");

    console.log("Browser E2E smoke tests passed: landing page, login error flow, and signup password validation.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
