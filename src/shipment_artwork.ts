import { z } from "zod";

export const deliveryArtworkRequest = z.object({
  shipmentId: z.string().min(1),
  deliveryId: z.string().min(1),
  event: z.enum(["delivered", "damaged", "address_exception"]),
  recipientName: z.string().min(1),
  proofNote: z.string().min(1),
});

export type DeliveryArtworkRequest = z.infer<typeof deliveryArtworkRequest>;

export type ArtworkDecision =
  | { state: "ready_to_publish"; objectKey: string; prompt: string }
  | { state: "needs_review"; reason: string };

export function decideArtwork(request: DeliveryArtworkRequest): ArtworkDecision {
  if (request.event !== "delivered") {
    return {
      state: "needs_review",
      reason: `Shipment event ${request.event} needs an operator before a proof image is shared.`,
    };
  }

  return {
    state: "ready_to_publish",
    objectKey: `proofs/${request.shipmentId}/${request.deliveryId}.png`,
    prompt: [
      "Create a clean logistics proof-of-delivery image for an internal media timeline.",
      `Shipment: ${request.shipmentId}. Recipient: ${request.recipientName}.`,
      `Delivery note: ${request.proofNote}.`,
      "Show a parcel at a front door, daylight, no readable address, no logos, and no faces.",
    ].join(" "),
  };
}
