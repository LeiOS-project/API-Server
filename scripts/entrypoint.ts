
console.log("Running database migrations...");

await Bun.$`bun run db:migrate`;

console.log("Database migrations completed.");

console.log("Starting API server...");

await import("../src/index");

export {};