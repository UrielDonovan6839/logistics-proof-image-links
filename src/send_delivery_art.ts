const body = {
  shipmentId: "SHP-2048",
  deliveryId: "DEL-2048",
  event: "delivered",
  recipientName: "Mina Chen",
  proofNote: "Parcel left beside the blue planter after a signed handoff.",
};

const response = await fetch("http://localhost:3000/delivery-artwork", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

console.log(await response.json());

export {};
