import test from "node:test";
import assert from "node:assert/strict";
import { decideArtwork } from "../src/shipment_artwork.js";

test("damaged shipment stays in review and never receives a shareable proof image", () => {
  const decision = decideArtwork({
    shipmentId: "SHP-9",
    deliveryId: "DEL-9",
    event: "damaged",
    recipientName: "Ravi Patel",
    proofNote: "Outer carton has a crushed corner.",
  });

  assert.deepEqual(decision, {
    state: "needs_review",
    reason: "Shipment event damaged needs an operator before a proof image is shared.",
  });
});
