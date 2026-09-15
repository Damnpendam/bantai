export async function register() {
  // The database and crypto are Node-only; nothing to do in any other runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { bootstrap } = await import("./lib/bootstrap");
  await bootstrap();
}
