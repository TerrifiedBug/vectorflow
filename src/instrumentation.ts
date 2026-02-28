export async function register() {
  // Only start the fleet poller on the server side (not in Edge Runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { fleetPoller } = await import("@/server/services/fleet-poller");
    await fleetPoller.start();
    console.log("Fleet poller started");
  }
}
