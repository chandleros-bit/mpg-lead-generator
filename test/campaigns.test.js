import test from "node:test";
import assert from "node:assert/strict";
import { generateCampaign } from "../lib/campaigns.js";
import { scoredLead } from "../lib/models.js";
import { PERSONAL, makeBusiness } from "./helpers.js";

function displacementLead() {
  const b = makeBusiness({ name: "Cut & Co Salon", category: "salon", rating: 3.5, review_count: 120 });
  return scoredLead({ business: b, track: "displacement", score: 75, bucket: "hot", why: ["Displacement • Salon"] });
}
function greenfieldLead() {
  const b = makeBusiness({ name: "Nueva Taqueria", category: "restaurant", review_count: 2 });
  return scoredLead({ business: b, track: "greenfield", score: 80, bucket: "hot", why: ["Greenfield • Restaurant"] });
}

test("displacement angle is not a setup pitch", () => {
  const c = generateCampaign(displacementLead(), PERSONAL);
  const body = (c.email1_body + c.email2_body).toLowerCase();
  assert.ok(body.includes("switch") || body.includes("overpay") || body.includes("rate"));
  assert.ok(!body.includes("getting set up"));
});

test("greenfield angle is not a switch pitch", () => {
  const c = generateCampaign(greenfieldLead(), PERSONAL);
  const body = (c.email1_body + c.email2_body).toLowerCase();
  assert.ok(body.includes("set up") || body.includes("getting started"));
  assert.ok(!body.includes("switch"));
});

test("footer present and no unrendered tokens", () => {
  const c = generateCampaign(displacementLead(), PERSONAL);
  assert.ok(c.email1_body.includes("Reply STOP to opt out."));
  assert.ok(!c.email1_body.includes("{") && !c.email1_body.includes("}"));
  assert.ok(!c.voicemail.includes("{") && !c.voicemail.includes("}"));
});
