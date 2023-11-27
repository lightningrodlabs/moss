import { fixture, waitUntil } from "@open-wc/testing-helpers";
import expect from "expect";
import { browser, $ } from "@wdio/globals";
import { WeApp } from "../../ui/app/src/we-app";

describe("installing applets on groups works", () => {
  it("should be able to create a password", async () => {
    const weApp: WeApp = await waitUntil(() => $("body > we-app"));
    console.log(weApp);
    const createPassword = await waitUntil(() =>
      weApp.shadowRoot!.querySelector("create-password")
    );
  });
});
