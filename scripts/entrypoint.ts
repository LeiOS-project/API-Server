
process.env["LRA_DB_AUTO_MIGRATE"] = "true";

await import("../src/index");

export {};