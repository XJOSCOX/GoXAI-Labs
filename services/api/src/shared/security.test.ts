import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCorsOriginValidator, getAllowedWebOrigins, getPositiveIntegerEnv, getTrustProxySetting } from "./security.js";

describe("security helpers", () => {
  it("parses comma-separated web origins", () => {
    assert.deepEqual(getAllowedWebOrigins("https://goxailab.com, https://app.goxailab.com/"), [
      "https://goxailab.com",
      "https://app.goxailab.com"
    ]);
  });

  it("allows configured CORS origins and rejects unknown origins", async () => {
    const validate = createCorsOriginValidator(["https://app.goxailab.com"]);

    await assert.doesNotReject(() => runCorsCheck(validate, "https://app.goxailab.com"));
    await assert.doesNotReject(() => runCorsCheck(validate, undefined));
    await assert.rejects(() => runCorsCheck(validate, "https://example.com"), /Origin is not allowed/);
  });

  it("normalizes trust proxy settings", () => {
    assert.equal(getTrustProxySetting(undefined), false);
    assert.equal(getTrustProxySetting("false"), false);
    assert.equal(getTrustProxySetting("true"), true);
    assert.equal(getTrustProxySetting("1"), 1);
  });

  it("falls back when positive integer environment values are invalid", () => {
    const previous = process.env.TEST_INTEGER_ENV;

    process.env.TEST_INTEGER_ENV = "25";
    assert.equal(getPositiveIntegerEnv("TEST_INTEGER_ENV", 10), 25);

    process.env.TEST_INTEGER_ENV = "0";
    assert.equal(getPositiveIntegerEnv("TEST_INTEGER_ENV", 10), 10);

    process.env.TEST_INTEGER_ENV = "nope";
    assert.equal(getPositiveIntegerEnv("TEST_INTEGER_ENV", 10), 10);

    if (previous === undefined) {
      delete process.env.TEST_INTEGER_ENV;
    } else {
      process.env.TEST_INTEGER_ENV = previous;
    }
  });
});

function runCorsCheck(
  validate: ReturnType<typeof createCorsOriginValidator>,
  origin: string | undefined
) {
  return new Promise<void>((resolve, reject) => {
    validate(origin, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
